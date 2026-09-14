"""Read spreadsheet files into normalized tabular data without executing macros or formulas.

Uses python-calamine for XLSX/XLS/ODS (fast, safe, no formula evaluation) and
the stdlib CSV reader for CSV/TSV files. Merged cells are surfaced in metadata;
formula cells yield their last-saved cached value, which is treated as
deterministic input.

Parsed tables are cached on disk (pickle, keyed by path + size + mtime) so a
question does not re-parse a 100 MB workbook every time.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import pickle
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine.errors import EngineError
from engine.settings import settings

CACHE_VERSION = 3


@dataclass
class SheetData:
    name: str
    rows: list[dict[str, Any]]
    column_order: list[str]
    merged_cells: list[tuple[int, int, int, int]] = field(default_factory=list)
    truncated: bool = False
    header_row: int = 0


# Calamine import is optional; degrade gracefully with a clear error message.
try:
    from python_calamine import CalamineWorkbook

    _HAS_CALAMINE = True
except ImportError:  # pragma: no cover
    _HAS_CALAMINE = False


class UnsupportedFileError(EngineError):
    pass


class CorruptFileError(EngineError):
    pass


# --------------------------------------------------------------------------
# Header handling
# --------------------------------------------------------------------------

def _clean_header(value: Any) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\r", "").split())


def _dedupe_headers(raw: list[Any]) -> list[str]:
    header = [(_clean_header(c) or f"column_{i + 1}") for i, c in enumerate(raw)]
    used: dict[str, int] = {}
    out: list[str] = []
    for h in header:
        if h in used:
            used[h] += 1
            out.append(f"{h}_{used[h]}")
        else:
            used[h] = 1
            out.append(h)
    return out


def _detect_header_row(matrix: list[list[Any]]) -> int:
    """Find the first row that looks like a header: mostly non-empty strings,
    followed by a row with data. Skips title rows and blank rows that are
    common in exported business spreadsheets."""
    limit = min(len(matrix), 15)
    best_idx, best_score = 0, -1.0
    for i in range(limit):
        row = matrix[i]
        if not row:
            continue
        cells = [c for c in row if c is not None and str(c).strip() != ""]
        if len(cells) < 2:
            continue
        str_share = sum(1 for c in cells if isinstance(c, str)) / len(cells)
        width_share = len(cells) / max(len(row), 1)
        # A header should be wide and textual, and the next row should exist.
        score = str_share * 0.6 + width_share * 0.4
        if i + 1 < len(matrix) and score > best_score and str_share >= 0.6:
            best_idx, best_score = i, score
            if score >= 0.95:
                break
    return best_idx


# --------------------------------------------------------------------------
# Readers
# --------------------------------------------------------------------------

def _read_csv(path: Path) -> SheetData:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise CorruptFileError(f"Could not read file: {exc}") from exc

    text = None
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise CorruptFileError("CSV file could not be decoded with supported encodings")

    sample = text[:20000]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = "\t" if path.suffix.lower() == ".tsv" else ","

    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    matrix = [row for row in reader]
    # Drop fully blank trailing rows.
    while matrix and not any(str(c).strip() for c in matrix[-1]):
        matrix.pop()
    if not matrix:
        return SheetData(name="default", rows=[], column_order=[])

    header_idx = _detect_header_row(matrix)
    header = _dedupe_headers(matrix[header_idx])
    rows: list[dict[str, Any]] = []
    truncated = False
    for raw_row in matrix[header_idx + 1:]:
        if not any(str(c).strip() for c in raw_row):
            continue
        if len(rows) >= settings.max_rows:
            truncated = True
            break
        row: dict[str, Any] = {}
        for idx, h in enumerate(header):
            value = raw_row[idx] if idx < len(raw_row) else ""
            row[h] = value.strip() if isinstance(value, str) else value
        rows.append(row)
    return SheetData(name="default", rows=rows, column_order=header, truncated=truncated, header_row=header_idx)


def _read_excel(path: Path) -> dict[str, SheetData]:
    if not _HAS_CALAMINE:
        raise EngineError("python-calamine is not installed; cannot read Excel files")
    try:
        wb = CalamineWorkbook.from_path(str(path))
    except Exception as exc:  # noqa: BLE001 - calamine raises varied exceptions
        raise CorruptFileError(f"Could not parse workbook: {exc}") from exc

    sheets: dict[str, SheetData] = {}
    for sheet_name in wb.sheet_names:
        try:
            data = wb.get_sheet_by_name(sheet_name)
            matrix = data.to_python(skip_empty_area=True)
        except Exception as exc:  # noqa: BLE001
            raise CorruptFileError(f"Could not read sheet {sheet_name!r}: {exc}") from exc

        while matrix and not any(c is not None and str(c).strip() for c in matrix[-1]):
            matrix.pop()
        if not matrix:
            sheets[sheet_name] = SheetData(name=sheet_name, rows=[], column_order=[])
            continue

        header_idx = _detect_header_row(matrix)
        header = _dedupe_headers(matrix[header_idx])

        rows: list[dict[str, Any]] = []
        truncated = False
        for raw in matrix[header_idx + 1:]:
            if not any(c is not None and str(c).strip() for c in raw):
                continue
            if len(rows) >= settings.max_rows:
                truncated = True
                break
            row: dict[str, Any] = {}
            for idx, h in enumerate(header):
                value = raw[idx] if idx < len(raw) else None
                if isinstance(value, str):
                    value = value.strip()
                row[h] = value
            rows.append(row)

        merged: list[tuple[int, int, int, int]] = []
        try:
            for rng in getattr(data, "merged_ranges", []) or []:
                r1, c1, r2, c2 = rng
                merged.append((r1, c1, r2, c2))
        except Exception:  # noqa: BLE001 - merged ranges not always exposed
            merged = []

        sheets[sheet_name] = SheetData(
            name=sheet_name,
            rows=rows,
            column_order=header,
            merged_cells=merged,
            truncated=truncated,
            header_row=header_idx,
        )
    return sheets


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------

def _cache_path(path: Path) -> Path | None:
    try:
        st = path.stat()
    except OSError:
        return None
    key = hashlib.sha1(f"{CACHE_VERSION}|{path.resolve()}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest()
    cache_dir = Path(settings.storage_path) / "cache"
    return cache_dir / f"{key}.pkl"


def _load_cache(cache_file: Path | None) -> dict[str, SheetData] | None:
    if not cache_file or not cache_file.exists():
        return None
    try:
        with open(cache_file, "rb") as fh:
            payload = pickle.load(fh)  # noqa: S301 - file written by this engine only
        if isinstance(payload, dict) and payload.get("version") == CACHE_VERSION:
            return payload["sheets"]
    except Exception:  # noqa: BLE001 - a bad cache is simply ignored
        pass
    return None


def _store_cache(cache_file: Path | None, sheets: dict[str, SheetData]) -> None:
    if not cache_file:
        return
    try:
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache_file.with_suffix(".tmp")
        with open(tmp, "wb") as fh:
            pickle.dump({"version": CACHE_VERSION, "sheets": sheets}, fh, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, cache_file)
    except Exception:  # noqa: BLE001 - caching is best-effort
        pass


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

SUPPORTED_SUFFIXES = (".csv", ".tsv", ".txt", ".xlsx", ".xlsm", ".xls", ".xlsb", ".ods")


def read_file(path: Path, use_cache: bool = True) -> dict[str, SheetData]:
    """Read any supported input file into per-sheet row dictionaries."""
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise UnsupportedFileError(f"Unsupported file type: {suffix}")

    try:
        size = path.stat().st_size
    except OSError as exc:
        raise CorruptFileError(f"Could not read file: {exc}") from exc
    if size > settings.max_file_size:
        raise UnsupportedFileError("The file exceeds the maximum supported size.")

    cache_file = _cache_path(path) if use_cache else None
    cached = _load_cache(cache_file)
    if cached is not None:
        return cached

    if suffix in (".csv", ".tsv", ".txt"):
        sheets = {"default": _read_csv(path)}
    else:
        sheets = _read_excel(path)

    _store_cache(cache_file, sheets)
    return sheets
