from __future__ import annotations

import os
from dataclasses import dataclass


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    storage_path: str
    max_file_size: int
    max_files_per_analysis: int
    max_rows: int
    excerpt_rows: int = 100
    sample_rows: int = 50


def load_settings() -> Settings:
    return Settings(
        storage_path=os.getenv("STORAGE_PATH", "./storage"),
        max_file_size=_int_env("MAX_FILE_SIZE", 104857600),
        max_files_per_analysis=_int_env("MAX_FILES_PER_ANALYSIS", 20),
        max_rows=_int_env("MAX_ROWS", 1_000_000),
    )


settings = load_settings()
