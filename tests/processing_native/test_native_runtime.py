"""The shared native tool runner, tested with tiny stub executables (no FFmpeg needed)."""

from __future__ import annotations

import os
import stat
import sys
import textwrap
from pathlib import Path

import pytest

from lai_native.runtime import (
    Deadline,
    NativeToolError,
    ToolLimits,
    ToolSpec,
    Workspace,
    check_argv,
    run_tool,
    sha256_file,
)


def stub(tmp_path: Path, body: str, name: str = "tool") -> ToolSpec:
    path = tmp_path / name
    path.write_text(f"#!{sys.executable}\n" + textwrap.dedent(body))
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return ToolSpec(name=name, path=str(path))


@pytest.fixture
def ws():
    with Workspace() as workspace:
        yield workspace


def test_runs_with_argv_list_and_returns_bounded_output(tmp_path, ws):
    spec = stub(
        tmp_path,
        """
        import sys
        sys.stdout.write("args=" + "|".join(sys.argv[1:]))
        sys.stderr.write("err")
        """,
    )
    result = run_tool(spec, ["a b", "$HOME;ls", "--x"], ws)
    assert result.returncode == 0
    # No shell: metacharacters arrive as literal single arguments.
    assert result.stdout == b"args=a b|$HOME;ls|--x"
    assert result.stderr == b"err"
    assert result.peak_rss_kb > 0


def test_environment_is_scrubbed_and_cwd_is_the_workspace(tmp_path, ws, monkeypatch):
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setenv("LAI_RESULTS_QUEUE_URL", "queue")
    spec = stub(
        tmp_path,
        """
        import json, os
        print(json.dumps({"env": sorted(os.environ), "cwd": os.getcwd()}))
        """,
    )
    import json

    out = json.loads(run_tool(spec, [], ws).stdout)
    assert out["cwd"] == str(ws.root)
    assert "AWS_SECRET_ACCESS_KEY" not in out["env"]
    assert "LAI_RESULTS_QUEUE_URL" not in out["env"]
    assert "PATH" not in out["env"]
    assert set(out["env"]) <= {"LC_ALL", "LANG", "TZ", "HOME", "TMPDIR"}


def test_extra_env_is_fixed_by_configuration_only(tmp_path, ws):
    spec = stub(tmp_path, 'import os; print(os.environ.get("LD_LIBRARY_PATH"))')
    spec = ToolSpec(spec.name, spec.path, extra_env={"LD_LIBRARY_PATH": "/opt/lib"})
    assert run_tool(spec, [], ws).stdout.strip() == b"/opt/lib"


def test_nonzero_exit_is_returned_not_raised(tmp_path, ws):
    spec = stub(tmp_path, "import sys; sys.exit(3)")
    assert run_tool(spec, [], ws).returncode == 3


def test_timeout_kills_the_process_group(tmp_path, ws):
    spec = stub(tmp_path, "import time; time.sleep(30)")
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, ToolLimits(timeout_seconds=0.4))
    assert caught.value.code == "timeout" and caught.value.retryable


def test_deadline_shorter_than_timeout_maps_to_deadline_exceeded(tmp_path, ws):
    spec = stub(tmp_path, "import time; time.sleep(30)")
    deadline = Deadline(lambda: 5400, reserve_seconds=5.0)  # 0.4 s of usable time
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, ToolLimits(timeout_seconds=60), deadline=deadline)
    assert caught.value.code == "deadline_exceeded"


def test_deadline_already_passed_never_starts_the_tool(tmp_path, ws):
    marker = tmp_path / "ran"
    spec = stub(tmp_path, f"open({str(marker)!r}, 'w').close()")
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, deadline=Deadline(lambda: 1000, reserve_seconds=5.0))
    assert caught.value.code == "deadline_exceeded"
    assert not marker.exists()


def test_cooperative_cancellation(tmp_path, ws):
    spec = stub(tmp_path, "import time; time.sleep(30)")
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, ToolLimits(timeout_seconds=30), cancelled=lambda: True)
    assert caught.value.code == "cancelled"


def test_stdout_over_the_cap_is_refused(tmp_path, ws):
    spec = stub(tmp_path, 'import sys; sys.stdout.write("x" * 200000)')
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, ToolLimits(max_stdout_bytes=1000))
    assert caught.value.code == "stdout_too_large"


def test_stderr_over_the_cap_is_truncated_not_fatal(tmp_path, ws):
    spec = stub(tmp_path, 'import sys; sys.stderr.write("e" * 200000)')
    result = run_tool(spec, [], ws, ToolLimits(max_stderr_bytes=1000))
    assert len(result.stderr) == 1000 and result.stderr_truncated


