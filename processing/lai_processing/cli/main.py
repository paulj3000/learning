"""`python -m lai_processing`: inspect processors, validate job requests, run jobs locally.

The CLI needs no AWS credentials, no Django, no database and no network. `run` executes a job
against an in-memory object store seeded from a local input file, then writes the result, the
completion event and any artifacts to an output directory. Filesystem and S3 storage adapters
and the queue-driven worker are Wave 2 (LAI-LAMBDA-003).

Exit codes:
  0  success (request valid; job succeeded)
  1  the job ran and did not succeed (result written)
  2  usage error (bad arguments)
  3  invalid job request (contract, job type, processor, profile or idempotency key)
  4  local file error (unreadable input or request, unwritable output)
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import IO, Any, Final

from ..contracts.codec import DEFAULT_MAX_MESSAGE_BYTES, decode_request, encode
from ..contracts.common import SCHEMA_VERSION
from ..contracts.identifiers import StoreName
from ..contracts.job_types import JOB_TYPES
from ..contracts.jobs import ProcessingJobRequest
from ..contracts.results import ResultStatus
from ..core.errors import ErrorCode, ProcessingError
from ..core.execution import ExecutionEngine
from ..core.idempotency import verify_idempotency_key
from ..core.limits import PLATFORM_CEILINGS, effective_limits
from ..core.registry import ProcessorRegistry, default_registry
from ..ports.telemetry import LoggingTelemetry, NullTelemetry
from ..testing.fakes import MemoryObjectStorage
from ..version import __version__

__all__ = ["EXIT_FILE_ERROR", "EXIT_INVALID", "EXIT_JOB_FAILED", "EXIT_OK", "EXIT_USAGE", "main"]

EXIT_OK: Final = 0
EXIT_JOB_FAILED: Final = 1
EXIT_USAGE: Final = 2
EXIT_INVALID: Final = 3
EXIT_FILE_ERROR: Final = 4

PROG: Final = "python -m lai_processing"


class _FileError(Exception):
    """A local file could not be read or written. The message names only the role of the file."""


def _pretty(value: Any) -> str:
    """Deterministic, human-readable JSON (sorted keys, two-space indent, ASCII)."""
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True, allow_nan=False) + "\n"


def _error_json(error: ProcessingError) -> dict[str, Any]:
    return {
        "code": error.code.value,
        "retry_class": error.retry_class.value,
        "message": error.safe_message,
        "details": dict(error.details),
    }


def _read_prefix(path: str, count: int, role: str) -> bytes:
    """Read at most `count` bytes, never the whole of an arbitrarily large file."""
    try:
        if path == "-":
            return sys.stdin.buffer.read(count)
        with open(path, "rb") as handle:
            return handle.read(count)
    except OSError:
        raise _FileError(f"cannot read the {role} file") from None


def _read_bounded(path: str, limit: int, role: str) -> bytes:
    """Read a file of at most `limit` bytes; a larger file is a file error."""
    data = _read_prefix(path, limit + 1, role)
    if len(data) > limit:
        raise _FileError(f"the {role} file exceeds {limit} bytes")
    return data


def _load_request(path: str, max_message_bytes: int) -> ProcessingJobRequest:
    # Read one byte past the message limit so the codec reports MESSAGE_TOO_LARGE itself.
    data = _read_prefix(path, max_message_bytes + 1, "request")
    return decode_request(data, max_bytes=max_message_bytes)


def _check_resolvable(request: ProcessingJobRequest, registry: ProcessorRegistry) -> dict[str, Any]:
    """Everything a worker would check before reading the input. Raises ProcessingError."""
    processor, profile = registry.resolve(request.job_type, request.profile)
    options = profile.resolve_options(request.options)
    key_ok = verify_idempotency_key(request) or verify_idempotency_key(
        request, processor_version=processor.version
    )
    if not key_ok:
        raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "idempotency_key"})
    limits = effective_limits(request.limits, PLATFORM_CEILINGS)
    return {
        "processor": processor.identity.to_dict(),
        "profile": profile.ref.to_dict(),
        "resolved_options": dict(options),
        "effective_limits": limits.to_dict(),
    }


def _cmd_processors_list(args: argparse.Namespace, out: IO[str]) -> int:
    listing = default_registry().describe()
    if args.json:
        out.write(_pretty(listing))
        return EXIT_OK
    for entry in listing:
        out.write(f"{entry['processor_id']} {entry['version']}\n")
        out.write(f"  job types: {', '.join(entry['job_types'])}\n")
        for profile in entry["profiles"]:
            out.write(f"  profile {profile['profile_id']} v{profile['version']}")
            names = ", ".join(sorted(profile["options"])) or "none"
            out.write(f" (options: {names})\n")
    return EXIT_OK


def _cmd_job_types_list(args: argparse.Namespace, out: IO[str]) -> int:
    registry = default_registry()
    served = {jt for p in registry.processors() for jt in p.job_types}
    rows = [
        {
            "job_type": spec.job_type,
            "category": spec.category,
            "requires_asset": spec.requires_asset,
            "requires_input": spec.requires_input,
            "subject_type": spec.subject_type,
            "owner_task": spec.owner_task,
            "processor_available": spec.job_type in served,
        }
        for spec in sorted(JOB_TYPES.values(), key=lambda s: s.job_type)
    ]
    if args.json:
        out.write(_pretty(rows))
        return EXIT_OK
    for row in rows:
        state = "available" if row["processor_available"] else "declared, no processor yet"
        out.write(f"{row['job_type']} ({row['owner_task']}): {state}\n")
    return EXIT_OK


def _cmd_validate(args: argparse.Namespace, out: IO[str]) -> int:
    try:
        request = _load_request(args.request, args.max_message_bytes)
        details = _check_resolvable(request, default_registry())
    except ProcessingError as error:
        out.write(_pretty({"valid": False, "error": _error_json(error)}))
        return EXIT_INVALID
    out.write(
        _pretty(
            {
                "valid": True,
                "job_id": request.job_id,
                "job_type": request.job_type,
                "namespace": request.namespace,
                "attempt_number": request.attempt_number,
                **details,
            }
        )
    )
    return EXIT_OK


def _write_outputs(output_dir: Path, files: dict[str, bytes]) -> None:
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        for relative, data in files.items():
            target = output_dir / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    except OSError:
        raise _FileError("cannot write to the output directory") from None


def _cmd_run(args: argparse.Namespace, out: IO[str], err: IO[str]) -> int:
    try:
        request = _load_request(args.request, args.max_message_bytes)
        registry = default_registry()
        _check_resolvable(request, registry)
    except ProcessingError as error:
        out.write(_pretty({"valid": False, "error": _error_json(error)}))
        return EXIT_INVALID

    storage = MemoryObjectStorage()
    if request.input is not None:
        if args.input_file is None:
            err.write("error: this job needs --input-file\n")
            return EXIT_USAGE
        limit = effective_limits(request.limits, PLATFORM_CEILINGS).max_input_bytes
        data = _read_bounded(args.input_file, limit, "input")
        storage.seed(
            request.input.ref,
            data,
            content_type=request.input.content_type,
            version_id=request.input.ref.version_id,
        )

    telemetry = LoggingTelemetry() if args.verbose else NullTelemetry()
    engine = ExecutionEngine(registry=registry, storage=storage, telemetry=telemetry)
    result = engine.execute(request)
    event = engine.complete(result, max_message_bytes=args.max_message_bytes)

    files: dict[str, bytes] = {
        "result.json": _pretty(result.to_dict()).encode("ascii"),
        "completion-event.json": _pretty(event.to_dict()).encode("ascii"),
    }
    for key in storage.keys(StoreName.ARTIFACTS):
        # Keys were validated when written; the last segment is `<logical id>.<extension>`.
        files[f"artifacts/{Path(key).name}"] = storage.objects[(StoreName.ARTIFACTS.value, key)][
            -1
        ].data

    if args.output_dir is not None:
        _write_outputs(Path(args.output_dir), files)
        summary = {
            "status": result.status.value,
            "verdict": result.verdict.value if result.verdict else None,
            "error_code": result.errors[0].code.value if result.errors else None,
            "output_dir": str(args.output_dir),
            "files": sorted(files),
        }
        out.write(_pretty(summary))
    else:
        out.write(_pretty(result.to_dict()))
    return EXIT_OK if result.status is ResultStatus.SUCCEEDED else EXIT_JOB_FAILED


def _cmd_encode(args: argparse.Namespace, out: IO[str]) -> int:
    """Print the canonical (compact) encoding of a valid request: what goes on the queue."""
    try:
        request = _load_request(args.request, args.max_message_bytes)
    except ProcessingError as error:
        out.write(_pretty({"valid": False, "error": _error_json(error)}))
        return EXIT_INVALID
    out.write(encode(request).decode("ascii") + "\n")
    return EXIT_OK


class _Parser(argparse.ArgumentParser):
    """argparse that raises instead of exiting, so `main` controls exit codes and streams."""

    def error(self, message: str) -> Any:  # type: ignore[override]
        raise _UsageError(message)


class _UsageError(Exception):
    pass


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(
        prog=PROG,
        description=(
            "Learning Adventure Island background processing: list processors, validate job "
            "requests and run jobs locally. Needs no AWS, Django, database or network."
        ),
        epilog="Exit codes: 0 ok, 1 job did not succeed, 2 usage, 3 invalid request, 4 file error.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"lai-processing {__version__} (contract schema {SCHEMA_VERSION})",
    )
    sub = parser.add_subparsers(dest="command", metavar="COMMAND", parser_class=_Parser)

    processors = sub.add_parser("processors", help="inspect registered processors")
    processors_sub = processors.add_subparsers(dest="action", metavar="ACTION")
    plist = processors_sub.add_parser("list", help="list processors and their profiles")
    plist.add_argument("--json", action="store_true", help="machine-readable output")

    job_types = sub.add_parser("job-types", help="inspect the job-type catalog")
    jt_sub = job_types.add_subparsers(dest="action", metavar="ACTION")
    jlist = jt_sub.add_parser("list", help="list declared job types")
    jlist.add_argument("--json", action="store_true", help="machine-readable output")

    def add_request(p: argparse.ArgumentParser) -> None:
        p.add_argument("request", help="job request JSON file, or - for standard input")
        p.add_argument(
            "--max-message-bytes",
            type=int,
            default=DEFAULT_MAX_MESSAGE_BYTES,
            help=f"message size limit (default {DEFAULT_MAX_MESSAGE_BYTES})",
        )

    validate = sub.add_parser("validate-job", help="validate a job request without running it")
    add_request(validate)

    encode_cmd = sub.add_parser("encode-job", help="print a request's canonical queue encoding")
    add_request(encode_cmd)

    run = sub.add_parser("run", help="execute a job locally and write its result")
    add_request(run)
    run.add_argument("--input-file", help="local file holding the job's input object")
    run.add_argument(
        "--output-dir",
        help="write result.json, completion-event.json and artifacts/ here "
        "(default: print the result to standard output)",
    )
    run.add_argument("--verbose", action="store_true", help="log structured job events")
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    stdout: IO[str] | None = None,
    stderr: IO[str] | None = None,
) -> int:
    out = stdout if stdout is not None else sys.stdout
    err = stderr if stderr is not None else sys.stderr
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except _UsageError as exc:
        err.write(f"{PROG}: error: {exc}\n")
        return EXIT_USAGE
    except SystemExit as exc:  # --help and --version exit 0 through argparse
        return int(exc.code or 0)

    if getattr(args, "max_message_bytes", 1) <= 0:
        err.write(f"{PROG}: error: --max-message-bytes must be positive\n")
        return EXIT_USAGE

    try:
        if args.command == "processors" and args.action == "list":
            return _cmd_processors_list(args, out)
        if args.command == "job-types" and args.action == "list":
            return _cmd_job_types_list(args, out)
        if args.command == "validate-job":
            return _cmd_validate(args, out)
        if args.command == "encode-job":
            return _cmd_encode(args, out)
        if args.command == "run":
            return _cmd_run(args, out, err)
    except _FileError as exc:
        err.write(f"{PROG}: error: {exc}\n")
        return EXIT_FILE_ERROR
    parser.print_help(err)
    return EXIT_USAGE


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
