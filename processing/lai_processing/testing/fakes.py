"""In-memory adapters for unit tests and the CLI. No network, no AWS, no Django.

- MemoryObjectStorage: versioned, create-only artifact writes, fault injection.
- MemoryQueue: at-least-once semantics with visibility timeouts, redelivery, injected
  duplicates, a receive limit and a dead-letter list.
- RecordingTelemetry: records events and metrics after the same field checks as production.
- ManualClock: a controllable clock.
"""

from __future__ import annotations

import io
import itertools
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import IO, Any

from ..contracts.common import ObjectRef
from ..contracts.identifiers import StoreName
from ..core.canonical import sha256_hex
from ..core.errors import ErrorCode, ProcessingError
from ..ports.queue import Delivery, SendReceipt
from ..ports.storage import (
    ObjectExists,
    ObjectInfo,
    ObjectMissing,
    StorageError,
    StoragePermissionDenied,
)
from ..ports.telemetry import FieldValue, check_fields

__all__ = [
    "ManualClock",
    "MemoryObjectStorage",
    "MemoryQueue",
    "RecordingTelemetry",
    "StoredObject",
]


class ManualClock:
    def __init__(self, start: datetime | None = None) -> None:
        self._now = start or datetime(2026, 11, 16, 12, 0, 0, tzinfo=UTC)
        self._mono = 1000.0

    def now(self) -> datetime:
        return self._now

    def monotonic(self) -> float:
        return self._mono

    def advance(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)
        self._mono += seconds


@dataclass(frozen=True, slots=True)
class StoredObject:
    data: bytes
    content_type: str | None
    version_id: str
    sha256: str


@dataclass
class MemoryObjectStorage:
    """Versioned in-memory object store keyed by (store, key).

    `writable_stores` defaults to ARTIFACTS only, as for a real worker role. Tests seed inputs
    with `seed()`. `fail_next(operation, error)` makes the next call of that operation raise."""

    writable_stores: frozenset[StoreName] = frozenset({StoreName.ARTIFACTS})
    objects: dict[tuple[str, str], list[StoredObject]] = field(default_factory=dict)
    deleted: list[tuple[str, str]] = field(default_factory=list)
    _faults: dict[str, list[Exception]] = field(default_factory=dict)
    _versions: Any = field(default_factory=lambda: itertools.count(1))

    def fail_next(self, operation: str, error: Exception) -> None:
        self._faults.setdefault(operation, []).append(error)

    def _maybe_fail(self, operation: str) -> None:
        queue = self._faults.get(operation)
        if queue:
            raise queue.pop(0)

    def _next_version(self) -> str:
        return f"v{next(self._versions):06d}"

    def seed(
        self, ref: ObjectRef, data: bytes, *, content_type: str | None = None
    ) -> ObjectInfo:
        """Place an object (any store), returning its info with a new version id."""
        stored = StoredObject(data, content_type, self._next_version(), sha256_hex(data))
        self.objects.setdefault((ref.store.value, ref.key), []).append(stored)
        return self._info(ref, stored)

    def _info(self, ref: ObjectRef, stored: StoredObject) -> ObjectInfo:
        return ObjectInfo(
            ref=ObjectRef(ref.store, ref.key, stored.version_id, ref.namespace),
            size_bytes=len(stored.data),
            content_type=stored.content_type,
            version_id=stored.version_id,
            sha256=stored.sha256,
        )

    def _get(self, ref: ObjectRef) -> StoredObject:
        versions = self.objects.get((ref.store.value, ref.key))
        if not versions:
            raise ObjectMissing({"store": ref.store.value})
        if ref.version_id is None:
            return versions[-1]
        for stored in versions:
            if stored.version_id == ref.version_id:
                return stored
        raise ObjectMissing({"store": ref.store.value, "reason": "version"})

    def head(self, ref: ObjectRef) -> ObjectInfo:
        self._maybe_fail("head")
        return self._info(ref, self._get(ref))

    def open(self, ref: ObjectRef) -> IO[bytes]:
        self._maybe_fail("open")
        return io.BytesIO(self._get(ref).data)

    def read(self, ref: ObjectRef, *, max_bytes: int) -> bytes:
        self._maybe_fail("read")
        data = self._get(ref).data
        if len(data) > max_bytes:
            raise ProcessingError(ErrorCode.RESOURCE_LIMIT_EXCEEDED, {"limit": "read_bytes"})
        return data

    def put(
        self, ref: ObjectRef, data: IO[bytes], *, content_type: str, sha256: str, size_bytes: int
    ) -> ObjectInfo:
        self._maybe_fail("put")
        if ref.store not in self.writable_stores:
            raise StoragePermissionDenied({"store": ref.store.value})
        body = data.read()
        if len(body) != size_bytes or sha256_hex(body) != sha256:
            raise ProcessingError(ErrorCode.CHECKSUM_MISMATCH, {"field": "artifact"})
        existing = self.objects.get((ref.store.value, ref.key))
        if existing:
            current = existing[-1]
            if current.sha256 == sha256:
                return self._info(ref, current)
            raise ObjectExists({"store": ref.store.value})
        stored = StoredObject(body, content_type, self._next_version(), sha256)
        self.objects[(ref.store.value, ref.key)] = [stored]
        return self._info(ref, stored)

    def delete(self, ref: ObjectRef) -> None:
        self._maybe_fail("delete")
        if ref.store is StoreName.ASSETS:
            raise StoragePermissionDenied({"store": ref.store.value})
        if self.objects.pop((ref.store.value, ref.key), None) is not None:
            self.deleted.append((ref.store.value, ref.key))

    def keys(self, store: StoreName) -> list[str]:
        return sorted(key for (s, key) in self.objects if s == store.value)


