"""In-memory test adapters (no AWS, no Django). Safe to import from any test suite."""

from .fakes import ManualClock, MemoryObjectStorage, MemoryQueue, RecordingTelemetry, StoredObject

__all__ = [
    "ManualClock",
    "MemoryObjectStorage",
    "MemoryQueue",
    "RecordingTelemetry",
    "StoredObject",
]
