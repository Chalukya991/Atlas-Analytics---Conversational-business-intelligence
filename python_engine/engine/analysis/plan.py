"""Canonical analysis-plan schema, normalization and validation.

The LLM planner (Node side) and this engine share ONE plan shape. Whatever the
model produced is normalized here into the canonical form and every column it
references is resolved against the loaded table. Unknown columns are an error,
never a silent zero.

Canonical plan:
{
  "operation": "describe|aggregate|top|time_series|compare|distribution",
  "dataset":   "<sheet name or null>",
  "group_by":  ["Col", ...],
  "metrics":   [{"agg": "sum", "column": "Col", "label": "total_col"}],
  "filters":   [{"column": "Col", "op": "eq", "value": ...}],
  "date_column": "Col" | null,
  "period":    "day|week|month|quarter|year",
  "limit":     10,
  "order":     "asc|desc",
  "compare":   {"column": "Col", "left": "A", "right": "B"} | null
}
"""
from __future__ import annotations

import re
from typing import Any

from engine.errors import InvalidPlanError, UnsupportedOperationError

OPERATIONS = ("describe", "aggregate", "top", "time_series", "compare", "distribution")
AGGREGATIONS = ("sum", "avg", "min", "max", "median", "count", "count_unique", "std")
FILTER_OPS = ("eq", "neq", "gt", "lt", "gte", "lte", "contains", "in", "not_in", "between", "is_null", "not_null")
PERIODS = ("day", "week", "month", "quarter", "year")
MAX_LIMIT = 500
MAX_GROUP_ROWS = 500


def _slug(text: str) -> str:
    """Loose key for column matching: letters and digits only."""
    return re.sub(r"[^a-z0-9]+", "", str(text).lower())


def _label_slug(text: str) -> str:
    """Stable snake_case label for result keys."""
    return re.sub(r"[^a-z0-9]+", "_", str(text).lower()).strip("_")


class ColumnResolver:
    """Resolve model-supplied column names against real headers.

    Exact match first, then case/whitespace-insensitive, then punctuation-
    insensitive slug match. Anything else is an error listing the real columns.
    """

    def __init__(self, columns: list[str]):
        self.columns = list(columns)
        self._lower = {c.strip().lower(): c for c in columns}
        self._slug = {_slug(c): c for c in columns}

    def resolve(self, name: Any, what: str = "column") -> str:
        if not isinstance(name, str) or not name.strip():
            raise InvalidPlanError(f"A {what} name is required. Available columns: {', '.join(self.columns)}")
        if name in self.columns:
            return name
        low = name.strip().lower()
        if low in self._lower:
            return self._lower[low]
        s = _slug(name)
        if s and s in self._slug:
            return self._slug[s]
        raise InvalidPlanError(
            f"Column {name!r} does not exist in the dataset. Available columns: {', '.join(self.columns)}"
        )