@dataclass
class _Message:
    message_id: str
    body: bytes
    visible_at: float
    receive_count: int = 0
    receipt: str | None = None


class MemoryQueue:
    """At-least-once queue. Unacknowledged messages reappear after their visibility timeout;
    `inject_duplicate` adds a second copy with a new message id, as SQS standard queues may.
    A message received more than `max_receive_count` times moves to `dead_letters`."""

    def __init__(
        self,
        *,
        max_message_bytes: int = 240 * 1024,
        max_receive_count: int = 5,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.max_message_bytes = max_message_bytes
        self.max_receive_count = max_receive_count
        self._clock = clock or (lambda: 0.0)
        self._messages: dict[str, _Message] = {}
        self._ids = itertools.count(1)
        self._receipts = itertools.count(1)
        self.dead_letters: list[bytes] = []
        self.acked: list[str] = []

    def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
        if len(body) > self.max_message_bytes:
            raise ValueError("message exceeds the queue limit")
        message_id = f"msg-{next(self._ids):06d}"
        self._messages[message_id] = _Message(message_id, bytes(body), self._clock() + delay_seconds)
        return SendReceipt(message_id)

    def inject_duplicate(self, message_id: str) -> str:
        original = self._messages[message_id]
        return self.send(original.body).message_id

    def receive(self, *, max_messages: int = 1, visibility_seconds: int = 30) -> list[Delivery]:
        now = self._clock()
        out: list[Delivery] = []
        for message in list(self._messages.values()):
            if len(out) >= max_messages:
                break
            if message.visible_at > now:
                continue
            if message.receive_count >= self.max_receive_count:
                self.dead_letters.append(message.body)
                del self._messages[message.message_id]
                continue
            message.receive_count += 1
            message.receipt = f"rcpt-{next(self._receipts):06d}"
            message.visible_at = now + visibility_seconds
            out.append(
                Delivery(message.message_id, message.receipt, message.body, message.receive_count)
            )
        return out

    def _current(self, delivery: Delivery) -> _Message | None:
        message = self._messages.get(delivery.message_id)
        if message is None or message.receipt != delivery.receipt:
            return None
        return message

    def ack(self, delivery: Delivery) -> None:
        # A stale receipt (the message was redelivered since) is ignored, as in SQS.
        if self._current(delivery) is not None:
            del self._messages[delivery.message_id]
            self.acked.append(delivery.message_id)

    def release(self, delivery: Delivery, *, delay_seconds: int = 0) -> None:
        message = self._current(delivery)
        if message is not None:
            message.visible_at = self._clock() + delay_seconds

    def expire_visibility(self) -> None:
        """Make every in-flight message visible now (a consumer crashed or timed out)."""
        now = self._clock()
        for message in self._messages.values():
            message.visible_at = min(message.visible_at, now)

    def __len__(self) -> int:
        return len(self._messages)


@dataclass
class RecordingTelemetry:
    events: list[tuple[str, dict[str, FieldValue]]] = field(default_factory=list)
    metrics: list[tuple[str, float, str, dict[str, FieldValue]]] = field(default_factory=list)

    def event(self, name: str, **fields: FieldValue) -> None:
        self.events.append((name, check_fields(fields)))

    def metric(self, name: str, value: float, *, unit: str = "Count", **fields: FieldValue) -> None:
        self.metrics.append((name, value, unit, check_fields(fields)))

    def names(self) -> list[str]:
        return [name for name, _ in self.events]


# Re-exported for tests that need to raise a generic storage failure.
StorageFailure = StorageError
