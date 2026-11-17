"""`LocalDirectoryQueue`: a durable, file-per-message `MessageQueue` for local development.

It models the SQS standard-queue semantics the port promises (at-least-once delivery,
visibility leases, redelivery, receive counts, a dead-letter area) with nothing but a directory
and atomic renames, so several worker processes can share one queue without a lock file:

    <root>/tmp/       messages being written (never visible)
    <root>/ready/     <visible_at_ms>_<message id>_<receive count>.msg
    <root>/inflight/  <lease_expiry_ms>_<message id>_<receive count>_<token>.msg
    <root>/dead/      <message id>_<receive count>.msg

- `send` writes to `tmp/` (`O_EXCL`, `fsync`) and renames into `ready/`: a reader never sees a
  partial message. A delay is a future `visible_at`.
- `receive` first returns expired leases from `inflight/` to `ready/`, then claims visible
  messages oldest first by renaming them into `inflight/` with a new lease and receive count.
  `rename` is the lock: when two processes race for one file, exactly one rename succeeds and
  the other sees `FileNotFoundError` and moves on. The delivery's receipt is its in-flight name.
- A message already received `max_receive_count` times (default 5, the SQS `maxReceiveCount`
  of the frozen interface) is moved to `dead/` instead of being delivered again.
- `ack` deletes the in-flight file; `release` renames it back to `ready/` with a delay. A stale
  receipt (the lease expired and the message moved on) is ignored, as in SQS.

Times are wall-clock milliseconds (shared across processes). No network, no daemon.
"""

from __future__ import annotations

import os
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from lai_processing.ports.queue import Delivery, SendReceipt

__all__ = ["LocalDirectoryQueue", "QueueDepths"]

_READY: Final = re.compile(r"^(\d{16})_([0-9a-f]{32})_(\d{4})\.msg$")
_INFLIGHT: Final = re.compile(r"^(\d{16})_([0-9a-f]{32})_(\d{4})_([0-9a-f]{32})\.msg$")
_DEAD: Final = re.compile(r"^([0-9a-f]{32})_(\d{4})\.msg$")
MAX_DELAY_SECONDS: Final = 43_200
_OPEN_FLAGS: Final = (
    os.O_WRONLY
    | os.O_CREAT
    | os.O_EXCL
    | getattr(os, "O_NOFOLLOW", 0)
    | getattr(os, "O_CLOEXEC", 0)
)


@dataclass(frozen=True, slots=True)
class QueueDepths:
    ready: int
    delayed: int
    inflight: int
    dead: int

    def to_dict(self) -> dict[str, int]:
        return {
            "ready": self.ready,
            "delayed": self.delayed,
            "inflight": self.inflight,
            "dead": self.dead,
        }


