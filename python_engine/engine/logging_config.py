"""Logging setup for the engine.

Logs MUST go to stderr: stdout is reserved for the JSON protocol consumed by
the Node.js backend.
"""
from __future__ import annotations

import logging
import os
import sys


def configure_logging() -> None:
    root = logging.getLogger()
    if root.handlers:
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s - %(message)s"))
    root.addHandler(handler)
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    root.setLevel(getattr(logging, level, logging.INFO))


def get_logger(name: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(name)
