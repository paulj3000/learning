"""`python -m lai_processing_runtime`: run the local worker and drive its queues.

Commands:
  worker   poll `<root>/queues/work`, process, send to `<root>/queues/completions`
  enqueue  validate a job request file and drop its canonical encoding into the work queue,
           optionally placing its input file into the store it names (`--input-file`)
  status   print queue depths as JSON

No AWS, no Django, no network. Logs are JSON lines on standard error.

Exit codes:
  0  success (worker stopped cleanly; with --once, every delivery succeeded)
  1  with --once, at least one delivery failed (it was released for redelivery)
  2  usage error
  3  invalid job request (enqueue)
  4  local file or storage error
"""

from __future__ import annotations

import argparse
import io
import json
import signal
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import IO, Any, Final

from lai_processing.contracts.codec import DEFAULT_MAX_MESSAGE_BYTES, decode_request, encode
from lai_processing.core.errors import ProcessingError
from lai_processing.ports.storage import StorageError

from .config import ConfigError, LocalRuntimeConfig
from .filesystem import FilesystemObjectStorage
from .local_queue import LocalDirectoryQueue
from .local_worker import DEFAULT_JOB_TIMEOUT_SECONDS, LocalWorker, WorkerSummary
from .telemetry import JsonLogTelemetry

__all__ = ["EXIT_FAILED", "EXIT_FILE", "EXIT_INVALID", "EXIT_OK", "EXIT_USAGE", "main"]

EXIT_OK: Final = 0
EXIT_FAILED: Final = 1
EXIT_USAGE: Final = 2
EXIT_INVALID: Final = 3
EXIT_FILE: Final = 4
PROG: Final = "python -m lai_processing_runtime"


class _UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> Any:  # type: ignore[override]
        raise _UsageError(message)


def _pretty(value: Any) -> str:
    return json.dumps(value, sort_keys=True, indent=2, ensure_ascii=True) + "\n"


