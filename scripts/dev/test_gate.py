"""Host-wide admission control for test suites (LAI-ENG-002).

Operating guide: docs/infrastructure/multi-agent-local-environment.md, section 6.

Several agents share one machine (4 cores, 8 GB on the owner's host). When three or four of them
start Vitest or pytest at once, load reaches 2x the core count, timing-sensitive tests time out,
and one timeout can cascade through a file (Trello defect: treasureRushAudio.test.tsx). Raising
timeouts would hide that; this gate prevents the overload instead:

- **Slots.** At most ``capacity`` suites run at once across every worktree (default: half the
  cores, at least 1). A slot is an ``flock`` on a file in a shared directory, so it is released
  by the kernel when the process exits, even on a crash: no stale locks, no daemon.
- **Weight.** A path-scoped run takes one slot; ``--full`` (a whole suite) takes every slot, so
  two full suites never overlap and nothing else starts during one.
- **Workers.** Vitest commands get ``--maxWorkers`` = cores / capacity (at least 1) unless the
  command already sets it. The total worker count stays at or below the core count.
- **Pressure.** Before starting, wait while the 1-minute load is above ``--max-load`` (default
  1.5 x cores), CPU pressure (Linux PSI ``some avg10``) is above ``--max-cpu-pressure`` (default
  50%), or available memory is below ``--min-mem-mb`` (default 1024). After
  ``--max-wait`` seconds it starts anyway with one worker and says so: never a silent hang.
- **Monitoring.** Samples load, available memory and the run's process-tree CPU and RSS every
  two seconds; prints a summary and appends one JSON line per run to the shared log
  (``$LAI_TEST_STATE_DIR/test-runs.jsonl``): worktree, command, slots, workers, wait, duration,
  peaks, exit status. No environment values, no test output, no child data.
- **Infrastructure versus test failure.** A run killed by a signal (out of memory: SIGKILL) is
  reported as INFRASTRUCTURE, separately from a test failure (TESTING_STRATEGY).

Usage (standard library only; Linux /proc for monitoring, skipped elsewhere):

    python3 scripts/dev/test_gate.py -- npx vitest run src/features/region-play/audio
    python3 scripts/dev/test_gate.py -- .venv/bin/python -m pytest -q tests/repo
    python3 scripts/dev/test_gate.py --full -- npm test          # whole suite: exclusive
    python3 scripts/dev/test_gate.py --status                   # who holds slots, recent runs
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import signal
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

DEFAULT_STATE_DIR = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")) / "lai"
POLL_SECONDS = 2.0


def cpu_count() -> int:
    try:
        return max(1, len(os.sched_getaffinity(0)))
    except AttributeError:  # not Linux
        return max(1, os.cpu_count() or 1)


def worktree_root(cwd: Path) -> Path:
    """The worktree a run belongs to (its git top level), so runs from react/ or game/ group."""
    for candidate in (cwd, *cwd.parents):
        if (candidate / ".git").exists():
            return candidate
    return cwd


def default_capacity(cpus: int) -> int:
    return max(1, cpus // 2)


def workers_for(cpus: int, capacity: int, weight: int) -> int:
    """Vitest workers for a run holding `weight` of `capacity` slots on `cpus` cores."""
    return max(1, (cpus * weight) // capacity)


def with_workers(command: list[str], workers: int) -> list[str]:
    """Add --maxWorkers to a Vitest command that does not already set it."""
    if not any("vitest" in part for part in command):
        return command
    if any(part.startswith("--maxWorkers") for part in command):
        return command
    return [*command, f"--maxWorkers={workers}"]


def load_1m() -> float:
    try:
        return os.getloadavg()[0]
    except OSError:
        return 0.0


def cpu_pressure(path: Path = Path("/proc/pressure/cpu")) -> float | None:
    """Linux PSI: percent of the last 10 s in which some task waited for a CPU.

    Reacts within seconds, where the 1-minute load average smooths a burst away. A burst that
    hits two back-to-back runs equally (seen on 2026-11-19, defect ijhrYTi4) is visible here and
    not in the load average. None where PSI is unavailable.
    """
    try:
        for line in path.read_text().splitlines():
            if line.startswith("some "):
                for part in line.split()[1:]:
                    if part.startswith("avg10="):
                        return float(part.split("=", 1)[1])
    except (OSError, ValueError):
        return None
    return None


def mem_available_mb(meminfo: Path = Path("/proc/meminfo")) -> int | None:
    try:
        for line in meminfo.read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except OSError:
        return None
    return None


def _children(pid: int) -> list[int]:
    try:
        text = Path(f"/proc/{pid}/task/{pid}/children").read_text()
    except OSError:
        return []
    return [int(p) for p in text.split()]


def tree_usage(root_pid: int) -> tuple[int, float]:
    """RSS (MB) and cumulative CPU seconds of a process and its descendants (Linux)."""
    rss_kb, cpu_ticks, stack, seen = 0, 0, [root_pid], set()
    ticks = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        try:
            stat = Path(f"/proc/{pid}/stat").read_text()
            fields = stat[stat.rindex(")") + 2 :].split()
            cpu_ticks += int(fields[11]) + int(fields[12])  # utime + stime
            for line in Path(f"/proc/{pid}/status").read_text().splitlines():
                if line.startswith("VmRSS:"):
                    rss_kb += int(line.split()[1])
        except (OSError, ValueError, IndexError):
            continue
        stack.extend(_children(pid))
    return rss_kb // 1024, cpu_ticks / ticks


class Slots:
    """`capacity` lock files in a shared directory; a held flock is a held slot."""

    def __init__(self, directory: Path, capacity: int):
        self.directory = directory
        self.capacity = capacity
        self.held: list[tuple[int, int]] = []  # (index, fd)
        directory.mkdir(parents=True, exist_ok=True)

    def _path(self, index: int) -> Path:
        return self.directory / f"slot-{index}.lock"

    def try_acquire(self, weight: int, label: str) -> bool:
        """Take `weight` free slots at once, or none."""
        taken: list[tuple[int, int]] = []
        for index in range(self.capacity):
            if len(taken) == weight:
                break
            fd = os.open(self._path(index), os.O_RDWR | os.O_CREAT, 0o644)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(fd)
                continue
            os.ftruncate(fd, 0)
            os.write(fd, label.encode())
            taken.append((index, fd))
        if len(taken) < weight:
            for _, fd in taken:
                os.close(fd)  # closing the descriptor releases its flock
            return False
        self.held = taken
        return True

    def release(self) -> None:
        for _, fd in self.held:
            os.close(fd)
        self.held = []

    def holders(self) -> list[str]:
        """Labels of the slots currently held by other processes."""
        out = []
        for index in range(self.capacity):
            path = self._path(index)
            if not path.exists():
                continue
            fd = os.open(path, os.O_RDONLY)
            try:
                fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
                fcntl.flock(fd, fcntl.LOCK_UN)
            except BlockingIOError:
                out.append(f"slot {index}: {path.read_text().strip() or 'held'}")
            finally:
                os.close(fd)
        return out


@dataclass
class RunRecord:
    worktree: str
    command: list[str]
    weight: int
    capacity: int
    workers: int | None
    waited_s: float = 0.0
    forced_start: bool = False
    duration_s: float = 0.0
    peak_rss_mb: int = 0
    cpu_s: float = 0.0
    peak_load: float = 0.0
    peak_cpu_pressure: float | None = None
    min_mem_available_mb: int | None = None
    exit_code: int | None = None
    signal: str | None = None
    started_at: str = ""
    samples: int = 0
    notes: list[str] = field(default_factory=list)


def wait_for_admission(
    slots: Slots,
    weight: int,
    label: str,
    *,
    max_load: float,
    min_mem_mb: int,
    max_wait: float,
    max_cpu_pressure: float = 100.0,
    clock=time.monotonic,
    sleep=time.sleep,
    load=load_1m,
    mem=mem_available_mb,
    psi=cpu_pressure,
    say=print,
) -> tuple[float, bool]:
    """Block until slots are held and the host has headroom. Returns (waited, forced)."""
    start = clock()
    announced = False
    while True:
        waited = clock() - start
        pressure = []
        current_load, available = load(), mem()
        if current_load > max_load:
            pressure.append(f"load {current_load:.1f} > {max_load:.1f}")
        if available is not None and available < min_mem_mb:
            pressure.append(f"available memory {available} MB < {min_mem_mb} MB")
        stalled = psi()
        if stalled is not None and stalled > max_cpu_pressure:
            pressure.append(f"CPU pressure {stalled:.0f}% > {max_cpu_pressure:.0f}%")
        if not pressure and slots.try_acquire(weight, label):
            return waited, False
        if waited >= max_wait:
            if slots.try_acquire(weight, label):
                return waited, True
            if weight > 1 and slots.try_acquire(1, label):
                return waited, True
            # Every slot is held for longer than max-wait: start without one, visibly.
            return waited, True
        if not announced:
            reason = ", ".join(pressure) or "all test slots busy: " + "; ".join(slots.holders())
            say(f"test_gate: waiting ({reason})")
            announced = True
        sleep(POLL_SECONDS)


def run(args: argparse.Namespace) -> int:
    cpus = cpu_count()
    capacity = args.capacity or default_capacity(cpus)
    weight = capacity if args.full else 1
    state = args.state_dir
    slots = Slots(state / "slots", capacity)
    worktree = worktree_root(Path.cwd().resolve())
    label = f"pid {os.getpid()} {worktree.name}: {' '.join(args.command)[:120]}"
    record = RunRecord(
        worktree=str(worktree),
        command=args.command,
        weight=weight,
        capacity=capacity,
        workers=None,
        started_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    )
    waited, forced = wait_for_admission(
        slots,
        weight,
        label,
        max_load=args.max_load if args.max_load is not None else 1.5 * cpus,
        min_mem_mb=args.min_mem_mb,
        max_wait=args.max_wait,
        max_cpu_pressure=args.max_cpu_pressure,
    )
    record.waited_s, record.forced_start = round(waited, 1), forced
    held = len(slots.held)
    workers = 1 if forced or not held else workers_for(cpus, capacity, held)
    command = with_workers(args.command, workers)
    if command is not args.command:
        record.workers = workers
    if forced:
        record.notes.append("started after max-wait under pressure, with one worker")
    print(
        f"test_gate: {held}/{capacity} slot(s), {workers} worker(s), waited {waited:.0f}s"
        + (" (forced start)" if forced else "")
    )

    started = time.monotonic()
    child = subprocess.Popen(command)  # noqa: S603 - the developer's own command line
    stop = threading.Event()

    def sample() -> None:
        while not stop.wait(POLL_SECONDS):
            rss, cpu = tree_usage(child.pid)
            record.samples += 1
            record.peak_rss_mb = max(record.peak_rss_mb, rss)
            record.cpu_s = max(record.cpu_s, round(cpu, 1))
            record.peak_load = max(record.peak_load, round(load_1m(), 2))
            stalled = cpu_pressure()
            if stalled is not None:
                record.peak_cpu_pressure = max(record.peak_cpu_pressure or 0.0, stalled)
            available = mem_available_mb()
            if available is not None:
                current = record.min_mem_available_mb
                record.min_mem_available_mb = (
                    available if current is None else min(current, available)
                )

    sampler = threading.Thread(target=sample, daemon=True)
    sampler.start()
    try:
        code = child.wait()
    except KeyboardInterrupt:
        child.send_signal(signal.SIGINT)
        code = child.wait()
    finally:
        stop.set()
        sampler.join(timeout=POLL_SECONDS * 2)
        slots.release()
    record.duration_s = round(time.monotonic() - started, 1)
    record.exit_code = code
    if code < 0:
        record.signal = signal.Signals(-code).name
    write_record(state, record)
    print(
        f"test_gate: exit {code} in {record.duration_s}s; peak RSS {record.peak_rss_mb} MB, "
        f"peak load {record.peak_load}, peak CPU pressure {record.peak_cpu_pressure}%, "
        f"min available memory {record.min_mem_available_mb} MB"
    )
    if record.signal:
        print(
            f"test_gate: INFRASTRUCTURE: the run was killed by {record.signal} "
            "(SIGKILL usually means out of memory). Report it separately from test failures "
            "and rerun only the affected files.",
            file=sys.stderr,
        )
    return code if code >= 0 else 128 - code


def write_record(state: Path, record: RunRecord) -> None:
    state.mkdir(parents=True, exist_ok=True)
    with (state / "test-runs.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(asdict(record)) + "\n")


def status(args: argparse.Namespace) -> int:
    cpus = cpu_count()
    capacity = args.capacity or default_capacity(cpus)
    slots = Slots(args.state_dir / "slots", capacity)
    available = mem_available_mb()
    print(
        f"host: {cpus} cores, load {load_1m():.2f}, CPU pressure {cpu_pressure()}% (10 s), "
        f"available memory {available} MB"
    )
    print(f"capacity: {capacity} suite(s), {workers_for(cpus, capacity, 1)} worker(s) each")
    for line in slots.holders() or ["no slot held"]:
        print(f"  {line}")
    log = args.state_dir / "test-runs.jsonl"
    if log.exists():
        print("recent runs:")
        for line in log.read_text(encoding="utf-8").splitlines()[-8:]:
            r = json.loads(line)
            print(
                f"  {r['started_at']} {Path(r['worktree']).name}: exit {r['exit_code']} "
                f"{r['duration_s']}s wait {r['waited_s']}s rss {r['peak_rss_mb']}MB "
                f"load {r['peak_load']}"
            )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Host-wide test admission control (LAI-ENG-002).")
    parser.add_argument("--full", action="store_true", help="whole suite: take every slot")
    parser.add_argument(
        "--capacity", type=int, default=None, help="suites at once (default cores/2)"
    )
    parser.add_argument("--max-load", type=float, default=None, help="default 1.5 x cores")
    parser.add_argument("--min-mem-mb", type=int, default=1024)
    parser.add_argument(
        "--max-cpu-pressure",
        type=float,
        default=50.0,
        help="PSI cpu some avg10 percent (default 50)",
    )
    parser.add_argument(
        "--max-wait", type=float, default=900.0, help="seconds before a forced start"
    )
    parser.add_argument(
        "--state-dir",
        type=Path,
        default=Path(os.environ.get("LAI_TEST_STATE_DIR", DEFAULT_STATE_DIR)),
    )
    parser.add_argument("--status", action="store_true", help="show slots and recent runs")
    parser.add_argument("command", nargs=argparse.REMAINDER, help="-- <command>")
    args = parser.parse_args(argv)
    if args.command and args.command[0] == "--":
        args.command = args.command[1:]
    if args.status:
        return status(args)
    if not args.command:
        parser.error("give a command after --")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
