"""Runtime-independent ports. Adapters implement these; the core depends only on them."""

from .clock import Clock, SystemClock
from .queue import Delivery, MessageQueue, QueueFull, SendReceipt
from .storage import (
    ObjectExists,
    ObjectInfo,
    ObjectMissing,
    ObjectStorage,
    StorageError,
    StoragePermissionDenied,
    StorageUnavailable,
)
from .telemetry import SAFE_FIELDS, LoggingTelemetry, NullTelemetry, Telemetry, check_fields

__all__ = [
    "SAFE_FIELDS",
    "Clock",
    "Delivery",
    "LoggingTelemetry",
    "MessageQueue",
    "NullTelemetry",
    "ObjectExists",
    "ObjectInfo",
    "ObjectMissing",
    "ObjectStorage",
    "QueueFull",
    "SendReceipt",
    "StorageError",
    "StoragePermissionDenied",
    "StorageUnavailable",
    "SystemClock",
    "Telemetry",
    "check_fields",
]
