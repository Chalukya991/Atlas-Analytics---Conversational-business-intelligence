from __future__ import annotations


class EngineError(Exception):
    """Base error for the analysis engine that maps to safe user-facing messages."""


class InvalidPlanError(EngineError):
    """The structured plan failed schema or semantic validation."""


class UnsupportedOperationError(EngineError):
    """The requested operation is not in the allow-list."""


class DataUnavailableError(EngineError):
    """Required data is missing or outside the accessible scope."""