from datetime import datetime

import pytest

from engine.normalization import (
    infer_day_first,
    is_null_like,
    normalize_whitespace,
    parse_date,
    parse_number,
    parse_unit,
    strip_currency,
)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("1234", 1234.0),
        ("1,234", 1234.0),
        ("1,234.50", 1234.5),
        ("1.234,50", 1234.5),
        ("1,234,567", 1234567.0),
        ("1,234,567.89", 1234567.89),
        ("1.234.567", 1234567.0),
        ("12,34,567", 1234567.0),  # Indian grouping
        ("12,5", 12.5),
        ("(5)", -5.0),
        ("-1,000.50", -1000.5),
        ("1e5", 100000.0),
        ("$ 1,200", 1200.0),
        ("€1.200,00", 1200.0),
        ("1200 USD", 1200.0),
        ("USD 1,200", 1200.0),
        ("-$500", -500.0),
        ("$-500", -500.0),
        ("2.5k", 2500.0),
        ("3M", 3_000_000.0),
        ("1.5bn", 1_500_000_000.0),
    ],
)
def test_parse_number_values(text, expected):
    r = parse_number(text)
    assert r is not None, text
    assert r.value == pytest.approx(expected)


def test_parse_number_percent():
    r = parse_number("10%")
    assert r.value == pytest.approx(0.10)
    assert r.is_percent
    assert parse_number("12.5 %").value == pytest.approx(0.125)


def test_parse_number_currency_detection():
    assert parse_number("$1,200.00").currency == "$"
    assert parse_number("1200 USD").currency == "USD"
    assert parse_number("1200 usd").currency == "USD"


@pytest.mark.parametrize("text", ["2024-01-01", "07/08/2024", "N/A", "abc", "", "-", "1,23,4", "1.2.3", "12a"])
def test_parse_number_rejects(text):
    assert parse_number(text) is None


def test_parse_date_unambiguous():
    assert parse_date("2024-01-15").iso == "2024-01-15"
    assert parse_date("15 Jan 2024").iso == "2024-01-15"
    assert parse_date("Jan 15, 2024").iso == "2024-01-15"
    assert parse_date("2024-03-01T10:00:00Z").iso == "2024-03-01"
    assert parse_date(datetime(2024, 3, 2)).iso == "2024-03-02"
    assert parse_date("20240315").iso == "2024-03-15"


def test_parse_date_slash_ambiguity_is_flagged():
    r = parse_date("07/08/2024")
    assert r.iso == "2024-08-07"
    assert r.confident is False
    assert parse_date("07/08/2024", day_first=False).iso == "2024-07-08"
    assert parse_date("07/08/2024", day_first=False).confident is True
    # Day > 12 removes ambiguity.
    assert parse_date("15/01/2024").confident is True
    assert parse_date("01/15/2024").iso == "2024-01-15"


def test_parse_date_quarters_years_months():
    assert parse_date("Q3 2024").iso == "2024-07-01"
    assert parse_date("2024-Q1").iso == "2024-01-01"
    assert parse_date("2024").granularity == "year"
    assert parse_date("March 2024").iso == "2024-03-01"
    assert parse_date("Mar").confident is False


def test_parse_date_excel_serial():
    r = parse_date(45000)
    assert r and r.confident and r.iso == "2023-03-15"
    assert parse_date(45000, strict=True) is None


def test_infer_day_first():
    assert infer_day_first(["01/02/2024", "25/03/2024"]) is True
    assert infer_day_first(["01/02/2024", "03/25/2024"]) is False
    assert infer_day_first(["01/02/2024", "03/04/2024"]) is None


def test_parse_unit():
    r = parse_unit("12 kg")
    assert r.value == 12.0
    assert r.unit == "kg"


def test_normalize_whitespace():
    assert normalize_whitespace("  hello    world  ") == "hello world"


def test_strip_currency():
    assert "USD" not in strip_currency("Total USD amount")
    assert strip_currency("$1,200") == "1,200"
    assert strip_currency("€ 50") == "50"


def test_is_null_like():
    for v in [None, "", "  ", "N/A", "null", "-", "#N/A", float("nan")]:
        assert is_null_like(v), v
    for v in [0, "0", "no", "a"]:
        assert not is_null_like(v), v
