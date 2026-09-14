"""Deterministic normalization primitives.

All functions are pure and repeatable. Ambiguity is never silently resolved;
functions that may be indeterminate expose a ``confident`` flag so the caller
can decide whether user confirmation is required.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_case(value: str, mode: str = "auto") -> str:
    if mode == "lower":
        return value.lower()
    if mode == "upper":
        return value.upper()
    if mode == "title":
        return value.title()
    return value


# Currency symbols and codes commonly extracted from labels/columns.
CURRENCY_SYMBOLS = "$€£¥₹₩₫₦₽"
CURRENCY_CODES = [
    "USD", "EUR", "GBP", "JPY", "INR", "KRW", "AUD", "CAD", "CHF", "CNY",
    "SEK", "NOK", "DKK", "NZD", "HKD", "SGD", "TWD", "THB", "MXN", "BRL",
    "ZAR", "RUB", "TRY", "IDR", "PHP", "MYR", "VND", "NGN", "PLN", "RON",
    "HUF", "CZK", "ILS", "CLP", "COP", "PEN", "ARS", "EGP",
]
CURRENCY_TOKENS = list(CURRENCY_SYMBOLS) + CURRENCY_CODES

_CURRENCY_CODE_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(c) for c in CURRENCY_CODES) + r")\b",
    re.IGNORECASE,
)
_CURRENCY_SYMBOL_PATTERN = re.compile("[" + re.escape(CURRENCY_SYMBOLS) + "]")


def strip_currency(value: str) -> str:
    """Remove currency codes and symbols from a string (word boundaries do not
    apply to symbols, so they are handled with a separate character class)."""
    text = _CURRENCY_CODE_PATTERN.sub("", value)
    text = _CURRENCY_SYMBOL_PATTERN.sub("", text)
    return normalize_whitespace(text)


# Unambiguous formats: year-first, or month spelled out.
_UNAMBIGUOUS_DATE_FORMATS = [
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y.%m.%d",
    "%Y%m%d",
    "%b %d, %Y",
    "%B %d, %Y",
    "%b %d %Y",
    "%B %d %Y",
    "%d %b %Y",
    "%d %B %Y",
    "%d-%b-%Y",
    "%d-%b-%y",
    "%b %Y",
    "%B %Y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m",
]

# Day/month order is ambiguous for numeric slash and dash formats. We try
# day-first and month-first; when both parse and give different dates the
# result is flagged as not confident.
_DAY_FIRST_FORMATS = ["%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"]
_MONTH_FIRST_FORMATS = ["%m/%d/%Y", "%m-%d-%Y", "%m.%d.%Y", "%m/%d/%y", "%m-%d-%y", "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S"]

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "june": 6, "july": 7,
    "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}

_QUARTER_PATTERN = re.compile(r"^(?:q([1-4])[\s\-/]*(\d{4})|(\d{4})[\s\-/]*q([1-4]))$", re.IGNORECASE)


@dataclass
class ParsedDate:
    value: str
    iso: str
    confident: bool
    format: str | None = None
    granularity: str = "day"  # day | month | quarter | year


def _try_formats(text: str, formats: list[str]) -> tuple[datetime, str] | None:
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt), fmt
        except ValueError:
            continue
    return None


def parse_date(value: Any, strict: bool = False, day_first: bool | None = None) -> ParsedDate | None:
    """Parse a value into an ISO date.

    ``day_first`` resolves numeric slash/dash ambiguity when the caller has
    established the convention of the column. When it is None and both orders
    are valid, the day-first reading is returned with ``confident=False``.
    ``strict`` disables Excel-serial interpretation of bare numbers.
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        return ParsedDate(str(value), value.strftime("%Y-%m-%d"), True, "native")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 20000 < value < 80000 and not strict:
            try:
                d = datetime(1899, 12, 30) + timedelta(days=int(value))
                return ParsedDate(str(value), d.strftime("%Y-%m-%d"), True, "excel-serial")
            except (OverflowError, ValueError):
                return None
        return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None

    try:
        d = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return ParsedDate(text, d.strftime("%Y-%m-%d"), True, "iso")
    except ValueError:
        pass

    hit = _try_formats(text, _UNAMBIGUOUS_DATE_FORMATS)
    if hit:
        d, fmt = hit
        gran = "month" if fmt in ("%b %Y", "%B %Y", "%Y-%m") else "day"
        return ParsedDate(text, d.strftime("%Y-%m-%d"), True, fmt, gran)

    df = _try_formats(text, _DAY_FIRST_FORMATS)
    mf = _try_formats(text, _MONTH_FIRST_FORMATS)
    if df and mf:
        if df[0] == mf[0]:
            return ParsedDate(text, df[0].strftime("%Y-%m-%d"), True, df[1])
        if day_first is True:
            return ParsedDate(text, df[0].strftime("%Y-%m-%d"), True, df[1])
        if day_first is False:
            return ParsedDate(text, mf[0].strftime("%Y-%m-%d"), True, mf[1])
        return ParsedDate(text, df[0].strftime("%Y-%m-%d"), False, df[1])
    if df:
        return ParsedDate(text, df[0].strftime("%Y-%m-%d"), True, df[1])
    if mf:
        return ParsedDate(text, mf[0].strftime("%Y-%m-%d"), True, mf[1])

    q = _QUARTER_PATTERN.match(text)
    if q:
        quarter = int(q.group(1) or q.group(4))
        year = int(q.group(2) or q.group(3))
        month = (quarter - 1) * 3 + 1
        return ParsedDate(text, f"{year:04d}-{month:02d}-01", True, "quarter", "quarter")

    if re.fullmatch(r"(19|20)\d{2}", text):
        return ParsedDate(text, f"{text}-01-01", True, "year", "year")

    lowered = text.lower()
    if lowered in _MONTHS:
        return ParsedDate(text, f"{_MONTHS[lowered]:02d}", False, "month-only", "month")
    return None


