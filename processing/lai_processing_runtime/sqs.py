"""`MessageQueue` on an Amazon SQS standard queue (WAVE2_INTERFACES.md, section 5).

Bodies are the canonical contract encodings, which are ASCII JSON, so they travel as the SQS
message body unchanged; no message attributes are required or sent. `receive_count` is SQS's
`ApproximateReceiveCount`. The queue URL comes from configuration, never from a message.

Errors: a transient send failure (throttling, 5xx, connection, timeout) raises the port's
`QueueFull`, which the caller may retry. Every other failure raises `QueueError` carrying only
the AWS error code and whether it looks transient; AWS error messages are never kept. A stale
receipt on `ack` or `release` (the message was redelivered, or is no longer in flight) is
ignored, as the in-memory fake does: at-least-once delivery makes it harmless.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Final

from lai_processing.ports.queue import Delivery, QueueFull, SendReceipt

__all__ = [
    "MAX_BATCH",
    "MAX_DELAY_SECONDS",
    "MAX_VISIBILITY_SECONDS",
    "MAX_WAIT_SECONDS",
    "QueueError",
    "SqsMessageQueue",
]

MAX_BATCH: Final = 10
MAX_WAIT_SECONDS: Final = 20
MAX_DELAY_SECONDS: Final = 900
MAX_VISIBILITY_SECONDS: Final = 43_200
SQS_HARD_LIMIT_BYTES: Final = 256 * 1024
_TRANSIENT: Final = frozenset(
    {
        "ThrottlingException",
        "Throttling",
        "RequestThrottled",
        "ServiceUnavailable",
        "InternalError",
        "InternalFailure",
        "KmsThrottled",
        "RequestTimeout",
        "AWS.SimpleQueueService.ServiceUnavailable",
    }
)
_STALE_RECEIPT: Final = frozenset(
    {
        "ReceiptHandleIsInvalid",
        "AWS.SimpleQueueService.ReceiptHandleIsInvalid",
        "InvalidParameterValue",
        "MessageNotInflight",
        "AWS.SimpleQueueService.MessageNotInflight",
    }
)


class QueueError(Exception):
    """A queue call failed. `code` is the AWS error code or exception type, never a message."""

    def __init__(self, operation: str, code: str, *, transient: bool) -> None:
        self.operation = operation
        self.code = code
        self.transient = transient
        super().__init__(f"queue {operation} failed ({code})")


def _classify(exc: BaseException) -> tuple[str, bool]:
    """(code, transient) for a botocore failure, or ("", False) for anything else."""
    from botocore.exceptions import BotoCoreError, ClientError

    if isinstance(exc, ClientError):
        response: Mapping[str, Any] = getattr(exc, "response", {}) or {}
        code = str((response.get("Error") or {}).get("Code", "") or "")[:64]
        meta = response.get("ResponseMetadata") or {}
        try:
            status = int(meta.get("HTTPStatusCode", 0) or 0)
        except (TypeError, ValueError):
            status = 0
        return code or str(status), code in _TRANSIENT or status >= 500 or status == 429
    if isinstance(exc, BotoCoreError):
        return type(exc).__name__, True
    if isinstance(exc, (ConnectionError, TimeoutError)):
        return type(exc).__name__, True
    return "", False


def _check_seconds(value: int, maximum: int, name: str) -> int:
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError(f"{name} must be an integer from 0 to {maximum}")
    return value


class SqsMessageQueue:
    def __init__(
        self,
        client: Any,
        queue_url: str,
        *,
        max_message_bytes: int = 240 * 1024,
        wait_seconds: int = MAX_WAIT_SECONDS,
    ) -> None:
        if type(max_message_bytes) is not int or not 0 < max_message_bytes <= SQS_HARD_LIMIT_BYTES:
            raise ValueError("max_message_bytes must be from 1 to 262144")
        self._client = client
        self._url = queue_url
        self.max_message_bytes = max_message_bytes
        self.wait_seconds = _check_seconds(wait_seconds, MAX_WAIT_SECONDS, "wait_seconds")

    def _call(self, operation: str, method: str, **params: Any) -> Any:
        try:
            return getattr(self._client, method)(QueueUrl=self._url, **params)
        except Exception as exc:  # noqa: BLE001 - classified, never echoed
            code, transient = _classify(exc)
            if not code:
                raise
            raise QueueError(operation, code, transient=transient) from None

    def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
        if len(body) > self.max_message_bytes:
            raise ValueError("message exceeds the queue limit")
        _check_seconds(delay_seconds, MAX_DELAY_SECONDS, "delay_seconds")
        try:
            text = bytes(body).decode("utf-8")
        except UnicodeDecodeError:
            raise ValueError("message body must be UTF-8 text") from None
        params: dict[str, Any] = {"MessageBody": text}
        if delay_seconds:
            params["DelaySeconds"] = delay_seconds
        try:
            response = self._call("send", "send_message", **params)
        except QueueError as error:
            if error.transient:
                raise QueueFull(f"queue send failed ({error.code})") from None
            raise
        return SendReceipt(message_id=str(response["MessageId"]))

    def receive(self, *, max_messages: int = 1, visibility_seconds: int = 30) -> list[Delivery]:
        if type(max_messages) is not int or not 1 <= max_messages <= MAX_BATCH:
            raise ValueError(f"max_messages must be from 1 to {MAX_BATCH}")
        _check_seconds(visibility_seconds, MAX_VISIBILITY_SECONDS, "visibility_seconds")
        response = self._call(
            "receive",
            "receive_message",
            MaxNumberOfMessages=max_messages,
            WaitTimeSeconds=self.wait_seconds,
            VisibilityTimeout=visibility_seconds,
            AttributeNames=["ApproximateReceiveCount"],
        )
        deliveries: list[Delivery] = []
        for message in response.get("Messages", []) or []:
            attributes = message.get("Attributes") or {}
            try:
                count = max(1, int(attributes.get("ApproximateReceiveCount", 1)))
            except (TypeError, ValueError):
                count = 1
            deliveries.append(
                Delivery(
                    message_id=str(message["MessageId"]),
                    receipt=str(message["ReceiptHandle"]),
                    body=str(message.get("Body", "")).encode("utf-8"),
                    receive_count=count,
                )
            )
        return deliveries

    def ack(self, delivery: Delivery) -> None:
        try:
            self._call("ack", "delete_message", ReceiptHandle=delivery.receipt)
        except QueueError as error:
            if error.code not in _STALE_RECEIPT:
                raise

    def release(self, delivery: Delivery, *, delay_seconds: int = 0) -> None:
        _check_seconds(delay_seconds, MAX_VISIBILITY_SECONDS, "delay_seconds")
        try:
            self._call(
                "release",
                "change_message_visibility",
                ReceiptHandle=delivery.receipt,
                VisibilityTimeout=delay_seconds,
            )
        except QueueError as error:
            if error.code not in _STALE_RECEIPT:
                raise
