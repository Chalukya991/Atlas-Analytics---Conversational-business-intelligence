"""Safe analysis executor.

The executor is the ONLY place that runs computations over business data. It
accepts a canonical plan (see ``engine.analysis.plan``), resolves only
allow-listed operations and returns deterministic results with provenance and
explicit data-quality warnings. It never evaluates arbitrary code.

Every result has this envelope:
{
  "kind": "...",                 # scalar_aggregation | grouped_aggregation | top_n | time_series | comparison | distribution | describe
  "operation": "...",
  "results": [...] | {...},
  "columns": [...],              # display column order for tabular kinds
  "row_count": N,                # rows in dataset
  "filtered_rows": N,            # rows after filters
  "warnings": [{"code": "...", "message": "...", ...}],
  "truncated": bool,
  "provenance": {...}
}
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from engine.errors import DataUnavailableError, InvalidPlanError, UnsupportedOperationError
from engine.normalization import infer_day_first, is_null_like, parse_date, parse_number

MAX_GROUP_ROWS = 500
DISTRIBUTION_BINS = 12


# --------------------------------------------------------------------------
# Numeric coercion with dropped-value accounting
# --------------------------------------------------------------------------

class NumericColumn:
    """Coerce a column's cells to floats while tracking what was dropped."""

    __slots__ = ("values", "nulls", "dropped", "examples")

    def __init__(self, cells: list[Any]):
        self.values: list[float] = []
        self.nulls = 0
        self.dropped = 0
        self.examples: list[str] = []
        for v in cells:
            if is_null_like(v):
                self.nulls += 1
                continue
            f = coerce_float(v)
            if f is None:
                self.dropped += 1
                if len(self.examples) < 3:
                    self.examples.append(str(v)[:40])
            else:
                self.values.append(f)


