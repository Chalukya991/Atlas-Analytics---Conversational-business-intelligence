"""Dynamic column typing and data-quality inspection.

Given the rows of a raw sheet, infer, for each column:
  - the dominant data type (text / number / date / boolean / unknown)
  - fill rate and null-token count
  - distinct-value sample
  - currency/unit/percent hints
  - numeric or date summary statistics
  - data-quality issues (mixed types, dirty values, constant columns, ...)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from engine.normalization import infer_day_first, is_null_like, parse_date, parse_number, parse_unit

SAMPLE_SIZE = 200


@dataclass
class ColumnProfile:
    name: str
    data_type: str
    fill_count: int
    total_rows: int
    sample_values: list[Any]
    distinct_estimate: int
    currency: str | None = None
    unit: str | None = None
    is_percent: bool = False
    is_numeric_like: bool = False
    is_date_like: bool = False
    stats: dict = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)


@dataclass
class SheetProfile:
    name: str
    row_count: int
    column_count: int
    columns: list[ColumnProfile]
    issues: list[str] = field(default_factory=list)


def _classify(values: list[Any]) -> dict:
    """Classify a column by sampling up to SAMPLE_SIZE non-null values."""
    sample = values[:SAMPLE_SIZE]
    out = {
        "type": "unknown", "currency": None, "unit": None, "percent": False,
        "numeric_like": False, "date_like": False, "mixed": False, "day_first": None,
    }
    if not sample:
        return out

    num = date = text = boolean = 0
    percent_hits = 0
    currency = unit = None
    day_first = infer_day_first(sample)

    for v in sample:
        if isinstance(v, bool):
            boolean += 1
            continue
        if isinstance(v, (int, float)):
            num += 1
            continue
        if isinstance(v, datetime):
            date += 1
            continue
        if isinstance(v, str):
            low = v.strip().lower()
            if low in ("true", "false", "yes", "no", "y", "n"):
                boolean += 1
                continue
            pn = parse_number(v)
            if pn and pn.confident:
                num += 1
                if pn.currency:
                    currency = currency or pn.currency
                if pn.is_percent:
                    percent_hits += 1
                continue
            pd = parse_date(v, day_first=day_first)
            if pd and pd.confident:
                date += 1
                continue
            pu = parse_unit(v)
            if pu:
                num += 1
                unit = unit or pu.unit
                continue
            text += 1
            continue
        text += 1

    total = float(len(sample))
    shares = {"number": num / total, "date": date / total, "text": text / total, "boolean": boolean / total}
    dominant = max(shares, key=shares.get)
    out["type"] = dominant if shares[dominant] >= 0.7 else dominant
    out["mixed"] = shares[dominant] < 0.9 and len(sample) >= 5
    out["currency"] = currency
    out["unit"] = unit
    out["percent"] = percent_hits / total >= 0.7
    out["numeric_like"] = num > 0
    out["date_like"] = date > 0
    out["day_first"] = day_first
    return out


def _numeric_stats(values: list[Any]) -> dict:
    nums = []
    for v in values:
        if isinstance(v, bool):
            continue
        if isinstance(v, (int, float)):
            nums.append(float(v))
        elif isinstance(v, str):
            pn = parse_number(v)
            if pn and pn.confident:
                nums.append(pn.value)
    if not nums:
        return {}
    s = sorted(nums)
    n = len(s)
    mean = sum(s) / n
    median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2
    negatives = sum(1 for x in s if x < 0)
    return {
        "count": n,
        "min": round(s[0], 6),
        "max": round(s[-1], 6),
        "mean": round(mean, 6),
        "median": round(median, 6),
        "sum": round(sum(s), 6),
        "negatives": negatives,
    }


def _date_stats(values: list[Any], day_first: bool | None) -> dict:
    isos = []
    ambiguous = 0
    for v in values:
        pd = parse_date(v, day_first=day_first)
        if pd and pd.format != "month-only":
            isos.append(pd.iso)
            if not pd.confident:
                ambiguous += 1
    if not isos:
        return {}
    return {"count": len(isos), "min": min(isos), "max": max(isos), "ambiguous": ambiguous}


def profile_sheet(name: str, rows: list[dict[str, Any]], column_order: list[str]) -> SheetProfile:
    total = len(rows)
    profiles: list[ColumnProfile] = []

    for col in column_order:
        values = [row.get(col) for row in rows]
        non_null = [v for v in values if not is_null_like(v)]
        null_tokens = sum(1 for v in values if v is not None and isinstance(v, str) and v.strip() and is_null_like(v))
        fill_count = len(non_null)

        cls = _classify(non_null)
        data_type = cls["type"]

        distinct: set = set()
        sample: list[Any] = []
        for v in non_null:
            key = repr(v)
            if key not in distinct:
                distinct.add(key)
                if len(sample) < 8:
                    sample.append(v)

        issues: list[str] = []
        stats: dict = {}
        if fill_count == 0:
            issues.append("empty_column")
        else:
            if fill_count / total < 0.5 if total else False:
                issues.append("sparse_column")
            if len(distinct) == 1 and fill_count > 1 and total > 3:
                issues.append("constant_values")
            if cls["mixed"]:
                issues.append("mixed_types")
            if null_tokens:
                issues.append("null_placeholders")
            if data_type == "number":
                stats = _numeric_stats(non_null)
                if cls["currency"]:
                    issues.append("currency_detected")
                if cls["percent"]:
                    issues.append("percent_values")
                if stats.get("negatives"):
                    issues.append("negative_values")
            elif data_type == "date":
                stats = _date_stats(non_null, cls["day_first"])
                if stats.get("ambiguous"):
                    issues.append("ambiguous_date_format")
            elif data_type == "text" and len(distinct) == fill_count and fill_count > 20:
                issues.append("unique_identifier")
            if data_type == "text" and total and len(distinct) / max(fill_count, 1) > 0.95 and fill_count > 20:
                pass  # covered by unique_identifier

        profiles.append(
            ColumnProfile(
                name=col,
                data_type=data_type,
                fill_count=fill_count,
                total_rows=total,
                sample_values=sample,
                distinct_estimate=len(distinct),
                currency=cls["currency"],
                unit=cls["unit"],
                is_percent=cls["percent"],
                is_numeric_like=cls["numeric_like"],
                is_date_like=cls["date_like"],
                stats=stats,
                issues=issues,
            )
        )

    sheet_issues: list[str] = []
    if total == 0:
        sheet_issues.append("empty_sheet")
    elif total == 1:
        sheet_issues.append("single_row")
    if any(c.startswith("column_") for c in column_order):
        sheet_issues.append("unnamed_columns")
    if not any(p.data_type == "number" for p in profiles) and profiles:
        sheet_issues.append("no_numeric_columns")

    return SheetProfile(name=name, row_count=total, column_count=len(column_order), columns=profiles, issues=sheet_issues)
