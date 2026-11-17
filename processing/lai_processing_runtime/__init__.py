"""Runtime adapters for the processing core (LAI-LAMBDA-003, WAVE2_INTERFACES.md).

- `filesystem.FilesystemObjectStorage`, `s3.S3ObjectStorage`: `ObjectStorage` adapters.
- `sqs.SqsMessageQueue`, `local_queue.LocalDirectoryQueue`: `MessageQueue` adapters.
- `telemetry.JsonLogTelemetry`: JSON-lines `Telemetry`.
- `worker.process_work_message`: the per-record core shared by both runtimes.
- `local_worker.LocalWorker` and `python -m lai_processing_runtime`: the local worker.
- `lambda_handler.handler`: the AWS Lambda entry point.

This package never imports Django. boto3 and botocore are imported lazily, only by the S3 and
SQS adapters and the Lambda wiring, so the local worker runs without them.
"""

from .filesystem import FilesystemObjectStorage
from .local_queue import LocalDirectoryQueue
from .s3 import S3ObjectStorage
from .sqs import QueueError, SqsMessageQueue
from .telemetry import JsonLogTelemetry

__all__ = [
    "FilesystemObjectStorage",
    "JsonLogTelemetry",
    "LocalDirectoryQueue",
    "QueueError",
    "S3ObjectStorage",
    "SqsMessageQueue",
    "__version__",
]

__version__ = "0.1.0"