def infer_day_first(samples: list[Any]) -> bool | None:
    """Look at a column's values and decide whether slash dates are day-first.

    Returns True/False when any sample proves the order (a component > 12),
    otherwise None.
    """
    for v in samples:
        if not isinstance(v, str):
            continue
        m = re.match(r"^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})", v)
        if not m:
            continue
        a, b = int(m.group(1)), int(m.group(2))
        if a > 12 and b <= 12:
            return True
        if b > 12 and a <= 12:
            return False
    return None


@dataclass
class ParsedNumber:
    value: float
    confident: bool
    raw: str
    currency: str | None = None
    is_percent: bool = False


def _like_iso_date(text: str) -> bool:
    return bool(re.fullmatch(r"\d{4}[-/.]\d{1,2}[-/.]\d{1,2}", text))


def _like_slash_date(text: str) -> bool:
    return bool(re.fullmatch(r"\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}", text))


_TRAILING_CODE = re.compile(
    r"(?:^|\s)(" + "|".join(CURRENCY_CODES) + r")\s*$",
    re.IGNORECASE,
)
_LEADING_CODE = re.compile(r"^(" + "|".join(CURRENCY_CODES) + r")\s+", re.IGNORECASE)
_MAGNITUDE = {"k": 1e3, "m": 1e6, "mn": 1e6, "mm": 1e6, "b": 1e9, "bn": 1e9}


def _resolve_separators(cleaned: str) -> str | None:
    """Turn a digit string with ',' and/or '.' into a plain decimal string."""
    has_comma = "," in cleaned
    has_dot = "." in cleaned

    if has_comma and has_dot:
        # Whichever separator appears last is the decimal separator.
        if cleaned.rfind(",") > cleaned.rfind("."):
            return cleaned.replace(".", "").replace(",", ".")
        return cleaned.replace(",", "")

    if has_comma:
        parts = cleaned.split(",")
        # Thousands grouping: every group after the first is exactly 3 digits
        # (western) or the Indian 2-digit lakh/crore grouping ending in 3.
        tail = parts[1:]
        if parts[0].lstrip("-").isdigit() and tail and all(p.isdigit() for p in tail):
            if all(len(p) == 3 for p in tail):
                return cleaned.replace(",", "")
            if len(tail[-1]) == 3 and all(len(p) == 2 for p in tail[:-1]):
                return cleaned.replace(",", "")
        # Single comma with 1-2 trailing digits: decimal comma (European).
        if len(parts) == 2 and len(parts[1]) in (1, 2) and parts[1].isdigit():
            return cleaned.replace(",", ".")
        return None

    if has_dot:
        parts = cleaned.split(".")
        # "1.234.567" -> dots are thousands separators.
        if len(parts) > 2 and all(p.isdigit() for p in parts[1:]) and all(len(p) == 3 for p in parts[1:]):
            return cleaned.replace(".", "")
        if len(parts) > 2:
            return None
        return cleaned
    return cleaned


