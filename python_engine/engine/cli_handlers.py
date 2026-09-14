"""Implementation of the CLI commands (inspect, analyze, preview)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from engine.errors import DataUnavailableError, InvalidPlanError
from engine.file_reader import SheetData, read_file
from engine.profiling import profile_sheet


def _column_payload(c) -> dict:
    return {
        "name": c.name,
        "data_type": c.data_type,
        "fill_count": c.fill_count,
        "total_rows": c.total_rows,
        "fill_rate": round(c.fill_count / c.total_rows, 4) if c.total_rows else 0,
        "sample_values": [_jsonable(v) for v in c.sample_values],
        "distinct_estimate": c.distinct_estimate,
        "currency": c.currency,
        "unit": c.unit,
        "is_percent": c.is_percent,
        "is_numeric_like": c.is_numeric_like,
        "is_date_like": c.is_date_like,
        "stats": c.stats,
        "issues": c.issues,
    }


def _jsonable(v: Any) -> Any:
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def handle_inspect(file_path: str) -> dict:
    path = Path(file_path)
    if not path.exists():
        raise DataUnavailableError("The requested file could not be found on the server.")

    sheets = read_file(path)

    result = {"filename": path.name, "sheets": []}
    for sheet in sheets.values():
        profile = profile_sheet(sheet.name, sheet.rows, sheet.column_order)
        result["sheets"].append(
            {
                "name": sheet.name,
                "row_count": profile.row_count,
                "column_count": profile.column_count,
                "merged_ranges": len(sheet.merged_cells),
                "header_row": sheet.header_row,
                "truncated": sheet.truncated,
                "issues": profile.issues,
                "columns": [_column_payload(c) for c in profile.columns],
                "preview": [
                    {k: _jsonable(v) for k, v in row.items()} for row in sheet.rows[:20]
                ],
            }
        )
    return result


def handle_preview(file_path: str, sheet_name: str | None, offset: int = 0, limit: int = 50) -> dict:
    path = Path(file_path)
    if not path.exists():
        raise DataUnavailableError("The requested file could not be found on the server.")
    sheets = read_file(path)
    sheet = sheets.get(sheet_name) if sheet_name else None
    if sheet is None:
        sheet = next(iter(sheets.values()), None)
    if sheet is None:
        raise DataUnavailableError("The file contains no readable data.")
    limit = max(1, min(int(limit), 500))
    offset = max(0, int(offset))
    return {
        "sheet": sheet.name,
        "columns": sheet.column_order,
        "total_rows": len(sheet.rows),
        "offset": offset,
        "rows": [{k: _jsonable(v) for k, v in row.items()} for row in sheet.rows[offset: offset + limit]],
    }


def handle_analyze(request: dict) -> dict:
    """Execute an analysis plan against loaded datasets.

    Request shape:
    {
        "plan": { ... loosely shaped plan from the planner ... },
        "datasets": [ { "sheet_name": str, "path": str } ]
    }

    The plan is normalized and validated against the dataset's real columns
    (see engine.analysis.plan) before any computation happens.
    """
    from engine.analysis.executor import get_executor
    from engine.analysis.plan import normalize_plan

    raw_plan = request.get("plan")
    if not isinstance(raw_plan, dict):
        raise InvalidPlanError("A valid analysis plan is required.")

    tables = _load_tables(request.get("datasets") or [])
    if not tables:
        raise DataUnavailableError("No dataset was provided for analysis.")

    dataset_key = raw_plan.get("dataset")
    table = tables.get(dataset_key) if isinstance(dataset_key, str) else None
    if table is None:
        table = next(iter(tables.values()))
    raw_plan = dict(raw_plan)
    raw_plan["dataset"] = table.name

    plan = normalize_plan(raw_plan, table.column_order)
    executor = get_executor(plan["operation"])
    result = executor.execute(plan, {table.name: table})
    result["plan"] = plan
    return result


def _load_tables(datasets: list[dict]) -> dict[str, SheetData]:
    tables: dict[str, SheetData] = {}
    for ds in datasets:
        path = Path(ds["path"])
        if not path.exists():
            raise DataUnavailableError(f"Dataset {ds.get('sheet_name', '')!r} is not available on the server.")
        sheets = read_file(path)
        if not sheets:
            raise DataUnavailableError(f"Dataset {ds.get('sheet_name', '')!r} contains no readable data.")
        wanted = ds.get("sheet_name")
        sheet = sheets.get(wanted) if wanted else None
        if sheet is None:
            sheet = next(iter(sheets.values()))
        key = wanted or sheet.name
        # Present the table under the key the caller used so plan.dataset resolves.
        tables[key] = SheetData(
            name=key,
            rows=sheet.rows,
            column_order=sheet.column_order,
            merged_cells=sheet.merged_cells,
            truncated=sheet.truncated,
            header_row=sheet.header_row,
        )
    return tables