def _as_list(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return [v for v in value if v is not None and v != ""]
    return [value]


def _metric_label(agg: str, column: str | None) -> str:
    base = _label_slug(column) if column else "rows"
    return f"{agg}_{base}"


def normalize_plan(raw: dict, columns: list[str]) -> dict:
    """Normalize a loosely shaped plan into the canonical schema.

    Raises InvalidPlanError / UnsupportedOperationError with user-safe
    messages that the planner can feed back to the model on retry.
    """
    if not isinstance(raw, dict):
        raise InvalidPlanError("A valid analysis plan object is required.")

    operation = raw.get("operation")
    if not isinstance(operation, str) or operation not in OPERATIONS:
        raise UnsupportedOperationError(
            f"Operation {operation!r} is not supported. Allowed operations: {', '.join(OPERATIONS)}"
        )

    resolver = ColumnResolver(columns)
    plan: dict[str, Any] = {"operation": operation, "dataset": raw.get("dataset")}

    # ---- group_by ---------------------------------------------------------
    group_source = raw.get("group_by") or raw.get("groups")
    if not group_source and operation != "distribution":
        group_source = raw.get("column")
    plan["group_by"] = [resolver.resolve(g, "group_by column") for g in _as_list(group_source)]

    # ---- metrics ----------------------------------------------------------
    metrics: list[dict] = []
    for m in _as_list(raw.get("metrics")):
        if isinstance(m, str):
            m = {"agg": "sum", "column": m}
        if not isinstance(m, dict):
            continue
        agg = str(m.get("agg") or m.get("aggregation") or "sum").lower()
        if agg in ("average", "mean"):
            agg = "avg"
        if agg in ("total",):
            agg = "sum"
        if agg in ("distinct", "unique", "nunique", "count_distinct"):
            agg = "count_unique"
        if agg in ("stdev", "stddev"):
            agg = "std"
        if agg not in AGGREGATIONS:
            raise InvalidPlanError(f"Aggregation {agg!r} is not supported. Allowed: {', '.join(AGGREGATIONS)}")
        column = m.get("column")
        if column in (None, "", "*") and agg == "count":
            column = None
        elif column in (None, ""):
            raise InvalidPlanError(f"Metric with aggregation {agg!r} needs a column.")
        else:
            column = resolver.resolve(column, "metric column")
        label = m.get("label")
        if not isinstance(label, str) or not label.strip():
            label = _metric_label(agg, column)
        metrics.append({"agg": agg, "column": column, "label": _label_slug(label) or _metric_label(agg, column)})

    # Legacy flat fields (metric_column / value_column / agg) fold into metrics.
    legacy_col = raw.get("metric_column") or raw.get("value_column")
    if legacy_col and not metrics:
        agg = str(raw.get("agg") or "sum").lower()
        if agg not in AGGREGATIONS:
            raise InvalidPlanError(f"Aggregation {agg!r} is not supported. Allowed: {', '.join(AGGREGATIONS)}")
        col = resolver.resolve(legacy_col, "metric column")
        metrics.append({"agg": agg, "column": col, "label": _metric_label(agg, col)})

    # De-duplicate labels.
    seen: dict[str, int] = {}
    for m in metrics:
        if m["label"] in seen:
            seen[m["label"]] += 1
            m["label"] = f"{m['label']}_{seen[m['label']]}"
        else:
            seen[m["label"]] = 1
    plan["metrics"] = metrics

    # ---- filters ----------------------------------------------------------
    filters: list[dict] = []
    for f in _as_list(raw.get("filters")):
        if not isinstance(f, dict):
            continue
        col = resolver.resolve(f.get("column") or f.get("field"), "filter column")
        op = str(f.get("op") or f.get("operator") or "eq").lower()
        aliases = {"==": "eq", "=": "eq", "!=": "neq", "<>": "neq", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte",
                   "equals": "eq", "not_equals": "neq", "greater_than": "gt", "less_than": "lt", "like": "contains",
                   "notin": "not_in", "isnull": "is_null", "notnull": "not_null", "is_not_null": "not_null"}
        op = aliases.get(op, op)
        if op not in FILTER_OPS:
            raise InvalidPlanError(f"Filter operator {op!r} is not supported. Allowed: {', '.join(FILTER_OPS)}")
        value = f.get("value")
        if op in ("in", "not_in"):
            value = _as_list(value)
        if op == "between":
            value = _as_list(value)
            if len(value) != 2:
                raise InvalidPlanError("A 'between' filter needs exactly two values.")
        filters.append({"column": col, "op": op, "value": value})
    plan["filters"] = filters

    # ---- date / period ----------------------------------------------------
    date_col = raw.get("date_column") or raw.get("time_column")
    plan["date_column"] = resolver.resolve(date_col, "date column") if date_col else None
    period = str(raw.get("period") or raw.get("granularity") or "month").lower()
    period = {"daily": "day", "weekly": "week", "monthly": "month", "quarterly": "quarter", "yearly": "year", "annual": "year"}.get(period, period)
    if period not in PERIODS:
        raise InvalidPlanError(f"Period {period!r} is not supported. Allowed: {', '.join(PERIODS)}")
    plan["period"] = period

    # ---- limit / order ----------------------------------------------------
    try:
        limit = int(raw.get("limit") or 10)
    except (TypeError, ValueError):
        limit = 10
    plan["limit"] = max(1, min(limit, MAX_LIMIT))
    order = str(raw.get("order") or raw.get("sort") or "desc").lower()
    order = {"ascending": "asc", "descending": "desc", "top": "desc", "bottom": "asc"}.get(order, order)
    if order not in ("asc", "desc"):
        raise InvalidPlanError("Order must be 'asc' or 'desc'.")
    plan["order"] = order

    # ---- compare ----------------------------------------------------------
    compare = raw.get("compare")
    if compare is None and (raw.get("left_value") is not None or raw.get("right_value") is not None):
        compare = {"column": (plan["group_by"][0] if plan["group_by"] else None), "left": raw.get("left_value"), "right": raw.get("right_value")}
    if isinstance(compare, dict):
        col = compare.get("column") or (plan["group_by"][0] if plan["group_by"] else None)
        plan["compare"] = {
            "column": resolver.resolve(col, "compare column") if col else None,
            "left": compare.get("left") if compare.get("left") is not None else compare.get("a"),
            "right": compare.get("right") if compare.get("right") is not None else compare.get("b"),
        }
    else:
        plan["compare"] = None

    # ---- operation-specific semantic checks -------------------------------
    if operation == "aggregate" and not metrics:
        # "How many rows per region" — count rows.
        plan["metrics"] = [{"agg": "count", "column": None, "label": "count_rows"}]
    if operation == "top":
        if not plan["group_by"]:
            raise InvalidPlanError("A 'top' analysis needs a group_by column to rank.")
        if not plan["metrics"]:
            plan["metrics"] = [{"agg": "count", "column": None, "label": "count_rows"}]
    if operation == "time_series":
        if not plan["date_column"]:
            raise InvalidPlanError("A 'time_series' analysis needs a date_column.")
        if not plan["metrics"]:
            plan["metrics"] = [{"agg": "count", "column": None, "label": "count_rows"}]
    if operation == "compare":
        if not plan["compare"] or not plan["compare"]["column"]:
            raise InvalidPlanError("A 'compare' analysis needs compare.column plus compare.left and compare.right values.")
        if plan["compare"]["left"] is None or plan["compare"]["right"] is None:
            raise InvalidPlanError("A 'compare' analysis needs both compare.left and compare.right values.")
        if not plan["metrics"]:
            plan["metrics"] = [{"agg": "count", "column": None, "label": "count_rows"}]
    if operation == "distribution":
        if not plan["group_by"]:
            col = raw.get("column")
            if not col:
                raise InvalidPlanError("A 'distribution' analysis needs a column.")
            plan["group_by"] = [resolver.resolve(col, "distribution column")]

    return plan
