import csv
import json
import os
import tempfile
from pathlib import Path

import pytest

from engine.cli import main as cli_main
from engine.cli_handlers import handle_analyze, handle_inspect, handle_preview
from engine.errors import InvalidPlanError, UnsupportedOperationError


def _make_csv(rows: list[list], suffix=".csv") -> Path:
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.close()
    with open(tmp.name, "w", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(rows)
    return Path(tmp.name)


SALES = [
    ["Region", "Customer", "Sales", "Date", "Status"],
    ["North", "Acme", "1,500,000", "2024-01-05", "won"],
    ["South", "Beta", "$2,000", "2024-02-01", "won"],
    ["North", "Gamma", "", "2024-02-20", "lost"],
    ["West", "Delta", "3,000", "2024-03-01", "won"],
    ["", "Echo", "abc", "not a date", "lost"],
]


def _run(plan: dict, rows=SALES) -> dict:
    path = _make_csv(rows)
    return handle_analyze({"datasets": [{"sheet_name": "default", "path": str(path)}], "plan": plan})


def _codes(result: dict) -> set:
    return {w["code"] for w in result["warnings"]}


# ---- inspect / preview ----------------------------------------------------

def test_inspect_csv():
    path = _make_csv([["Customer", "Amount", "Date"], ["Acme", 100, "2024-01-01"], ["Beta", 250.5, "2024-01-15"]])
    result = handle_inspect(str(path))
    sheet = result["sheets"][0]
    assert sheet["row_count"] == 2
    types = {c["name"]: c["data_type"] for c in sheet["columns"]}
    assert types == {"Customer": "text", "Amount": "number", "Date": "date"}
    amount = next(c for c in sheet["columns"] if c["name"] == "Amount")
    assert amount["stats"]["sum"] == 350.5
    assert len(sheet["preview"]) == 2


def test_inspect_skips_title_rows_and_detects_semicolon():
    tmp = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    tmp.close()
    Path(tmp.name).write_text("Quarterly report;;\n;;\nRegion;Sales;Date\nNorth;10;2024-01-01\nSouth;20;2024-02-01\n", encoding="utf-8")
    result = handle_inspect(tmp.name)
    sheet = result["sheets"][0]
    assert [c["name"] for c in sheet["columns"]] == ["Region", "Sales", "Date"]
    assert sheet["row_count"] == 2
    assert sheet["header_row"] == 2


def test_preview_pagination():
    path = _make_csv([["A"]] + [[i] for i in range(100)])
    page = handle_preview(str(path), None, offset=90, limit=50)
    assert page["total_rows"] == 100
    assert len(page["rows"]) == 10
    assert page["rows"][0]["A"] == "90"


# ---- aggregate ------------------------------------------------------------

def test_aggregate_sum_handles_thousand_separators_and_reports_dropped():
    result = _run({"operation": "aggregate", "metrics": [{"agg": "sum", "column": "Sales", "label": "total"}]})
    assert result["kind"] == "scalar_aggregation"
    assert result["results"]["total"] == 1_505_000.0
    assert "non_numeric_values_dropped" in _codes(result)
    assert "null_values_ignored" in _codes(result)


def test_aggregate_grouped_orders_and_marks_blank_groups():
    result = _run({"operation": "aggregate", "group_by": ["Region"], "metrics": [{"agg": "sum", "column": "Sales"}]})
    assert result["kind"] == "grouped_aggregation"
    rows = result["results"]
    assert rows[0]["Region"] == "North" and rows[0]["sum_sales"] == 1_500_000.0
    assert any(r["Region"] == "(blank)" for r in rows)
    assert "null_group_values" in _codes(result)
    assert result["columns"] == ["Region", "sum_sales"]


def test_aggregate_without_metrics_counts_rows():
    result = _run({"operation": "aggregate", "group_by": ["Status"]})
    by_status = {r["Status"]: r["count_rows"] for r in result["results"]}
    assert by_status == {"won": 3, "lost": 2}


def test_column_resolution_is_forgiving_but_unknown_columns_fail():
    result = _run({"operation": "aggregate", "metrics": [{"agg": "avg", "column": " sales "}]})
    assert result["results"]["avg_sales"] == pytest.approx(1_505_000 / 3)
    with pytest.raises(InvalidPlanError) as exc:
        _run({"operation": "aggregate", "metrics": [{"agg": "sum", "column": "Revenue"}]})
    assert "Revenue" in str(exc.value) and "Sales" in str(exc.value)


def test_filters():
    result = _run({
        "operation": "aggregate",
        "filters": [{"column": "Status", "op": "eq", "value": "won"}, {"column": "Sales", "op": "gte", "value": 2500}],
        "metrics": [{"agg": "count", "column": "Customer"}],
    })
    assert result["results"]["count_customer"] == 2
    assert result["filtered_rows"] == 2


def test_filter_between_dates_and_matched_nothing_warning():
    result = _run({
        "operation": "aggregate",
        "filters": [{"column": "Date", "op": "between", "value": ["2024-02-01", "2024-02-28"]}],
        "metrics": [{"agg": "count", "column": None}],
    })
    assert result["results"]["count_rows"] == 2
    empty = _run({"operation": "aggregate", "filters": [{"column": "Region", "op": "eq", "value": "Mars"}]})
    assert "filter_matched_nothing" in _codes(empty)


def test_bad_filter_op_and_bad_agg_rejected():
    with pytest.raises(InvalidPlanError):
        _run({"operation": "aggregate", "filters": [{"column": "Region", "op": "regex", "value": ".*"}]})
    with pytest.raises(InvalidPlanError):
        _run({"operation": "aggregate", "metrics": [{"agg": "variance", "column": "Sales"}]})


# ---- top ------------------------------------------------------------------

def test_top_uses_metrics_from_prompt_shape():
    result = _run({"operation": "top", "group_by": ["Region"], "metrics": [{"agg": "sum", "column": "Sales"}], "limit": 2})
    assert result["kind"] == "top_n"
    assert [r["Region"] for r in result["results"]] == ["North", "West"]
    assert result["results"][0]["rank"] == 1
    assert result["results"][0]["share"] == pytest.approx(1_500_000 / 1_505_000)
    assert result["total_groups"] == 4 and result["truncated"] is True


def test_top_ascending_and_avg():
    result = _run({"operation": "top", "group_by": ["Region"], "metrics": [{"agg": "avg", "column": "Sales"}], "order": "asc", "limit": 1,
                   "filters": [{"column": "Region", "op": "not_null"}]})
    assert result["results"][0]["Region"] == "South"


# ---- time series ----------------------------------------------------------

def test_time_series_monthly_with_gap_fill_and_change():
    rows = SALES + [["East", "Foxtrot", "500", "2024-05-10", "won"]]
    result = _run({"operation": "time_series", "date_column": "Date", "metrics": [{"agg": "sum", "column": "Sales"}], "period": "month"}, rows)
    periods = [r["period"] for r in result["results"]]
    assert periods == ["2024-01", "2024-02", "2024-03", "2024-04", "2024-05"]
    assert result["results"][3]["sum_sales"] == 0
    assert result["results"][1]["change_pct"] == pytest.approx((2000 - 1_500_000) / 1_500_000)
    assert "unparseable_dates_dropped" in _codes(result)


def test_time_series_week_quarter_year_keys():
    from engine.analysis.executor import _period_key

    assert _period_key("2024-03-15", "week") == "2024-W11"
    assert _period_key("2024-03-15", "quarter") == "2024-Q1"
    assert _period_key("2024-03-15", "year") == "2024"
    assert _period_key("2024-03-15", "day") == "2024-03-15"


def test_time_series_requires_date_column():
    with pytest.raises(InvalidPlanError):
        _run({"operation": "time_series", "metrics": [{"agg": "sum", "column": "Sales"}]})


# ---- compare --------------------------------------------------------------

def test_compare_computes_difference():
    result = _run({
        "operation": "compare",
        "compare": {"column": "Region", "left": "North", "right": "West"},
        "metrics": [{"agg": "sum", "column": "Sales"}, {"agg": "count", "column": None}],
    })
    assert result["kind"] == "comparison"
    by_metric = {r["metric"]: r for r in result["results"]}
    assert by_metric["sum_sales"]["left"] == 1_500_000.0
    assert by_metric["sum_sales"]["right"] == 3000.0
    assert by_metric["sum_sales"]["difference"] == -1_497_000.0
    assert by_metric["count_rows"]["left"] == 2


def test_compare_legacy_shape_and_missing_side():
    result = _run({"operation": "compare", "group_by": ["Region"], "metric_column": "Sales", "agg": "sum", "left_value": "North", "right_value": "Mars"})
    assert result["compare"]["right_rows"] == 0
    assert "compare_side_empty" in _codes(result)
    with pytest.raises(InvalidPlanError):
        _run({"operation": "compare", "group_by": ["Region"], "metrics": [{"agg": "sum", "column": "Sales"}]})


# ---- distribution ---------------------------------------------------------

def test_distribution_frequency_with_group_by_list_does_not_crash():
    result = _run({"operation": "distribution", "group_by": ["Status"]})
    assert result["kind"] == "distribution" and result["mode"] == "frequency"
    assert result["results"][0] == {"value": "won", "count": 3, "share": 0.6}


def test_distribution_other_bucket_and_histogram():
    rows = [["Cat", "Val"]] + [[f"c{i}", i * 10] for i in range(30)]
    freq = _run({"operation": "distribution", "column": "Cat", "limit": 5}, rows)
    assert len(freq["results"]) == 6 and freq["results"][-1]["is_other"]
    assert freq["truncated"] is True
    hist = _run({"operation": "distribution", "column": "Val"}, rows)
    assert hist["mode"] == "histogram"
    assert sum(r["count"] for r in hist["results"]) == 30
    assert hist["summary"]["min"] == 0 and hist["summary"]["max"] == 290


# ---- describe -------------------------------------------------------------

def test_describe_has_kind_and_profiles():
    result = _run({"operation": "describe"})
    assert result["kind"] == "describe"
    assert result["results"]["rows"] == 5
    assert len(result["results"]["column_profiles"]) == 5


# ---- safety ---------------------------------------------------------------

def test_unsupported_operation():
    with pytest.raises(UnsupportedOperationError):
        _run({"operation": "__import__('os').system('id')", "metrics": []})


def test_cli_json_protocol_on_error_and_success(tmp_path):
    path = _make_csv(SALES)
    req = tmp_path / "req.json"
    out = tmp_path / "out.json"
    req.write_text(json.dumps({"datasets": [{"sheet_name": "default", "path": str(path)}], "plan": {"operation": "nope"}}))
    assert cli_main(["analyze", "--request", str(req), "--out", str(out)]) == 1
    payload = json.loads(out.read_text())
    assert payload["ok"] is False and payload["error"]["code"] == "UnsupportedOperationError"

    req.write_text(json.dumps({"datasets": [{"sheet_name": "default", "path": str(path)}], "plan": {"operation": "describe"}}))
    assert cli_main(["analyze", "--request", str(req), "--out", str(out)]) == 0
    assert json.loads(out.read_text())["ok"] is True


def test_cache_roundtrip(tmp_path, monkeypatch):
    from dataclasses import replace

    from engine import file_reader

    monkeypatch.setattr(file_reader, "settings", replace(file_reader.settings, storage_path=str(tmp_path)))
    path = _make_csv(SALES)
    first = file_reader.read_file(path)
    cache_files = list((tmp_path / "cache").glob("*.pkl"))
    assert len(cache_files) == 1
    second = file_reader.read_file(path)
    assert second["default"].rows == first["default"].rows
    # Modifying the file invalidates the cache key.
    os.utime(path, (1, 1))
    with open(path, "a", newline="") as fh:
        csv.writer(fh).writerow(["North", "Zulu", "1", "2024-06-01", "won"])
    third = file_reader.read_file(path)
    assert len(third["default"].rows) == len(first["default"].rows) + 1
