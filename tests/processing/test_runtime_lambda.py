"""The Lambda handler: real SQS event shape, partial batch failures, deadline cutoff, /tmp."""

from __future__ import annotations

import copy
import io
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from processing_samples import FIXTURES, INPUT_BYTES, reference_request

from lai_processing.contracts.codec import decode_event, encode
from lai_processing.contracts.results import ResultStatus
from lai_processing.ports.queue import QueueFull, SendReceipt
from lai_processing.testing.fakes import ManualClock, MemoryObjectStorage, MemoryQueue
from lai_processing_runtime import lambda_handler
from lai_processing_runtime.config import ConfigError, LocalRuntimeConfig, RuntimeConfig
from lai_processing_runtime.filesystem import FilesystemObjectStorage
from lai_processing_runtime.local_queue import LocalDirectoryQueue
from lai_processing_runtime.local_worker import LocalWorker
from lai_processing_runtime.s3 import S3ObjectStorage
from lai_processing_runtime.sqs import SqsMessageQueue
from lai_processing_runtime.telemetry import JsonLogTelemetry

ARN = "arn:aws:sqs:eu-west-2:123456789012:lai-dev-processing-work"
ENV = {
    "LAI_PROCESSING_NAMESPACE": "local",
    "LAI_PROCESSING_BUCKET": "lai-processing-dev-123456789012-eu-west-2",
    "LAI_ASSET_BUCKET": "lai-assets-dev",
    "LAI_PROCESSING_COMPLETION_QUEUE_URL": (
        "https://sqs.eu-west-2.amazonaws.com/123456789012/lai-dev-processing-completions"
    ),
    "LAI_PROCESSING_CLEANUP_MARGIN_SECONDS": "30",
}

# The shape of an SQS -> Lambda event as delivered by the event source mapping (synthetic ids).
CAPTURED_RECORD: dict[str, Any] = {
    "messageId": "059f36b4-87a3-44ab-83d2-661975830a7d",
    "receiptHandle": "AQEBwJnKyrHigUMZj6rYigCgxlaS3SLy0a...",
    "body": "",
    "attributes": {
        "ApproximateReceiveCount": "1",
        "SentTimestamp": "1545082649183",
        "SenderId": "AIDAIENQZJOLO23YVJ4VO",
        "ApproximateFirstReceiveTimestamp": "1545082649185",
    },
    "messageAttributes": {},
    "md5OfBody": "098f6bcd4621d373cade4e832627b4f6",
    "eventSource": "aws:sqs",
    "eventSourceARN": ARN,
    "awsRegion": "eu-west-2",
}


class Context:
    """A Lambda context whose remaining time follows a script (milliseconds per call)."""

    function_name = "lai-dev-processing-worker"
    aws_request_id = "c6af9ac6-7b61-11e6-9a41-93e8deadbeef"

    def __init__(self, *remaining_ms: int) -> None:
        self._script = list(remaining_ms)

    def get_remaining_time_in_millis(self) -> int:
        if len(self._script) > 1:
            return self._script.pop(0)
        return self._script[0]


def record(body: str, message_id: str, count: int = 1) -> dict[str, Any]:
    rec = copy.deepcopy(CAPTURED_RECORD)
    rec["body"] = body
    rec["messageId"] = message_id
    rec["attributes"]["ApproximateReceiveCount"] = str(count)
    return rec


class Env:
    def __init__(self, tmp_path: Path, completions: MemoryQueue | None = None) -> None:
        self.storage = MemoryObjectStorage()
        self.completions = completions if completions is not None else MemoryQueue()
        self.logs = io.StringIO()
        self.rt = lambda_handler.build_runtime(
            RuntimeConfig.from_env(ENV),
            storage=self.storage,
            completions=self.completions,
            telemetry=JsonLogTelemetry(self.logs),
            workspace_root=tmp_path / "ws",
        )
        self.rt.engine.clock = ManualClock()
        lambda_handler.set_runtime(self.rt)

    def seed(self) -> str:
        request = reference_request()
        self.storage.seed(request.input.ref, INPUT_BYTES)  # type: ignore[union-attr]
        return encode(request).decode()


@pytest.fixture(autouse=True)
def reset_runtime() -> Iterator[None]:
    lambda_handler.set_runtime(None)
    yield
    lambda_handler.set_runtime(None)


def test_one_good_record(tmp_path: Path) -> None:
    env = Env(tmp_path)
    body = env.seed()
    result = lambda_handler.handler({"Records": [record(body, "m-1")]}, Context(600_000))
    assert result == {"batchItemFailures": []}
    [delivery] = env.completions.receive()
    assert decode_event(delivery.body).status is ResultStatus.SUCCEEDED


def test_multiple_records_with_partial_failures(tmp_path: Path) -> None:
    env = Env(tmp_path)
    body = env.seed()
    event = {
        "Records": [
            record(body, "m-1"),
            record("not a job SECRET-MARKER", "m-2", count=3),
            record(body, "m-3", count=2),
        ]
    }
    result = lambda_handler.handler(event, Context(600_000))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-2"}]}
    assert len(env.completions) == 2
    logs = env.logs.getvalue()
    assert "SECRET" not in logs
    lines = [json.loads(line) for line in logs.splitlines()]
    invalid = [line for line in lines if line.get("event") == "work.invalid"]
    assert invalid and invalid[0]["receive_count"] == 3 and invalid[0]["level"] == "WARNING"


