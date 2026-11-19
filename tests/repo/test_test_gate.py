"""Unit tests for scripts/dev/test_gate.py (LAI-ENG-002 host-wide test admission control)."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "test_gate", ROOT / "scripts" / "dev" / "test_gate.py"
)
assert _SPEC and _SPEC.loader
gate = importlib.util.module_from_spec(_SPEC)
sys.modules["test_gate"] = gate  # dataclasses resolve the module by name
_SPEC.loader.exec_module(gate)

# End-to-end runs must not depend on the host's real load: the gate would rightly make them wait.
NO_PRESSURE = ["--max-load", "1000", "--min-mem-mb", "0", "--max-wait", "0"]


@pytest.mark.parametrize("cpus, capacity", [(1, 1), (2, 1), (4, 2), (8, 4), (16, 8)])
def test_default_capacity_is_half_the_cores(cpus, capacity):
    assert gate.default_capacity(cpus) == capacity


@pytest.mark.parametrize(
    "cpus, capacity, weight, workers",
    [(4, 2, 1, 2), (4, 2, 2, 4), (8, 4, 1, 2), (1, 1, 1, 1), (4, 4, 1, 1), (3, 2, 1, 1)],
)
def test_workers_never_exceed_the_cores(cpus, capacity, weight, workers):
    assert gate.workers_for(cpus, capacity, weight) == workers
    assert gate.workers_for(cpus, capacity, 1) * capacity <= max(cpus, capacity)


def test_with_workers_only_touches_vitest():
    assert gate.with_workers(["npx", "vitest", "run", "a"], 2) == [
        "npx",
        "vitest",
        "run",
        "a",
        "--maxWorkers=2",
    ]
    assert gate.with_workers(["npx", "vitest", "run", "--maxWorkers=1"], 2) == [
        "npx",
        "vitest",
        "run",
        "--maxWorkers=1",
    ]
    pytest_cmd = [".venv/bin/python", "-m", "pytest", "-q"]
    assert gate.with_workers(pytest_cmd, 2) is pytest_cmd


def test_slots_are_exclusive_and_released(tmp_path):
    a = gate.Slots(tmp_path, 2)
    b = gate.Slots(tmp_path, 2)
    c = gate.Slots(tmp_path, 2)
    assert a.try_acquire(1, "a")
    assert b.try_acquire(1, "b")
    assert not c.try_acquire(1, "c")
    assert sorted(h.split(":")[0] for h in c.holders()) == ["slot 0", "slot 1"]
    a.release()
    assert c.try_acquire(1, "c")
    b.release()
    c.release()
    assert c.holders() == []


def test_full_weight_is_all_or_nothing(tmp_path):
    small = gate.Slots(tmp_path, 2)
    full = gate.Slots(tmp_path, 2)
    assert small.try_acquire(1, "small")
    assert not full.try_acquire(2, "full")
    assert full.held == []  # the free slot it touched was given back
    small.release()
    assert full.try_acquire(2, "full")
    assert not gate.Slots(tmp_path, 2).try_acquire(1, "late")
    full.release()


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def _admit(tmp_path, *, loads, mem=4096, max_wait=60, weight=1, slots=None):
    clock = FakeClock()
    loads = iter(loads)
    last = [0.0]

    def load():
        last[0] = next(loads, last[0])
        return last[0]

    messages = []
    slots = slots or gate.Slots(tmp_path, 2)
    waited, forced = gate.wait_for_admission(
        slots,
        weight,
        "test",
        max_load=6.0,
        min_mem_mb=1024,
        max_wait=max_wait,
        clock=clock,
        sleep=clock.sleep,
        load=load,
        mem=lambda: mem,
        say=messages.append,
    )
    return slots, waited, forced, messages


def test_admits_immediately_with_headroom(tmp_path):
    slots, waited, forced, messages = _admit(tmp_path, loads=[1.0])
    assert (waited, forced, messages) == (0.0, False, [])
    assert len(slots.held) == 1
    slots.release()


def test_waits_while_load_is_high_then_admits(tmp_path):
    slots, waited, forced, messages = _admit(tmp_path, loads=[8.0, 8.0, 7.0, 2.0])
    assert forced is False
    assert waited == pytest.approx(3 * gate.POLL_SECONDS)
    assert "load 8.0 > 6.0" in messages[0]
    slots.release()


def test_waits_for_memory(tmp_path):
    _, _, forced, messages = _admit(tmp_path, loads=[1.0], mem=512, max_wait=4)
    assert forced is True
    assert "available memory 512 MB < 1024 MB" in messages[0]


def test_forced_start_after_max_wait_is_reported(tmp_path):
    slots, waited, forced, _ = _admit(tmp_path, loads=[9.0], max_wait=10)
    assert forced is True
    assert waited >= 10
    assert len(slots.held) == 1  # it still takes a slot when one is free
    slots.release()


def test_busy_slots_name_their_holders(tmp_path):
    other = gate.Slots(tmp_path, 2)
    assert other.try_acquire(2, "pid 1 storybook: npm test")
    _, _, forced, messages = _admit(tmp_path, loads=[1.0], max_wait=4)
    assert forced is True
    assert "storybook: npm test" in messages[0]
    other.release()


def test_run_records_a_passing_command(tmp_path, capsys):
    code = gate.main(
        [
            *NO_PRESSURE,
            "--state-dir",
            str(tmp_path),
            "--capacity",
            "2",
            "--",
            sys.executable,
            "-c",
            "pass",
        ]
    )
    assert code == 0
    record = json.loads((tmp_path / "test-runs.jsonl").read_text().splitlines()[-1])
    assert record["exit_code"] == 0
    assert record["weight"] == 1
    assert record["signal"] is None
    assert "slot(s)" in capsys.readouterr().out
    assert gate.Slots(tmp_path / "slots", 2).holders() == []  # released after the run


def test_run_passes_the_exit_code_through(tmp_path):
    assert (
        gate.main(
            [
                *NO_PRESSURE,
                "--state-dir",
                str(tmp_path),
                "--",
                sys.executable,
                "-c",
                "raise SystemExit(3)",
            ]
        )
        == 3
    )


def test_killed_run_is_reported_as_infrastructure(tmp_path, capsys):
    code = gate.main(
        [
            *NO_PRESSURE,
            "--state-dir",
            str(tmp_path),
            "--",
            sys.executable,
            "-c",
            "import os, signal; os.kill(os.getpid(), signal.SIGKILL)",
        ]
    )
    assert code == 128 + 9
    record = json.loads((tmp_path / "test-runs.jsonl").read_text().splitlines()[-1])
    assert record["signal"] == "SIGKILL"
    assert "INFRASTRUCTURE" in capsys.readouterr().err


def test_full_run_takes_every_slot(tmp_path):
    code = gate.main(
        [
            *NO_PRESSURE,
            "--state-dir",
            str(tmp_path),
            "--capacity",
            "3",
            "--full",
            "--",
            sys.executable,
            "-c",
            "pass",
        ]
    )
    assert code == 0
    record = json.loads((tmp_path / "test-runs.jsonl").read_text().splitlines()[-1])
    assert record["weight"] == 3


def test_tree_usage_reads_this_process():
    rss, cpu = gate.tree_usage(__import__("os").getpid())
    if not Path("/proc").exists():
        pytest.skip("no /proc")
    assert rss > 0
    assert cpu >= 0


def test_status_lists_runs(tmp_path, capsys):
    gate.main([*NO_PRESSURE, "--state-dir", str(tmp_path), "--", sys.executable, "-c", "pass"])
    assert gate.main([*NO_PRESSURE, "--state-dir", str(tmp_path), "--status"]) == 0
    out = capsys.readouterr().out
    assert "capacity:" in out
    assert "recent runs:" in out


def test_command_is_required(tmp_path):
    with pytest.raises(SystemExit):
        gate.main([*NO_PRESSURE, "--state-dir", str(tmp_path)])


def test_worktree_root_is_the_git_top_level(tmp_path):
    (tmp_path / ".git").write_text("gitdir: elsewhere\n")  # a linked worktree has a .git file
    (tmp_path / "react" / "src").mkdir(parents=True)
    assert gate.worktree_root(tmp_path / "react" / "src") == tmp_path
