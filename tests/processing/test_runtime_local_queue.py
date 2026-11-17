"""LocalDirectoryQueue: durable at-least-once delivery on a directory, safe across processes."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from lai_processing.ports.queue import MessageQueue
from lai_processing_runtime.local_queue import LocalDirectoryQueue

REPO = Path(__file__).resolve().parents[2]


class Clock:
    def __init__(self) -> None:
        self.now = 1_800_000_000.0

    def __call__(self) -> float:
        return self.now


def make(
    tmp_path: Path, *, max_message_bytes: int = 240 * 1024, max_receive_count: int = 5
) -> tuple[LocalDirectoryQueue, Clock]:
    clock = Clock()
    queue = LocalDirectoryQueue(
        tmp_path / "q",
        clock=clock,
        max_message_bytes=max_message_bytes,
        max_receive_count=max_receive_count,
    )
    return queue, clock


def test_implements_the_port(tmp_path: Path) -> None:
    queue, _ = make(tmp_path)
    assert isinstance(queue, MessageQueue)


def test_send_receive_ack(tmp_path: Path) -> None:
    queue, _ = make(tmp_path)
    receipt = queue.send(b"one")
    got = queue.receive(max_messages=5, visibility_seconds=30)
    assert len(got) == 1
    assert got[0].message_id == receipt.message_id
    assert got[0].body == b"one" and got[0].receive_count == 1
    assert queue.receive() == []  # in flight: hidden
    assert queue.depths().inflight == 1
    queue.ack(got[0])
    assert queue.depths().to_dict() == {"ready": 0, "delayed": 0, "inflight": 0, "dead": 0}


def test_order_and_batch_size(tmp_path: Path) -> None:
    queue, clock = make(tmp_path)
    for i in range(3):
        queue.send(str(i).encode())
        clock.now += 0.01
    got = queue.receive(max_messages=2)
    assert [d.body for d in got] == [b"0", b"1"]
    assert [d.body for d in queue.receive(max_messages=2)] == [b"2"]


def test_delay(tmp_path: Path) -> None:
    queue, clock = make(tmp_path)
    queue.send(b"later", delay_seconds=10)
    assert queue.receive() == []
    assert queue.depths().delayed == 1
    clock.now += 10
    assert [d.body for d in queue.receive()] == [b"later"]


def test_lease_expiry_redelivers_with_growing_receive_count(tmp_path: Path) -> None:
    queue, clock = make(tmp_path)
    queue.send(b"m")
    first = queue.receive(visibility_seconds=30)[0]
    clock.now += 29
    assert queue.receive() == []
    clock.now += 2
    second = queue.receive(visibility_seconds=30)[0]
    assert second.message_id == first.message_id
    assert second.receive_count == 2
    assert second.receipt != first.receipt
    queue.ack(first)  # stale receipt: ignored, the redelivery stays in flight
    assert queue.depths().inflight == 1
    queue.ack(second)
    assert queue.depths().inflight == 0


def test_release_with_delay_keeps_the_count(tmp_path: Path) -> None:
    queue, clock = make(tmp_path)
    queue.send(b"m")
    d = queue.receive()[0]
    queue.release(d, delay_seconds=5)
    assert queue.receive() == []
    clock.now += 5
    again = queue.receive()[0]
    assert again.receive_count == 2
    queue.release(again)  # no delay
    assert queue.receive()[0].receive_count == 3


def test_dead_letter_after_max_receives(tmp_path: Path) -> None:
    queue, _ = make(tmp_path, max_receive_count=3)
    queue.send(b"poison")
    for expected in (1, 2, 3):
        d = queue.receive()[0]
        assert d.receive_count == expected
        queue.release(d)
    assert queue.receive() == []
    assert queue.depths().dead == 1
    assert queue.dead_letters() == [b"poison"]


def test_size_limit_and_argument_checks(tmp_path: Path) -> None:
    queue, _ = make(tmp_path, max_message_bytes=4)
    with pytest.raises(ValueError):
        queue.send(b"12345")
    with pytest.raises(ValueError):
        queue.send(b"1", delay_seconds=-1)
    with pytest.raises(ValueError):
        queue.receive(max_messages=0)
    with pytest.raises(ValueError):
        queue.ack(type("D", (), {"receipt": "../../etc/passwd"})())  # type: ignore[arg-type]


def test_messages_survive_a_new_queue_object(tmp_path: Path) -> None:
    queue, clock = make(tmp_path)
    queue.send(b"durable")
    again = LocalDirectoryQueue(tmp_path / "q", clock=clock)
    assert [d.body for d in again.receive()] == [b"durable"]


def test_partial_writes_are_never_visible(tmp_path: Path) -> None:
    queue, _ = make(tmp_path)
    (tmp_path / "q" / "tmp" / "half.tmp").write_bytes(b"partial")
    (tmp_path / "q" / "ready" / "garbage").write_bytes(b"x")
    assert queue.receive() == []


CONSUMER = """
import json, sys
sys.path.insert(0, sys.argv[1])
from lai_processing_runtime.local_queue import LocalDirectoryQueue
queue = LocalDirectoryQueue(sys.argv[2])
seen = []
while True:
    batch = queue.receive(max_messages=3, visibility_seconds=600)
    if not batch:
        break
    for d in batch:
        seen.append(d.body.decode())
        queue.ack(d)
print(json.dumps(seen))
"""


def test_multiple_processes_never_receive_the_same_message(tmp_path: Path) -> None:
    root = tmp_path / "q"
    queue = LocalDirectoryQueue(root)
    sent = [f"msg-{i}" for i in range(120)]
    for body in sent:
        queue.send(body.encode())
    env = {"PATH": os.environ.get("PATH", "")}
    procs = [
        subprocess.Popen(  # noqa: S603 - the test interpreter running a fixed script
            [sys.executable, "-I", "-c", CONSUMER, str(REPO / "processing"), str(root)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        for _ in range(4)
    ]
    received: list[str] = []
    for proc in procs:
        out, err = proc.communicate(timeout=120)
        assert proc.returncode == 0, err
        received.extend(json.loads(out))
    assert sorted(received) == sorted(sent)  # every message once, none twice
    assert queue.depths().to_dict() == {"ready": 0, "delayed": 0, "inflight": 0, "dead": 0}
