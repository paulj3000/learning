"""Queue transport port: at-least-once delivery, explicit acknowledgement.

Library-only; not used on the canonical path (ADR-064).

The port models what SQS standard queues guarantee and nothing more: a message may be delivered
more than once, out of order, and after a delay; it stays in flight until acknowledged or until
its visibility timeout ends. Consumers must therefore be idempotent
(docs/processing/CANONICAL_PATH.md). The same port serves the work queue (Django -> worker) and
the completion queue (worker -> Django).

`message_id` and `receipt` are transport identities. They never become job identity: the job,
attempt and idempotency key live in the message body.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

__all__ = ["Delivery", "MessageQueue", "QueueFull", "SendReceipt"]


class QueueFull(Exception):
    """The transport refused the send for a transient reason; the caller may retry."""


@dataclass(frozen=True, slots=True)
class SendReceipt:
    message_id: str


@dataclass(frozen=True, slots=True)
class Delivery:
    """One delivery of one message.

    - message_id: stable across redeliveries of the same message.
    - receipt: identifies this delivery; required to acknowledge or release it.
    - receive_count: 1 on first delivery; grows with each redelivery (SQS
      ApproximateReceiveCount). Used for poison-message handling, not for job attempts.
    """

    message_id: str
    receipt: str
    body: bytes
    receive_count: int


@runtime_checkable
class MessageQueue(Protocol):
    max_message_bytes: int

    def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
        """Enqueue `body`. Raises ValueError if it exceeds `max_message_bytes`."""
        ...

    def receive(self, *, max_messages: int = 1, visibility_seconds: int = 30) -> list[Delivery]:
        """Up to `max_messages` deliveries, hidden from other consumers for `visibility_seconds`."""
        ...

    def ack(self, delivery: Delivery) -> None:
        """Delete the message: processing (and, for completions, the database commit) is done."""
        ...

    def release(self, delivery: Delivery, *, delay_seconds: int = 0) -> None:
        """Make the message visible again after `delay_seconds`: a retryable failure."""
        ...