def test_completion_send_failure_is_a_batch_item_failure(tmp_path: Path) -> None:
    class Failing(MemoryQueue):
        def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
            raise QueueFull("down")

    env = Env(tmp_path, completions=Failing())
    body = env.seed()
    result = lambda_handler.handler({"Records": [record(body, "m-1")]}, Context(600_000))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-1"}]}


def test_remaining_time_cutoff_reports_the_rest(tmp_path: Path) -> None:
    env = Env(tmp_path)
    body = env.seed()
    event = {"Records": [record(body, "m-1"), record(body, "m-2"), record(body, "m-3")]}
    result = lambda_handler.handler(event, Context(600_000, 29_999, 600_000))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-2"}, {"itemIdentifier": "m-3"}]}
    assert len(env.completions) == 1


def test_a_short_deadline_clamps_the_job(tmp_path: Path) -> None:
    env = Env(tmp_path)
    body = env.seed()
    lambda_handler.handler({"Records": [record(body, "m-1")]}, Context(45_000))
    [delivery] = env.completions.receive()
    assert decode_event(delivery.body).status is ResultStatus.SUCCEEDED
    assert env.rt.engine.ceilings.max_execution_seconds == 840  # the cached engine is intact


def test_wrong_event_source_and_body_types_fail_the_record(tmp_path: Path) -> None:
    env = Env(tmp_path)
    body = env.seed()
    other = record(body, "m-1")
    other["eventSource"] = "aws:kinesis"
    no_body = record(body, "m-2")
    no_body["body"] = None
    result = lambda_handler.handler({"Records": [other, no_body]}, Context(600_000))
    assert result == {"batchItemFailures": [{"itemIdentifier": "m-1"}, {"itemIdentifier": "m-2"}]}


@pytest.mark.parametrize(
    "event",
    [None, [], {}, {"Records": "x"}, {"Records": [1]}, {"Records": [{"body": "{}"}]}],
)
def test_malformed_events_raise(tmp_path: Path, event: object) -> None:
    Env(tmp_path)
    with pytest.raises(ValueError):
        lambda_handler.handler(event, Context(600_000))


def test_empty_batch(tmp_path: Path) -> None:
    Env(tmp_path)
    assert lambda_handler.handler({"Records": []}, Context(600_000)) == {"batchItemFailures": []}


def test_tmp_leftovers_are_cleaned_between_invocations(tmp_path: Path) -> None:
    env = Env(tmp_path)
    body = env.seed()
    leftover = env.rt.workspace_root / "lai-proc-killed"
    leftover.mkdir(parents=True)
    (leftover / "input.bin").write_bytes(b"old")
    (env.rt.workspace_root / "stray.bin").write_bytes(b"x")
    lambda_handler.handler({"Records": [record(body, "m-1")]}, Context(600_000))
    assert list(env.rt.workspace_root.iterdir()) == []
    assert env.rt.invocations == 1


def test_clean_workspace_root_does_not_follow_symlinks(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_bytes(b"keep")
    root = tmp_path / "ws"
    root.mkdir()
    (root / "link").symlink_to(outside, target_is_directory=True)
    assert lambda_handler.clean_workspace_root(root) == 1
    assert (outside / "keep.txt").exists()


def test_runtime_is_built_lazily_from_the_environment_and_cached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name, value in ENV.items():
        monkeypatch.setenv(name, value)
    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-west-2")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    first = lambda_handler.runtime()
    assert lambda_handler.runtime() is first
    assert isinstance(first.engine.storage, S3ObjectStorage)
    assert isinstance(first.completions, SqsMessageQueue)
    assert first.engine.namespace == "local"
    assert first.engine.storage.writable == frozenset({lambda_handler.StoreName.ARTIFACTS})


def test_missing_configuration_fails_the_invocation(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ENV:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ConfigError) as caught:
        lambda_handler.handler({"Records": []}, Context(600_000))
    assert "LAI_PROCESSING_NAMESPACE" in str(caught.value)


def test_lambda_and_local_runtimes_produce_the_same_result(tmp_path: Path) -> None:
    """The same core in both runtimes: identical result bytes for the reference fixture."""
    body = (FIXTURES / "request.reference.json").read_bytes()
    data = (FIXTURES / "request.reference.input.txt").read_bytes()
    key = json.loads(body)["input"]["ref"]["key"]
    results: list[tuple[str, bytes]] = []
    for name in ("lambda", "local"):
        cfg = LocalRuntimeConfig(root=tmp_path / name, assets_root=tmp_path / name)
        (cfg.root / key).parent.mkdir(parents=True)
        (cfg.root / key).write_bytes(data)
        storage = FilesystemObjectStorage(cfg.storage_roots())
        completions = MemoryQueue()
        if name == "lambda":
            rt = lambda_handler.build_runtime(
                RuntimeConfig.from_env(ENV),
                storage=storage,
                completions=completions,
                telemetry=JsonLogTelemetry(io.StringIO()),
                workspace_root=tmp_path / "ws",
            )
            rt.engine.clock = ManualClock()
            lambda_handler.set_runtime(rt)
            text = json.dumps(json.loads(body))  # the pretty fixture, as any JSON text
            outcome = lambda_handler.handler({"Records": [record(text, "m-1")]}, Context(600_000))
            assert outcome == {"batchItemFailures": []}
        else:
            LocalDirectoryQueue(cfg.work_queue_dir).send(body)
            worker = LocalWorker(
                cfg, clock=ManualClock(), storage=storage, completions_queue=completions
            )
            assert worker.run_once().succeeded == 1
        event = decode_event(completions.receive()[0].body)
        assert event.result is not None
        results.append((event.result_sha256, encode(event.result)))
    assert results[0] == results[1]