def _positive_int(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a positive integer") from None
    if value < 1:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return value


def _positive_float(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        raise argparse.ArgumentTypeError("must be a positive number") from None
    if not value > 0:
        raise argparse.ArgumentTypeError("must be a positive number")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(prog=PROG, description="Local processing worker and queue tools.")
    sub = parser.add_subparsers(dest="command", metavar="COMMAND", parser_class=_Parser)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--root", required=True, help="processing root (stores and queues)")
        p.add_argument(
            "--assets-root",
            help="assets store root, laid out as <assets-root>/<key> like Django's "
            "LAI_ASSET_LOCAL_ROOT (default: --root)",
        )

    worker = sub.add_parser("worker", help="run the local worker")
    common(worker)
    worker.add_argument("--namespace", default="local", help="contract namespace (default local)")
    worker.add_argument("--once", action="store_true", help="process one batch and exit")
    worker.add_argument("--concurrency", type=_positive_int, default=1, help="worker threads")
    worker.add_argument(
        "--poll-interval", type=_positive_float, default=1.0, help="seconds between polls"
    )
    worker.add_argument(
        "--max-messages", type=_positive_int, help="exit after processing this many deliveries"
    )
    worker.add_argument(
        "--job-timeout",
        type=_positive_int,
        default=DEFAULT_JOB_TIMEOUT_SECONDS,
        help=f"per-job deadline in seconds (default {DEFAULT_JOB_TIMEOUT_SECONDS})",
    )
    worker.add_argument("--cleanup-margin", type=_positive_int, default=30)
    worker.add_argument("--log-level", default="INFO")

    enqueue = sub.add_parser("enqueue", help="add a job request to the local work queue")
    common(enqueue)
    enqueue.add_argument("request", help="job request JSON file")
    enqueue.add_argument("--input-file", help="also store this file as the request's input object")
    enqueue.add_argument("--delay", type=int, default=0, help="delivery delay in seconds")

    status = sub.add_parser("status", help="print local queue depths")
    common(status)
    return parser


def _config(args: argparse.Namespace) -> LocalRuntimeConfig:
    root = Path(args.root)
    assets = Path(args.assets_root) if args.assets_root else root
    return LocalRuntimeConfig(
        root=root,
        assets_root=assets,
        namespace=getattr(args, "namespace", "local"),
        cleanup_margin_seconds=getattr(args, "cleanup_margin", 30),
        log_level=getattr(args, "log_level", "INFO"),
    )


def _cmd_worker(args: argparse.Namespace, out: IO[str], err: IO[str]) -> int:
    config = _config(args)
    telemetry = JsonLogTelemetry(err, level=config.log_level)
    worker = LocalWorker(
        config,
        telemetry=telemetry,
        concurrency=args.concurrency,
        poll_interval=args.poll_interval,
        job_timeout_seconds=args.job_timeout,
    )
    previous: dict[int, Any] = {}
    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous[signum] = signal.signal(signum, worker.handle_signal)
    except ValueError:  # not the main thread: no signal handling
        previous.clear()
    try:
        summary: WorkerSummary
        if args.once:
            summary = worker.run_once()
        else:
            summary = worker.run(max_messages=args.max_messages)
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    out.write(
        _pretty(
            {
                "received": summary.received,
                "succeeded": summary.succeeded,
                "failed": summary.failed,
            }
        )
    )
    return EXIT_FAILED if args.once and summary.failed else EXIT_OK


def _cmd_enqueue(args: argparse.Namespace, out: IO[str], err: IO[str]) -> int:
    config = _config(args)
    try:
        with open(args.request, "rb") as handle:
            raw = handle.read(DEFAULT_MAX_MESSAGE_BYTES + 1)
    except OSError:
        err.write(f"{PROG}: error: cannot read the request file\n")
        return EXIT_FILE
    try:
        request = decode_request(raw)
    except ProcessingError as error:
        out.write(_pretty({"valid": False, "error_code": error.code.value, **error.details}))
        return EXIT_INVALID
    if args.delay < 0 or args.delay > 900:
        err.write(f"{PROG}: error: --delay must be from 0 to 900\n")
        return EXIT_USAGE
    if args.input_file is not None:
        if request.input is None:
            err.write(f"{PROG}: error: this job type has no input\n")
            return EXIT_USAGE
        store = request.input.ref.store
        storage = FilesystemObjectStorage(config.storage_roots(), writable=frozenset({store}))
        try:
            with open(args.input_file, "rb") as handle:
                data = handle.read(request.input.size_bytes + 1)
        except OSError:
            err.write(f"{PROG}: error: cannot read the input file\n")
            return EXIT_FILE
        try:
            storage.put(
                request.input.ref,
                io.BytesIO(data),
                content_type=request.input.content_type,
                sha256=request.input.sha256,
                size_bytes=request.input.size_bytes,
            )
        except (StorageError, ProcessingError) as error:
            err.write(f"{PROG}: error: cannot store the input ({error.code.value})\n")
            return EXIT_FILE
    queue = LocalDirectoryQueue(config.work_queue_dir)
    receipt = queue.send(encode(request), delay_seconds=args.delay)
    out.write(_pretty({"job_id": request.job_id, "message_id": receipt.message_id}))
    return EXIT_OK


def _cmd_status(args: argparse.Namespace, out: IO[str]) -> int:
    config = _config(args)
    work = LocalDirectoryQueue(config.work_queue_dir).depths()
    completions = LocalDirectoryQueue(config.completion_queue_dir).depths()
    out.write(_pretty({"work": work.to_dict(), "completions": completions.to_dict()}))
    return EXIT_OK


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
    except SystemExit as exc:  # --help
        return int(exc.code or 0)
    try:
        if args.command == "worker":
            return _cmd_worker(args, out, err)
        if args.command == "enqueue":
            return _cmd_enqueue(args, out, err)
        if args.command == "status":
            return _cmd_status(args, out)
    except (ConfigError, ValueError) as exc:
        err.write(f"{PROG}: error: {exc}\n")
        return EXIT_USAGE
    except OSError:
        err.write(f"{PROG}: error: a local file or directory is not accessible\n")
        return EXIT_FILE
    parser.print_help(err)
    return EXIT_USAGE
