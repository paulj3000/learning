"""CLI tests for `python -m lai_processing` (LAI-LAMBDA-001).

In-process tests call `main()` with captured streams; subprocess tests prove the CLI runs with
an isolated interpreter (`-I`), no Django settings, no AWS credentials and no network.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from lai_processing.cli.main import (
    EXIT_FILE_ERROR,
    EXIT_INVALID,
    EXIT_JOB_FAILED,
    EXIT_OK,
    EXIT_USAGE,
    main,
)
from lai_processing.contracts import decode_event, decode_result
from lai_processing.version import __version__

ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = ROOT / "processing"
FIXTURES = PACKAGE_ROOT / "lai_processing" / "contracts" / "fixtures"
REFERENCE_REQUEST = FIXTURES / "request.reference.json"
REFERENCE_INPUT = FIXTURES / "request.reference.input.txt"
ASSET_REQUEST = FIXTURES / "request.asset_validate_model.json"


def run_cli(*argv: str, stdin: bytes | None = None) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    if stdin is not None:
        original = sys.stdin
        sys.stdin = io.TextIOWrapper(io.BytesIO(stdin))
        try:
            code = main(list(argv), stdout=out, stderr=err)
        finally:
            sys.stdin = original
    else:
        code = main(list(argv), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


# --- help, version, usage -------------------------------------------------------------------


def test_help_exits_zero_and_names_every_command(capsys):
    code, _, _ = run_cli("--help")
    assert code == EXIT_OK
    text = capsys.readouterr().out
    for command in ("processors", "job-types", "validate-job", "encode-job", "run"):
        assert command in text


def test_version_reports_package_and_contract_schema(capsys):
    code, _, _ = run_cli("--version")
    assert code == EXIT_OK
    assert capsys.readouterr().out.strip() == f"lai-processing {__version__} (contract schema 1)"


@pytest.mark.parametrize(
    "argv",
    [[], ["processors"], ["no-such-command"], ["run"], ["validate-job"], ["--bogus"]],
)
def test_usage_errors_exit_two(argv):
    code, _, err = run_cli(*argv)
    assert code == EXIT_USAGE
    assert err


def test_non_positive_message_limit_is_a_usage_error():
    code, _, err = run_cli("validate-job", str(REFERENCE_REQUEST), "--max-message-bytes", "0")
    assert code == EXIT_USAGE
    assert "positive" in err


# --- processors and job types ----------------------------------------------------------------


def test_processors_list_text_names_the_reference_processor():
    code, out, _ = run_cli("processors", "list")
    assert code == EXIT_OK
    assert "reference.checksum 1.0.0" in out
    assert "reference-default v1" in out


def test_processors_list_json_is_deterministic():
    code, first, _ = run_cli("processors", "list", "--json")
    _, second, _ = run_cli("processors", "list", "--json")
    assert code == EXIT_OK
    assert first == second
    listing = json.loads(first)
    assert [p["processor_id"] for p in listing] == ["reference.checksum"]


def test_job_types_list_marks_downstream_types_as_declared_only():
    code, out, _ = run_cli("job-types", "list", "--json")
    assert code == EXIT_OK
    rows = {row["job_type"]: row for row in json.loads(out)}
    assert rows["reference.checksum"]["processor_available"] is True
    assert rows["asset.validate_model"]["processor_available"] is False
    assert rows["asset.validate_model"]["owner_task"] == "LAI-LAMBDA-002"


# --- validate-job ----------------------------------------------------------------------------


def test_validate_job_accepts_the_reference_fixture():
    code, out, _ = run_cli("validate-job", str(REFERENCE_REQUEST))
    assert code == EXIT_OK
    report = json.loads(out)
    assert report["valid"] is True
    assert report["processor"] == {
        "processor_id": "reference.checksum",
        "processor_version": "1.0.0",
    }
    assert report["resolved_options"] == {"metadata_level": "full", "write_report": True}


def test_validate_job_reads_standard_input():
    code, out, _ = run_cli("validate-job", "-", stdin=REFERENCE_REQUEST.read_bytes())
    assert code == EXIT_OK
    assert json.loads(out)["valid"] is True


def test_validate_job_reports_a_declared_job_type_without_a_processor():
    code, out, _ = run_cli("validate-job", str(ASSET_REQUEST))
    assert code == EXIT_INVALID
    error = json.loads(out)["error"]
    assert error["code"] == "unsupported_processor"
    assert error["retry_class"] == "manual"


def test_validate_job_refuses_a_tampered_idempotency_key(tmp_path):
    data = json.loads(REFERENCE_REQUEST.read_text())
    data["idempotency_key"] = "ik1:" + "0" * 64
    path = tmp_path / "tampered.json"
    path.write_text(json.dumps(data))
    code, out, _ = run_cli("validate-job", str(path))
    assert code == EXIT_INVALID
    error = json.loads(out)["error"]
    assert error == {
        "code": "invalid_input",
        "retry_class": "permanent",
        "message": "The job request or its input is not valid.",
        "details": {"field": "idempotency_key"},
    }


def test_validate_job_refuses_changed_options_under_the_old_key(tmp_path):
    data = json.loads(REFERENCE_REQUEST.read_text())
    data["options"]["metadata_level"] = "basic"
    path = tmp_path / "options.json"
    path.write_text(json.dumps(data))
    code, out, _ = run_cli("validate-job", str(path))
    assert code == EXIT_INVALID
    assert json.loads(out)["error"]["details"] == {"field": "idempotency_key"}


def _invalid_request_fixtures() -> list[tuple[str, str]]:
    manifest = json.loads((FIXTURES / "invalid" / "manifest.json").read_text())
    return [
        (entry["file"], entry["error_code"])
        for entry in manifest
        if entry["decoder"] in {"request", "any"}
    ]


@pytest.mark.parametrize(("name", "code"), _invalid_request_fixtures())
def test_validate_job_rejects_every_invalid_request_fixture(name, code):
    exit_code, out, _ = run_cli("validate-job", str(FIXTURES / "invalid" / name))
    assert exit_code == EXIT_INVALID
    assert json.loads(out)["error"]["code"] == code


def test_validate_job_never_echoes_hostile_content(tmp_path):
    data = json.loads(REFERENCE_REQUEST.read_text())
    data["input"]["ref"]["key"] = "processing/quarantine/local/../../etc/passwd"
    path = tmp_path / "evil.json"
    path.write_text(json.dumps(data))
    code, out, _ = run_cli("validate-job", str(path))
    assert code == EXIT_INVALID
    assert "passwd" not in out
    assert json.loads(out)["error"]["code"] == "invalid_object_reference"


def test_validate_job_rejects_an_oversized_message(tmp_path):
    path = tmp_path / "big.json"
    path.write_bytes(b" " * 5000 + REFERENCE_REQUEST.read_bytes())
    code, out, _ = run_cli("validate-job", str(path), "--max-message-bytes", "4096")
    assert code == EXIT_INVALID
    assert json.loads(out)["error"]["code"] == "message_too_large"


def test_validate_job_reports_a_missing_file_as_a_file_error(tmp_path):
    code, out, err = run_cli("validate-job", str(tmp_path / "missing.json"))
    assert code == EXIT_FILE_ERROR
    assert out == ""
    assert "cannot read the request file" in err
    assert "missing.json" not in err


def test_encode_job_prints_the_canonical_compact_encoding():
    code, out, _ = run_cli("encode-job", str(REFERENCE_REQUEST))
    assert code == EXIT_OK
    line = out.strip()
    assert "\n" not in line and ": " not in line
    assert json.loads(line) == json.loads(REFERENCE_REQUEST.read_text())


# --- run -------------------------------------------------------------------------------------


def _artifact_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_run_reference_job_writes_result_event_and_artifact(tmp_path):
    out_dir = tmp_path / "out"
    code, out, _ = run_cli(
        "run",
        str(REFERENCE_REQUEST),
        "--input-file",
        str(REFERENCE_INPUT),
        "--output-dir",
        str(out_dir),
    )
    assert code == EXIT_OK, out
    summary = json.loads(out)
    assert summary["status"] == "succeeded"
    assert summary["verdict"] == "pass"
    assert summary["files"] == [
        "artifacts/reference-report.json",
        "completion-event.json",
        "result.json",
    ]

    result = decode_result((out_dir / "result.json").read_bytes())
    assert result.input is not None and result.input.verified is True
    assert result.metadata["sha256"] == hashlib.sha256(REFERENCE_INPUT.read_bytes()).hexdigest()
    [artifact] = result.artifacts
    assert artifact.sha256 == _artifact_digest(out_dir / "artifacts" / "reference-report.json")

    event = decode_event((out_dir / "completion-event.json").read_bytes())
    assert event.result == result
    event.verify_result(result)


def test_run_prints_the_result_without_an_output_dir():
    code, out, _ = run_cli(
        "run", str(REFERENCE_REQUEST), "--input-file", str(REFERENCE_INPUT)
    )
    assert code == EXIT_OK
    assert decode_result(out).status.value == "succeeded"


def test_run_with_wrong_input_bytes_fails_with_checksum_mismatch(tmp_path):
    wrong = tmp_path / "wrong.txt"
    wrong.write_bytes(b"Learning makes the island grow!\n")  # same length, different bytes
    out_dir = tmp_path / "out"
    code, out, _ = run_cli(
        "run",
        str(REFERENCE_REQUEST),
        "--input-file",
        str(wrong),
        "--output-dir",
        str(out_dir),
    )
    assert code == EXIT_JOB_FAILED
    assert json.loads(out)["error_code"] == "checksum_mismatch"
    result = decode_result((out_dir / "result.json").read_bytes())
    assert result.status.value == "failed"
    assert result.retry_class is not None and result.retry_class.value == "permanent"
    assert not (out_dir / "artifacts").exists()


def test_run_refuses_an_input_larger_than_the_request_limit(tmp_path):
    data = json.loads(REFERENCE_REQUEST.read_text())
    big = tmp_path / "big.bin"
    big.write_bytes(b"x" * (data["limits"]["max_input_bytes"] + 1))
    code, _, err = run_cli("run", str(REFERENCE_REQUEST), "--input-file", str(big))
    assert code == EXIT_FILE_ERROR
    assert "exceeds" in err


def test_run_without_input_file_is_a_usage_error():
    code, _, err = run_cli("run", str(REFERENCE_REQUEST))
    assert code == EXIT_USAGE
    assert "--input-file" in err


def test_run_rejects_an_invalid_request_before_reading_input(tmp_path):
    code, out, _ = run_cli(
        "run", str(ASSET_REQUEST), "--input-file", str(tmp_path / "never-read.glb")
    )
    assert code == EXIT_INVALID
    assert json.loads(out)["error"]["code"] == "unsupported_processor"


def test_run_moves_a_large_result_out_of_the_completion_message(tmp_path):
    request_size = len(REFERENCE_REQUEST.read_bytes())
    out_dir = tmp_path / "out"
    code, _, _ = run_cli(
        "run",
        str(REFERENCE_REQUEST),
        "--input-file",
        str(REFERENCE_INPUT),
        "--output-dir",
        str(out_dir),
        "--max-message-bytes",
        str(max(request_size, 2048)),
    )
    assert code == EXIT_OK
    event = decode_event((out_dir / "completion-event.json").read_bytes())
    assert event.result is None and event.result_ref is not None
    stored = out_dir / "artifacts" / "job-result.json"
    assert _artifact_digest(stored) == event.result_sha256
    event.verify_result(decode_result(stored.read_bytes()))


def test_run_is_deterministic_apart_from_timestamps_and_event_id(tmp_path):
    results = []
    for name in ("a", "b"):
        out_dir = tmp_path / name
        run_cli(
            "run",
            str(REFERENCE_REQUEST),
            "--input-file",
            str(REFERENCE_INPUT),
            "--output-dir",
            str(out_dir),
        )
        data = json.loads((out_dir / "result.json").read_text())
        for volatile in ("started_at", "completed_at", "duration_ms"):
            data.pop(volatile)
        results.append(data)
    assert results[0] == results[1]


# --- runtime independence --------------------------------------------------------------------

_PROBE = """
import io, sys
from lai_processing.cli.main import main
code = main(sys.argv[1:], stdout=io.StringIO(), stderr=io.StringIO())
banned = sorted(
    m for m in sys.modules
    if m.split(".")[0] in {"django", "boto3", "botocore", "rest_framework", "psycopg"}
)
print(code, ",".join(banned))
"""


def _isolated_env() -> dict[str, str]:
    keep = {"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"}
    env = {k: v for k, v in os.environ.items() if k in keep}
    env["PYTHONPATH"] = str(PACKAGE_ROOT)
    return env


def test_cli_runs_in_a_clean_environment_without_importing_django_or_aws(tmp_path):
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            _PROBE,
            "run",
            str(REFERENCE_REQUEST),
            "--input-file",
            str(REFERENCE_INPUT),
            "--output-dir",
            str(tmp_path / "out"),
        ],
        env=_isolated_env(),
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.strip() == "0", completed.stdout


def test_python_dash_m_entry_point(tmp_path):
    completed = subprocess.run(
        [sys.executable, "-m", "lai_processing", "processors", "list"],
        env=_isolated_env(),
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert "reference.checksum" in completed.stdout