def test_workspace_growth_is_stopped(tmp_path, ws):
    spec = stub(
        tmp_path,
        """
        import time
        with open("big.bin", "wb") as f:
            for _ in range(200):
                f.write(b"0" * 100000)
                f.flush()
                time.sleep(0.01)
        """,
    )
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws, ToolLimits(max_workspace_bytes=500_000, timeout_seconds=20))
    assert caught.value.code == "output_too_large"


def test_single_file_limit_uses_rlimit_fsize(tmp_path, ws):
    # CPython ignores SIGXFSZ, so the write fails with EFBIG instead of the tool being killed;
    # either way the file cannot exceed the limit. (FFmpeg dies on the signal: output_too_large.)
    spec = stub(tmp_path, 'open("f", "wb").write(b"0" * 5_000_000)')
    try:
        result = run_tool(spec, [], ws, ToolLimits(max_file_bytes=1_000_000))
        assert result.returncode != 0
    except NativeToolError as error:
        assert error.code == "output_too_large"
    assert (ws.root / "f").stat().st_size <= 1_000_000


def test_crash_by_signal_is_tool_crashed(tmp_path, ws):
    spec = stub(tmp_path, "import os, signal; os.kill(os.getpid(), signal.SIGSEGV)")
    with pytest.raises(NativeToolError) as caught:
        run_tool(spec, [], ws)
    assert caught.value.code == "tool_crashed"


def test_memory_limit_applies(tmp_path, ws):
    spec = stub(tmp_path, "x = bytearray(400 * 1024 * 1024); print('allocated')")
    result = run_tool(spec, [], ws, ToolLimits(address_space_bytes=200 * 1024 * 1024))
    assert result.returncode != 0 and b"allocated" not in result.stdout


@pytest.mark.parametrize("bad", ["", "a\x00b", 5])
def test_invalid_arguments_are_refused(bad):
    with pytest.raises(NativeToolError) as caught:
        check_argv(["ok", bad])  # type: ignore[list-item]
    assert caught.value.code == "invalid_argument"


def test_executable_must_be_a_configured_absolute_existing_file(tmp_path, ws):
    for path, code in (("", "tool_not_configured"), ("ffmpeg", "tool_not_configured"),
                       (str(tmp_path / "nope"), "tool_missing")):
        with pytest.raises(NativeToolError) as caught:
            run_tool(ToolSpec("x", path), [], ws)
        assert caught.value.code == code
    plain = tmp_path / "plain"
    plain.write_text("x")
    plain.chmod(0o600)
    with pytest.raises(NativeToolError) as caught:
        run_tool(ToolSpec("x", str(plain)), [], ws)
    assert caught.value.code == "tool_not_executable"


def test_checksum_pin_is_enforced_before_running(tmp_path, ws):
    marker = tmp_path / "ran"
    spec = stub(tmp_path, f"open({str(marker)!r}, 'w').close()")
    pinned = ToolSpec(spec.name, spec.path, sha256="0" * 64)
    with pytest.raises(NativeToolError) as caught:
        run_tool(pinned, [], ws)
    assert caught.value.code == "tool_checksum_mismatch" and not marker.exists()
    good = ToolSpec(spec.name, spec.path, sha256=sha256_file(spec.path))
    assert run_tool(good, [], ws).returncode == 0 and marker.exists()


def test_errors_never_carry_untrusted_text(tmp_path, ws):
    spec = stub(tmp_path, 'import sys; sys.stderr.write("/secret/path SECRET"); sys.exit(1)')
    result = run_tool(spec, [], ws)
    assert result.returncode == 1
    error = NativeToolError("not-a-code")
    assert str(error) == "tool_failed"


def test_workspace_is_private_cleaned_and_names_are_validated():
    with Workspace() as ws:
        root = ws.root
        assert stat.S_IMODE(root.stat().st_mode) == 0o700
        path = ws.write("a.bin", b"1")
        assert path.parent == root
        for bad in ("../x", "/etc/passwd", "-rf", "a/b", "", ".", ".."):
            with pytest.raises(NativeToolError):
                ws.safe_path(bad)
        with pytest.raises(NativeToolError):
            ws.write("a.bin", b"again")  # create-only
        os.symlink("/etc/passwd", root / "link")
        with pytest.raises(NativeToolError):
            ws.read("link", 100)
        with pytest.raises(NativeToolError) as caught:
            ws.read("a.bin", 0)
        assert caught.value.code == "output_too_large"
    assert not root.exists()


def test_only_the_runner_module_starts_processes():
    """A guard: no other lai_native module imports subprocess or os.system-style helpers."""
    root = Path(__file__).resolve().parents[2] / "processing" / "lai_native"
    offenders = []
    for path in root.rglob("*.py"):
        if path.name == "runner.py" and path.parent.name == "runtime":
            continue
        text = path.read_text()
        if any(token in text for token in ("import subprocess", "from subprocess", "os.system", "os.popen", "os.exec")):
            offenders.append(path.name)
    assert not offenders