class LocalDirectoryQueue:
    def __init__(
        self,
        root: Path | str,
        *,
        max_message_bytes: int = 240 * 1024,
        max_receive_count: int = 5,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if type(max_receive_count) is not int or max_receive_count < 1:
            raise ValueError("max_receive_count must be a positive integer")
        if type(max_message_bytes) is not int or max_message_bytes < 1:
            raise ValueError("max_message_bytes must be a positive integer")
        self.root = Path(root)
        self.max_message_bytes = max_message_bytes
        self.max_receive_count = max_receive_count
        self._clock = clock
        for name in ("tmp", "ready", "inflight", "dead"):
            (self.root / name).mkdir(parents=True, exist_ok=True, mode=0o700)
        self._tmp = self.root / "tmp"
        self._ready = self.root / "ready"
        self._inflight = self.root / "inflight"
        self._dead = self.root / "dead"

    def _now_ms(self) -> int:
        return int(self._clock() * 1000)

    @staticmethod
    def _ready_name(visible_ms: int, message_id: str, count: int) -> str:
        return f"{visible_ms:016d}_{message_id}_{count:04d}.msg"

    @staticmethod
    def _check_seconds(value: int, name: str) -> int:
        if type(value) is not int or not 0 <= value <= MAX_DELAY_SECONDS:
            raise ValueError(f"{name} must be an integer from 0 to {MAX_DELAY_SECONDS}")
        return value

    # MessageQueue --------------------------------------------------------------------------

    def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
        if len(body) > self.max_message_bytes:
            raise ValueError("message exceeds the queue limit")
        self._check_seconds(delay_seconds, "delay_seconds")
        message_id = uuid.uuid4().hex
        temp = self._tmp / f"{message_id}.tmp"
        fd = os.open(temp, _OPEN_FLAGS, 0o600)
        try:
            view = memoryview(bytes(body))
            while view:
                view = view[os.write(fd, view) :]
            os.fsync(fd)
        finally:
            os.close(fd)
        visible = self._now_ms() + delay_seconds * 1000
        os.rename(temp, self._ready / self._ready_name(visible, message_id, 0))
        return SendReceipt(message_id)

    def receive(self, *, max_messages: int = 1, visibility_seconds: int = 30) -> list[Delivery]:
        if type(max_messages) is not int or max_messages < 1:
            raise ValueError("max_messages must be a positive integer")
        self._check_seconds(visibility_seconds, "visibility_seconds")
        now = self._now_ms()
        self._reclaim_expired(now)
        deliveries: list[Delivery] = []
        for name in sorted(os.listdir(self._ready)):
            if len(deliveries) >= max_messages:
                break
            match = _READY.fullmatch(name)
            if match is None:
                continue
            visible, message_id, count = int(match[1]), match[2], int(match[3])
            if visible > now:
                break  # names sort by visibility time: nothing later is visible either
            if count >= self.max_receive_count:
                self._rename(self._ready / name, self._dead / f"{message_id}_{count:04d}.msg")
                continue
            lease = now + visibility_seconds * 1000
            receipt = f"{lease:016d}_{message_id}_{count + 1:04d}_{uuid.uuid4().hex}.msg"
            if not self._rename(self._ready / name, self._inflight / receipt):
                continue  # another consumer claimed it first
            try:
                body = (self._inflight / receipt).read_bytes()
            except FileNotFoundError:
                continue  # lease already expired and reclaimed elsewhere
            deliveries.append(Delivery(message_id, receipt, body, count + 1))
        return deliveries

    def ack(self, delivery: Delivery) -> None:
        if _INFLIGHT.fullmatch(delivery.receipt) is None:
            raise ValueError("not a receipt of this queue")
        try:
            os.unlink(self._inflight / delivery.receipt)
        except FileNotFoundError:
            pass  # stale receipt: the message was reclaimed and may be redelivered

    def release(self, delivery: Delivery, *, delay_seconds: int = 0) -> None:
        match = _INFLIGHT.fullmatch(delivery.receipt)
        if match is None:
            raise ValueError("not a receipt of this queue")
        self._check_seconds(delay_seconds, "delay_seconds")
        visible = self._now_ms() + delay_seconds * 1000
        target = self._ready_name(visible, match[2], int(match[3]))
        self._rename(self._inflight / delivery.receipt, self._ready / target)

    # Inspection ----------------------------------------------------------------------------

    def depths(self) -> QueueDepths:
        now = self._now_ms()
        ready = delayed = 0
        for name in os.listdir(self._ready):
            match = _READY.fullmatch(name)
            if match is None:
                continue
            if int(match[1]) > now:
                delayed += 1
            else:
                ready += 1
        inflight = sum(1 for n in os.listdir(self._inflight) if _INFLIGHT.fullmatch(n))
        dead = sum(1 for n in os.listdir(self._dead) if _DEAD.fullmatch(n))
        return QueueDepths(ready=ready, delayed=delayed, inflight=inflight, dead=dead)

    def dead_letters(self) -> list[bytes]:
        return [
            (self._dead / name).read_bytes()
            for name in sorted(os.listdir(self._dead))
            if _DEAD.fullmatch(name)
        ]

    # Internals -----------------------------------------------------------------------------

    @staticmethod
    def _rename(source: Path, target: Path) -> bool:
        try:
            os.rename(source, target)
        except FileNotFoundError:
            return False
        return True

    def _reclaim_expired(self, now: int) -> None:
        for name in os.listdir(self._inflight):
            match = _INFLIGHT.fullmatch(name)
            if match is None or int(match[1]) > now:
                continue
            target = self._ready_name(now, match[2], int(match[3]))
            self._rename(self._inflight / name, self._ready / target)
