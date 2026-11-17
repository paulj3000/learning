"""`python -m lai_processing_runtime`: enqueue, worker and status, with their exit codes."""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
from pathlib import Path

from processing_samples import FIXTURES, INPUT_BYTES, reference_request

from lai_processing.contracts.codec import decode_event, encode
from lai_processing_runtime import cli
from lai_processing_runtime.local_queue import LocalDirectoryQueue

REPO = Path(__file__).resolve().parents[2]


def run(*argv: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = cli.main(list(argv), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def fresh_request_file(tmp_path: Path) -> Path:
    """The reference request without an expiry, so it runs on the real clock."""
    path = tmp_path / "request.json"
    path.write_bytes(encode(reference_request(expires_at=None)))
    return path


def test_usage_errors() -> None:
    assert run()[0] == cli.EXIT_USAGE
    assert run("nope")[0] == cli.EXIT_USAGE
    assert run("worker")[0] == cli.EXIT_USAGE  # --root is required
    assert run("worker", "--root", "x", "--concurrency", "0")[0] == cli.EXIT_USAGE
    assert run("worker", "--root", "x", "--poll-interval", "-1")[0] == cli.EXIT_USAGE
    assert run("--help")[0] == 0


def test_worker_once_runs_a_job_and_status_reports_depths(tmp_path: Path) -> None:
    root = tmp_path / "root"
    request_file = fresh_request_file(tmp_path)
    input_file = tmp_path / "input.txt"
    input_file.write_bytes(INPUT_BYTES)
    code, out, _ = run(
        "enqueue", "--root", str(root), str(request_file), "--input-file", str(input_file)
    )
    assert code == cli.EXIT_OK, out
    code, out, _ = run("status", "--root", str(root))
    assert json.loads(out)["work"]["ready"] == 1

    code, out, err = run("worker", "--root", str(root), "--once")
    assert code == cli.EXIT_OK
    assert json.loads(out) == {"received": 1, "succeeded": 1, "failed": 0}
    lines = [json.loads(line) for line in err.splitlines()]
    assert {"job.started", "job.succeeded", "work.completed"} <= {
        line.get("event") for line in lines
    }
    assert "Learning makes the island grow" not in err

    status = json.loads(run("status", "--root", str(root))[1])
    assert status["work"]["ready"] == 0 and status["completions"]["ready"] == 1
    [delivery] = LocalDirectoryQueue(root / "queues" / "completions").receive()
    assert decode_event(delivery.body).job_id == reference_request().job_id


def test_worker_once_failure_exit_code(tmp_path: Path) -> None:
    root = tmp_path / "root"
    LocalDirectoryQueue(root / "queues" / "work").send(b"not a request")
    code, out, err = run("worker", "--root", str(root), "--once")
    assert code == cli.EXIT_FAILED
    assert json.loads(out)["failed"] == 1
    assert "not a request" not in err


def test_worker_loop_with_max_messages(tmp_path: Path) -> None:
    root = tmp_path / "root"
    request_file = fresh_request_file(tmp_path)
    input_file = tmp_path / "input.txt"
    input_file.write_bytes(INPUT_BYTES)
    run("enqueue", "--root", str(root), str(request_file), "--input-file", str(input_file))
    run("enqueue", "--root", str(root), str(request_file))
    code, out, _ = run(
        "worker",
        "--root",
        str(root),
        "--max-messages",
        "2",
        "--poll-interval",
        "0.01",
        "--concurrency",
        "2",
    )
    assert code == cli.EXIT_OK
    assert json.loads(out) == {"received": 2, "succeeded": 2, "failed": 0}


def test_enqueue_refuses_invalid_requests_and_files(tmp_path: Path) -> None:
    root = str(tmp_path / "root")
    invalid = FIXTURES / "invalid" / "any.schema_version_2.json"
    code, out, _ = run("enqueue", "--root", root, str(invalid))
    assert code == cli.EXIT_INVALID
    assert json.loads(out)["valid"] is False
    assert LocalDirectoryQueue(tmp_path / "root" / "queues" / "work").depths().ready == 0
    assert run("enqueue", "--root", root, str(tmp_path / "missing.json"))[0] == cli.EXIT_FILE
    request_file = fresh_request_file(tmp_path)
    wrong = tmp_path / "wrong.txt"
    wrong.write_bytes(b"x" * len(INPUT_BYTES))
    code, _, err = run("enqueue", "--root", root, str(request_file), "--input-file", str(wrong))
    assert code == cli.EXIT_FILE and "checksum_mismatch" in err
    code, _, _ = run(
        "enqueue", "--root", root, str(request_file), "--input-file", str(tmp_path / "nope")
    )
    assert code == cli.EXIT_FILE
    assert run("enqueue", "--root", root, str(request_file), "--delay", "901")[0] == 2


def test_module_entry_point(tmp_path: Path) -> None:
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(REPO / "processing")}
    completed = subprocess.run(  # noqa: S603 - the test interpreter, fixed arguments
        [sys.executable, "-m", "lai_processing_runtime", "status", "--root", str(tmp_path)],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout)["work"]["ready"] == 0