def coerce_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        pn = parse_number(value)
        if pn and pn.confident:
            return pn.value
    return None


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def _std(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    m = _mean(values)
    var = sum((x - m) ** 2 for x in values) / (len(values) - 1)
    return var ** 0.5


def _round(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 6)
    return value


# --------------------------------------------------------------------------
# Filters
# --------------------------------------------------------------------------

def _norm_text(value: Any) -> str:
    return "" if value is None else str(value).strip().lower()


def _matches(cell: Any, op: str, value: Any) -> bool:
    if op == "is_null":
        return is_null_like(cell)
    if op == "not_null":
        return not is_null_like(cell)
    if is_null_like(cell):
        return op in ("neq", "not_in")
    if op == "eq":
        return _norm_text(cell) == _norm_text(value)
    if op == "neq":
        return _norm_text(cell) != _norm_text(value)
    if op == "contains":
        return _norm_text(value) in _norm_text(cell)
    if op in ("in", "not_in"):
        options = {_norm_text(v) for v in (value if isinstance(value, list) else [value])}
        hit = _norm_text(cell) in options
        return hit if op == "in" else not hit
    if op in ("gt", "lt", "gte", "lte", "between"):
        a = coerce_float(cell)
        if a is None:
            # Try date comparison.
            da = parse_date(cell, strict=True)
            if da is None:
                return False
            if op == "between":
                lo, hi = (parse_date(v, strict=True) for v in value)
                return bool(lo and hi and lo.iso <= da.iso <= hi.iso)
            db = parse_date(value, strict=True)
            if db is None:
                return False
            return {"gt": da.iso > db.iso, "lt": da.iso < db.iso, "gte": da.iso >= db.iso, "lte": da.iso <= db.iso}[op]
        if op == "between":
            lo, hi = coerce_float(value[0]), coerce_float(value[1])
            return lo is not None and hi is not None and lo <= a <= hi
        b = coerce_float(value)
        if b is None:
            return False
        return {"gt": a > b, "lt": a < b, "gte": a >= b, "lte": a <= b}[op]
    return False


def _filter_rows(rows: list[dict], filters: list[dict], warnings: list[dict]) -> list[dict]:
    filtered = rows
    for cond in filters:
        column, op, value = cond["column"], cond["op"], cond.get("value")
        before = len(filtered)
        filtered = [r for r in filtered if _matches(r.get(column), op, value)]
        if before and not filtered:
            warnings.append({
                "code": "filter_matched_nothing",
                "message": f"The filter {column} {op} {value!r} matched no rows.",
                "column": column,
            })
    return filtered


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------

def _aggregate(rows: list[dict], metric: dict, stats: dict) -> Any:
    agg, column = metric["agg"], metric["column"]
    if column is None:
        return len(rows)
    cells = [r.get(column) for r in rows]
    if agg == "count":
        return sum(1 for c in cells if not is_null_like(c))
    if agg == "count_unique":
        return len({repr(c) for c in cells if not is_null_like(c)})
    nc = NumericColumn(cells)
    entry = stats.setdefault(column, {"dropped": 0, "nulls": 0, "examples": []})
    entry["dropped"] += nc.dropped
    entry["nulls"] += nc.nulls
    for e in nc.examples:
        if len(entry["examples"]) < 3 and e not in entry["examples"]:
            entry["examples"].append(e)
    v = nc.values
    if agg == "sum":
        return sum(v) if v else 0.0
    if agg == "avg":
        return _mean(v)
    if agg == "min":
        return min(v) if v else None
    if agg == "max":
        return max(v) if v else None
    if agg == "median":
        return _median(v)
    if agg == "std":
        return _std(v)
    raise InvalidPlanError(f"Aggregation {agg!r} is not supported.")


def _group_key(row: dict, groups: list[str]) -> tuple:
    return tuple(None if is_null_like(row.get(g)) else str(row.get(g)).strip() for g in groups)


def _group_by(rows: list[dict], groups: list[str], metrics: list[dict], stats: dict, warnings: list[dict]) -> list[dict]:
    buckets: dict[tuple, list[dict]] = {}
    null_groups = 0
    for row in rows:
        key = _group_key(row, groups)
        if any(k is None for k in key):
            null_groups += 1
        buckets.setdefault(key, []).append(row)
    if null_groups:
        warnings.append({
            "code": "null_group_values",
            "message": f"{null_groups} row(s) have a blank value in {', '.join(groups)} and are grouped under '(blank)'.",
            "rows": null_groups,
        })

    results = []
    for key, group_rows in buckets.items():
        item = {groups[i]: ("(blank)" if key[i] is None else key[i]) for i in range(len(groups))}
        for metric in metrics:
            item[metric["label"]] = _round(_aggregate(group_rows, metric, stats))
        item["_rows"] = len(group_rows)
        results.append(item)
    return results


def _emit_numeric_warnings(stats: dict, warnings: list[dict]) -> None:
    for column, s in stats.items():
        if s["dropped"]:
            warnings.append({
                "code": "non_numeric_values_dropped",
                "message": (
                    f"{s['dropped']} value(s) in '{column}' could not be read as numbers and were excluded "
                    f"(examples: {', '.join(repr(e) for e in s['examples'])})."
                ),
                "column": column,
                "rows": s["dropped"],
            })
        if s["nulls"]:
            warnings.append({
                "code": "null_values_ignored",
                "message": f"{s['nulls']} blank value(s) in '{column}' were ignored.",
                "column": column,
                "rows": s["nulls"],
            })


def _truncate(results: list[dict], limit: int, warnings: list[dict]) -> tuple[list[dict], bool]:
    if len(results) > limit:
        warnings.append({
            "code": "results_truncated",
            "message": f"Showing {limit} of {len(results)} groups.",
            "total": len(results),
        })
        return results[:limit], True
    return results, False


def _sort_key(label: str, order: str):
    def key(r: dict):
        v = r.get(label)
        f = coerce_float(v)
        if f is None:
            return (1, 0.0)
        return (0, -f if order == "desc" else f)
    return key


# --------------------------------------------------------------------------
# Table selection
# --------------------------------------------------------------------------

def _select_table(plan: dict, tables: dict):
    dataset = plan.get("dataset")
    if dataset and dataset in tables:
        return tables[dataset]
    if dataset:
        low = {k.lower(): k for k in tables}
        if dataset.lower() in low:
            return tables[low[dataset.lower()]]
    if tables:
        return next(iter(tables.values()))
    raise DataUnavailableError("The requested dataset is not loaded.")


def _envelope(plan: dict, table, kind: str) -> dict:
    return {
        "kind": kind,
        "operation": plan["operation"],
        "row_count": len(table.rows),
        "filtered_rows": len(table.rows),
        "warnings": [],
        "truncated": False,
        "provenance": {"plan": plan, "dataset": table.name, "computed_by": "deterministic_python_engine"},
    }


# --------------------------------------------------------------------------
# Operations
# --------------------------------------------------------------------------

def _op_describe(plan: dict, tables: dict) -> dict:
    from engine.profiling import profile_sheet

    table = _select_table(plan, tables)
    base = _envelope(plan, table, "describe")
    profile = profile_sheet(table.name, table.rows, table.column_order)
    base["results"] = {
        "rows": profile.row_count,
        "columns": profile.column_count,
        "column_profiles": [
            {
                "name": c.name,
                "data_type": c.data_type,
                "fill_rate": round(c.fill_count / c.total_rows, 4) if c.total_rows else 0,
                "distinct": c.distinct_estimate,
                "sample_values": c.sample_values[:5],
                "stats": c.stats,
                "issues": c.issues,
            }
            for c in profile.columns
        ],
        "issues": profile.issues,
    }
    base["columns"] = ["name", "data_type", "fill_rate", "distinct"]
    return base


def _op_aggregate(plan: dict, tables: dict) -> dict:
    table = _select_table(plan, tables)
    base = _envelope(plan, table, "scalar_aggregation")
    rows = _filter_rows(table.rows, plan["filters"], base["warnings"])
    base["filtered_rows"] = len(rows)
    stats: dict = {}
    labels = [m["label"] for m in plan["metrics"]]

    if plan["group_by"]:
        results = _group_by(rows, plan["group_by"], plan["metrics"], stats, base["warnings"])
        results.sort(key=_sort_key(labels[0], plan["order"]))
        results, truncated = _truncate(results, MAX_GROUP_ROWS, base["warnings"])
        base["kind"] = "grouped_aggregation"
        base["results"] = results
        base["group_by"] = plan["group_by"]
        base["metrics"] = labels
        base["columns"] = plan["group_by"] + labels
        base["truncated"] = truncated
    else:
        flat = {m["label"]: _round(_aggregate(rows, m, stats)) for m in plan["metrics"]}
        base["kind"] = "scalar_aggregation"
        base["results"] = flat
        base["metrics"] = labels
        base["columns"] = labels
    base["metric_definitions"] = plan["metrics"]
    _emit_numeric_warnings(stats, base["warnings"])
    return base


def _op_top(plan: dict, tables: dict) -> dict:
    table = _select_table(plan, tables)
    base = _envelope(plan, table, "top_n")
    rows = _filter_rows(table.rows, plan["filters"], base["warnings"])
    base["filtered_rows"] = len(rows)
    stats: dict = {}
    group_col = plan["group_by"][0]
    rank_metric = plan["metrics"][0]
    grouped = _group_by(rows, [group_col], plan["metrics"], stats, base["warnings"])
    grouped.sort(key=_sort_key(rank_metric["label"], plan["order"]))
    total_groups = len(grouped)
    limited = grouped[: plan["limit"]]
    for i, r in enumerate(limited, start=1):
        r["rank"] = i
    # Share of total for the ranking metric when it is additive.
    if rank_metric["agg"] in ("sum", "count"):
        total = sum(coerce_float(r.get(rank_metric["label"])) or 0.0 for r in grouped)
        for r in limited:
            v = coerce_float(r.get(rank_metric["label"]))
            r["share"] = _round(v / total) if total and v is not None else None
    base["results"] = limited
    base["group_by"] = [group_col]
    base["metrics"] = [m["label"] for m in plan["metrics"]]
    base["rank_metric"] = rank_metric["label"]
    base["columns"] = ["rank", group_col] + base["metrics"] + (["share"] if "share" in (limited[0] if limited else {}) else [])
    base["limit"] = plan["limit"]
    base["total_groups"] = total_groups
    base["truncated"] = total_groups > plan["limit"]
    base["metric_definitions"] = plan["metrics"]
    _emit_numeric_warnings(stats, base["warnings"])
    return base


def _period_key(iso: str, period: str) -> str:
    y, m, d = (int(p) for p in iso.split("-")[:3])
    if period == "day":
        return iso
    if period == "week":
        dt = date(y, m, d)
        iso_year, iso_week, _ = dt.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    if period == "quarter":
        return f"{y}-Q{(m - 1) // 3 + 1}"
    if period == "year":
        return f"{y}"
    return f"{y}-{m:02d}"


def _fill_period_gaps(keys: list[str], period: str) -> list[str]:
    """Return the complete ordered list of period keys between min and max."""
    if len(keys) < 2 or period == "week":
        return keys
    out = []
    if period == "day":
        start = date.fromisoformat(keys[0])
        end = date.fromisoformat(keys[-1])
        if (end - start).days > 3660:
            return keys
        cur = start
        while cur <= end:
            out.append(cur.isoformat())
            cur += timedelta(days=1)
        return out
    if period == "month":
        y, m = (int(x) for x in keys[0].split("-"))
        ey, em = (int(x) for x in keys[-1].split("-"))
        if (ey - y) > 30:
            return keys
        while (y, m) <= (ey, em):
            out.append(f"{y}-{m:02d}")
            m += 1
            if m > 12:
                m, y = 1, y + 1
        return out
    if period == "quarter":
        y, q = keys[0].split("-Q")
        ey, eq = keys[-1].split("-Q")
        y, q, ey, eq = int(y), int(q), int(ey), int(eq)
        while (y, q) <= (ey, eq):
            out.append(f"{y}-Q{q}")
            q += 1
            if q > 4:
                q, y = 1, y + 1
        return out
    if period == "year":
        return [str(y) for y in range(int(keys[0]), int(keys[-1]) + 1)]
    return keys


def _op_time_series(plan: dict, tables: dict) -> dict:
    table = _select_table(plan, tables)
    base = _envelope(plan, table, "time_series")
    rows = _filter_rows(table.rows, plan["filters"], base["warnings"])
    base["filtered_rows"] = len(rows)
    stats: dict = {}
    date_col, period = plan["date_column"], plan["period"]

    day_first = infer_day_first([r.get(date_col) for r in rows[:2000]])
    buckets: dict[str, list[dict]] = {}
    unparsed = 0
    ambiguous = 0
    examples: list[str] = []
    for row in rows:
        raw = row.get(date_col)
        if is_null_like(raw):
            unparsed += 1
            continue
        pd = parse_date(raw, day_first=day_first)
        if pd is None or pd.format == "month-only":
            unparsed += 1
            if len(examples) < 3:
                examples.append(str(raw)[:40])
            continue
        if not pd.confident:
            ambiguous += 1
        buckets.setdefault(_period_key(pd.iso, period), []).append(row)

    if unparsed:
        base["warnings"].append({
            "code": "unparseable_dates_dropped",
            "message": f"{unparsed} row(s) in '{date_col}' had no readable date and were excluded"
                       + (f" (examples: {', '.join(repr(e) for e in examples)})." if examples else "."),
            "column": date_col,
            "rows": unparsed,
        })
    if ambiguous:
        base["warnings"].append({
            "code": "ambiguous_date_order",
            "message": f"{ambiguous} date(s) in '{date_col}' could be read as day/month or month/day; day-first was assumed. Confirm the date format.",
            "column": date_col,
            "rows": ambiguous,
        })
    if not buckets:
        base["results"] = []
        base["columns"] = ["period"]
        base["metrics"] = [m["label"] for m in plan["metrics"]]
        base["period"] = period
        return base

    keys = _fill_period_gaps(sorted(buckets.keys()), period)
    results = []
    prev: dict[str, float | None] = {}
    for key in keys:
        entry: dict[str, Any] = {"period": key, "_rows": len(buckets.get(key, []))}
        for m in plan["metrics"]:
            value = _aggregate(buckets[key], m, stats) if key in buckets else (0 if m["agg"] in ("sum", "count", "count_unique") else None)
            entry[m["label"]] = _round(value)
            # Period-over-period change for the first metric.
            if m is plan["metrics"][0]:
                p = prev.get(m["label"])
                v = coerce_float(value)
                entry["change_pct"] = _round((v - p) / abs(p)) if (p not in (None, 0) and v is not None) else None
                prev[m["label"]] = v
        results.append(entry)

    results, truncated = _truncate(results, MAX_GROUP_ROWS, base["warnings"])
    base["results"] = results
    base["period"] = period
    base["date_column"] = date_col
    base["metrics"] = [m["label"] for m in plan["metrics"]]
    base["columns"] = ["period"] + base["metrics"] + ["change_pct"]
    base["truncated"] = truncated
    base["metric_definitions"] = plan["metrics"]
    _emit_numeric_warnings(stats, base["warnings"])
    return base


def _op_compare(plan: dict, tables: dict) -> dict:
    table = _select_table(plan, tables)
    base = _envelope(plan, table, "comparison")
    rows = _filter_rows(table.rows, plan["filters"], base["warnings"])
    base["filtered_rows"] = len(rows)
    stats: dict = {}
    cmp = plan["compare"]
    column, left, right = cmp["column"], cmp["left"], cmp["right"]

    left_rows = [r for r in rows if _matches(r.get(column), "eq", left)]
    right_rows = [r for r in rows if _matches(r.get(column), "eq", right)]
    if not left_rows:
        base["warnings"].append({"code": "compare_side_empty", "message": f"No rows where {column} = {left!r}.", "side": "left"})
    if not right_rows:
        base["warnings"].append({"code": "compare_side_empty", "message": f"No rows where {column} = {right!r}.", "side": "right"})

    results = []
    for m in plan["metrics"]:
        lv = _round(_aggregate(left_rows, m, stats))
        rv = _round(_aggregate(right_rows, m, stats))
        lf, rf = coerce_float(lv), coerce_float(rv)
        diff = _round(rf - lf) if (lf is not None and rf is not None) else None
        pct = _round((rf - lf) / abs(lf)) if (lf not in (None, 0) and rf is not None) else None
        results.append({
            "metric": m["label"],
            "left": lv,
            "right": rv,
            "difference": diff,
            "change_pct": pct,
        })

    base["results"] = results
    base["compare"] = {"column": column, "left": str(left), "right": str(right), "left_rows": len(left_rows), "right_rows": len(right_rows)}
    base["metrics"] = [m["label"] for m in plan["metrics"]]
    base["columns"] = ["metric", "left", "right", "difference", "change_pct"]
    base["metric_definitions"] = plan["metrics"]
    _emit_numeric_warnings(stats, base["warnings"])
    return base


def _op_distribution(plan: dict, tables: dict) -> dict:
    table = _select_table(plan, tables)
    base = _envelope(plan, table, "distribution")
    rows = _filter_rows(table.rows, plan["filters"], base["warnings"])
    base["filtered_rows"] = len(rows)
    column = plan["group_by"][0]
    cells = [r.get(column) for r in rows]

    # Numeric columns get a histogram; everything else a frequency table.
    nc = NumericColumn(cells)
    non_null = len(cells) - nc.nulls
    numeric_share = len(nc.values) / non_null if non_null else 0
    if non_null and numeric_share >= 0.9 and len({round(v, 9) for v in nc.values}) > DISTRIBUTION_BINS:
        lo, hi = min(nc.values), max(nc.values)
        width = (hi - lo) / DISTRIBUTION_BINS if hi > lo else 1.0
        counts = [0] * DISTRIBUTION_BINS
        for v in nc.values:
            idx = min(int((v - lo) / width), DISTRIBUTION_BINS - 1)
            counts[idx] += 1
        results = []
        for i, c in enumerate(counts):
            b_lo, b_hi = lo + i * width, lo + (i + 1) * width
            results.append({
                "bucket": f"{_round(b_lo):g} – {_round(b_hi):g}",
                "bucket_start": _round(b_lo),
                "bucket_end": _round(b_hi),
                "count": c,
                "share": _round(c / len(nc.values)) if nc.values else 0,
            })
        base["results"] = results
        base["mode"] = "histogram"
        base["columns"] = ["bucket", "count", "share"]
        base["summary"] = {
            "count": len(nc.values), "min": _round(lo), "max": _round(hi),
            "mean": _round(_mean(nc.values)), "median": _round(_median(nc.values)), "std": _round(_std(nc.values)),
        }
        if nc.dropped:
            base["warnings"].append({
                "code": "non_numeric_values_dropped",
                "message": f"{nc.dropped} value(s) in '{column}' could not be read as numbers and were excluded.",
                "column": column, "rows": nc.dropped,
            })
    else:
        counter: dict[str, int] = {}
        for c in cells:
            key = "(blank)" if is_null_like(c) else str(c).strip()
            counter[key] = counter.get(key, 0) + 1
        items = sorted(({"value": k, "count": v} for k, v in counter.items()), key=lambda r: -r["count"])
        total = len(cells)
        for it in items:
            it["share"] = _round(it["count"] / total) if total else 0
        distinct = len(items)
        if distinct > plan["limit"]:
            head = items[: plan["limit"]]
            rest = items[plan["limit"]:]
            other = sum(r["count"] for r in rest)
            head.append({"value": f"Other ({len(rest)} values)", "count": other, "share": _round(other / total) if total else 0, "is_other": True})
            items = head
            base["truncated"] = True
        base["results"] = items
        base["mode"] = "frequency"
        base["columns"] = ["value", "count", "share"]
        base["distinct"] = distinct
    base["column"] = column
    base["total"] = len(cells)
    return base


# Allow-list mapping operation -> callable.
OPERATIONS = {
    "describe": _op_describe,
    "aggregate": _op_aggregate,
    "top": _op_top,
    "time_series": _op_time_series,
    "compare": _op_compare,
    "distribution": _op_distribution,
}


def get_executor(operation: str):
    if operation not in OPERATIONS:
        raise UnsupportedOperationError(f"Operation {operation!r} is not supported.")
    return _Executor(operation)


class _Executor:
    __slots__ = ("operation",)

    def __init__(self, operation: str):
        self.operation = operation

    def execute(self, plan: dict, tables: dict) -> dict:
        return OPERATIONS[self.operation](plan, tables)
