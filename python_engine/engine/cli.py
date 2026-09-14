"""CLI entry point for the Python analysis engine.

The Node.js backend invokes this process with a JSON RPC-style command:

    python -m engine.cli inspect --file <path>
    python -m engine.cli preview --file <path> [--sheet <name>] [--offset N] [--limit N]
    python -m engine.cli analyze --request <json-file> [--out <out-json>]

STDERR carries logs; STDOUT carries the JSON result. Exit code 0 on success,
non-zero with a machine-parseable error block on failure.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

from engine.errors import EngineError
from engine.logging_config import configure_logging

log = logging.getLogger("engine.cli")


def _read_request(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError as exc:
        raise EngineError(f"Request file not found: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise EngineError(f"Request file is not valid JSON: {exc}") from exc


def _write_result(payload: dict, out_path: str | None) -> None:
    blob = json.dumps(payload, default=str)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(blob)
    else:
        sys.stdout.write(blob)
        sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    configure_logging()
    parser = argparse.ArgumentParser(prog="ai-ba-engine")
    sub = parser.add_subparsers(dest="command", required=True)

    p_inspect = sub.add_parser("inspect")
    p_inspect.add_argument("--file", required=True)
    p_inspect.add_argument("--out", default=None)

    p_preview = sub.add_parser("preview")
    p_preview.add_argument("--file", required=True)
    p_preview.add_argument("--sheet", default=None)
    p_preview.add_argument("--offset", type=int, default=0)
    p_preview.add_argument("--limit", type=int, default=50)
    p_preview.add_argument("--out", default=None)

    p_analyze = sub.add_parser("analyze")
    p_analyze.add_argument("--request", required=True)
    p_analyze.add_argument("--out", default=None)

    args = parser.parse_args(argv)

    try:
        if args.command == "inspect":
            from engine.cli_handlers import handle_inspect

            payload = handle_inspect(args.file)
        elif args.command == "preview":
            from engine.cli_handlers import handle_preview

            payload = handle_preview(args.file, args.sheet, args.offset, args.limit)
        elif args.command == "analyze":
            from engine.cli_handlers import handle_analyze

            payload = handle_analyze(_read_request(args.request))
        else:  # pragma: no cover
            raise EngineError(f"Unknown command: {args.command}")
    except EngineError as exc:
        # Machine-parseable safe error. The message is written for end users.
        log.warning("engine error: %s: %s", exc.__class__.__name__, exc)
        _write_result({"ok": False, "error": {"code": exc.__class__.__name__, "message": str(exc)}}, args.out)
        return 1
    except MemoryError:
        _write_result({"ok": False, "error": {"code": "ResourceError", "message": "The file is too large to analyze in memory."}}, args.out)
        return 1
    except Exception:  # noqa: BLE001 - last-resort boundary
        log.exception("unhandled engine failure")
        _write_result(
            {"ok": False, "error": {"code": "EngineError", "message": "The analysis engine could not complete the requested operation."}},
            args.out,
        )
        return 1

    _write_result({"ok": True, "data": payload}, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