def parse_number(value: Any, strict: bool = False) -> ParsedNumber | None:
    """Parse a numeric-looking value.

    Handles thousands separators (1,234,567 / 1.234.567 / 12,34,567), decimal
    commas, accounting negatives "(5)", currency symbols and codes, percent
    signs (returned as fraction, ``is_percent=True``) and k/m/bn suffixes.
    Returns None for anything not confidently numeric.
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return ParsedNumber(float(value), True, str(value))
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if _like_iso_date(text) or _like_slash_date(text):
        return None

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1].strip()

    currency = None
    normalized = text.replace(" ", " ").replace("–", "-").replace("—", "-").replace("−", "-")

    m = _TRAILING_CODE.search(normalized)
    if m:
        currency = m.group(1).upper()
        normalized = normalized[: m.start()].strip()
    m = _LEADING_CODE.match(normalized)
    if m and currency is None:
        currency = m.group(1).upper()
        normalized = normalized[m.end():].strip()

    sign = ""
    if normalized.startswith("-") or normalized.startswith("+"):
        sign = normalized[0]
        normalized = normalized[1:].strip()

    symbol_match = re.match(r"^\s*([" + re.escape(CURRENCY_SYMBOLS) + r"])", normalized)
    if symbol_match:
        currency = currency or symbol_match.group(1)
        normalized = normalized[symbol_match.end():].strip()
    else:
        trailing_symbol = re.search(r"([" + re.escape(CURRENCY_SYMBOLS) + r"])\s*$", normalized)
        if trailing_symbol:
            currency = currency or trailing_symbol.group(1)
            normalized = normalized[: trailing_symbol.start()].strip()

    if not sign and (normalized.startswith("-") or normalized.startswith("+")):
        sign = normalized[0]
        normalized = normalized[1:].strip()

    is_percent = False
    if normalized.endswith("%"):
        is_percent = True
        normalized = normalized[:-1].strip()

    multiplier = 1.0
    mag = re.search(r"([a-zA-Z]{1,2})$", normalized)
    if mag and mag.group(1).lower() in _MAGNITUDE:
        multiplier = _MAGNITUDE[mag.group(1).lower()]
        normalized = normalized[: mag.start()].strip()

    cleaned = re.sub(r"[ \t]+", "", normalized)
    if not cleaned or cleaned in {"-", "--", ".", ","}:
        return None
    if not re.fullmatch(r"[\d.,]+(?:[eE][-+]?\d+)?", cleaned):
        return None

    resolved = _resolve_separators(cleaned)
    if resolved is None:
        return None

    try:
        num = float(Decimal(resolved))
    except (InvalidOperation, ValueError):
        return None

    num *= multiplier
    if is_percent:
        num /= 100.0
    if negative or sign == "-":
        num = -num
    return ParsedNumber(num, True, value.strip(), currency, is_percent)


@dataclass
class ParsedUnit:
    value: float
    unit: str
    confident: bool


_UNITS = [
    (re.compile(r"\bkilograms?\b"), "kg"),
    (re.compile(r"\bkgs?\b"), "kg"),
    (re.compile(r"\bgrams?\b"), "g"),
    (re.compile(r"\blit(?:re|er)s?\b"), "L"),
    (re.compile(r"\bml\b"), "mL"),
    (re.compile(r"\bcm\b"), "cm"),
    (re.compile(r"\bmet(?:er|re)s?\b"), "m"),
    (re.compile(r"\bmm\b"), "mm"),
    (re.compile(r"\binch(?:es)?\b|\bin\b"), "in"),
    (re.compile(r"\bfeet\b|\bft\b"), "ft"),
    (re.compile(r"\byards?\b|\byds?\b"), "yd"),
    (re.compile(r"\bmiles?\b|\bmi\b"), "mi"),
    (re.compile(r"\bhours?\b|\bhrs?\b|\bhr\b"), "h"),
    (re.compile(r"\bminutes?\b|\bmins?\b|\bmin\b"), "min"),
    (re.compile(r"\bseconds?\b|\bsecs?\b|\bsec\b|\bs\b"), "s"),
    (re.compile(r"\bpieces?\b|\bpcs\b"), "pcs"),
    (re.compile(r"\bunits?\b"), "units"),
]


def parse_unit(value: Any) -> ParsedUnit | None:
    if not isinstance(value, str):
        return None
    lowered = value.strip().lower()
    for pattern, unit in _UNITS:
        m = pattern.search(lowered)
        if not m:
            continue
        num_part = lowered[: m.start()].strip()
        parsed = parse_number(num_part)
        if parsed and parsed.confident and parsed.currency is None:
            return ParsedUnit(parsed.value, unit, True)
    return None


_DIRT = re.compile(r"[^\w\s\-.,%/()" + re.escape(CURRENCY_SYMBOLS) + r"]")

# Placeholder tokens that mean "missing" in business spreadsheets.
NULL_TOKENS = {"", "-", "--", "n/a", "na", "null", "none", "nil", "#n/a", "#value!", "#ref!", "#div/0!", "nan", "tbd", "?"}


def is_null_like(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and value != value:  # NaN
        return True
    if isinstance(value, str):
        return value.strip().lower() in NULL_TOKENS
    return False


def is_dirty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, (int, float, bool, datetime)):
        return False
    text = str(value)
    return bool(_DIRT.search(text))
