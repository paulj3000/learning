"""LocalWorker: one-shot and loop modes, graceful stop, redelivery, and the end-to-end path."""

from __future__ import annotations

import io
import json
import threading
import time
from pathlib import Path

from processing_samples import FIXTURES, INPUT_BYTES, reference_request

from lai_processing.contracts.codec import decode_event, decode_request, encode
from lai_processing.contracts.common import ProfileRef
from lai_processing.contracts.identifiers import StoreName
from lai_processing.contracts.profiles import ProcessingProfile
from lai_processing.contracts.results import ResultStatus, Verdict
from lai_processing.core.processor import ProcessingContext, Processor, ProcessorOutput
from lai_processing.core.registry import ProcessorRegistry
from lai_processing.ports.queue import QueueFull, SendReceipt
from lai_processing.testing.fakes import ManualClock, MemoryQueue, RecordingTelemetry
from lai_processing_runtime import cli
from lai_processing_runtime.config import LocalRuntimeConfig
from lai_processing_runtime.filesystem import FilesystemObjectStorage
from lai_processing_runtime.local_queue import LocalDirectoryQueue
from lai_processing_runtime.local_worker import LocalWorker


def config(tmp_path: Path) -> LocalRuntimeConfig:
    return LocalRuntimeConfig(root=tmp_path / "root", assets_root=tmp_path / "assets")


def place_input(cfg: LocalRuntimeConfig, data: bytes = INPUT_BYTES) -> None:
    request = reference_request()
    assert request.input is not None
    path = cfg.root / request.input.ref.key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def test_end_to_end_reference_fixture(tmp_path: Path) -> None:
    """Wave 1 reference request -> local work queue -> LocalWorker --once -> CompletionEvent."""
    cfg = config(tmp_path)
    request_file = FIXTURES / "request.reference.json"
    request = decode_request(request_file.read_bytes())
    assert request.input is not None
    target = cfg.root / request.input.ref.key
    target.parent.mkdir(parents=True)
    target.write_bytes((FIXTURES / "request.reference.input.txt").read_bytes())
    out = io.StringIO()
    code = cli.main(["enqueue", "--root", str(cfg.root), str(request_file)], stdout=out)
    assert code == cli.EXIT_OK
    assert json.loads(out.getvalue())["job_id"] == request.job_id

    worker = LocalWorker(cfg, clock=ManualClock())  # the fixture's expiry is fixed in time
    summary = worker.run_once()
    assert (summary.received, summary.succeeded, summary.failed) == (1, 1, 0)

    completions = LocalDirectoryQueue(cfg.completion_queue_dir)
    [delivery] = completions.receive()
    event = decode_event(delivery.body)
    assert event.job_id == request.job_id and event.attempt_id == request.attempt_id
    assert event.status is ResultStatus.SUCCEEDED
    assert event.result is not None and event.result.verdict is Verdict.PASS
    [artifact] = event.result.artifacts
    assert (cfg.root / artifact.ref.key).is_file()
    assert artifact.ref.version_id == f"sha256-{artifact.sha256}"
    assert LocalDirectoryQueue(cfg.work_queue_dir).depths().to_dict() == {
        "ready": 0,
        "delayed": 0,
        "inflight": 0,
        "dead": 0,
    }
    # The artifact the consumer reads verifies through the same adapter.
    storage = FilesystemObjectStorage(cfg.storage_roots(), writable=frozenset())
    assert storage.head(artifact.ref).sha256 == artifact.sha256


def test_empty_queue_once(tmp_path: Path) -> None:
    summary = LocalWorker(config(tmp_path)).run_once()
    assert (summary.received, summary.succeeded, summary.failed) == (0, 0, 0)


def test_failed_completion_send_leaves_the_work_unacknowledged(tmp_path: Path) -> None:
    class Failing(MemoryQueue):
        def send(self, body: bytes, *, delay_seconds: int = 0) -> SendReceipt:
            raise QueueFull("down")

    cfg = config(tmp_path)
    place_input(cfg)
    work = LocalDirectoryQueue(cfg.work_queue_dir)
    work.send(encode(reference_request()))
    worker = LocalWorker(cfg, clock=ManualClock(), completions_queue=Failing())
    summary = worker.run_once()
    assert summary.failed == 1
    depths = work.depths()
    assert depths.inflight == 0 and depths.ready + depths.delayed == 1  # released, not deleted


def test_invalid_work_is_released_then_dead_lettered(tmp_path: Path) -> None:
    cfg = config(tmp_path)
    clock = [1_000_000.0]
    work = LocalDirectoryQueue(cfg.work_queue_dir, clock=lambda: clock[0])
    work.send(b"garbage")
    worker = LocalWorker(cfg, work_queue=work)
    for _ in range(5):
        assert worker.run_once().failed == 1
        clock[0] += 120  # past any backoff delay (max 60 s)
    assert worker.run_once().received == 0
    assert work.dead_letters() == [b"garbage"]
    assert LocalDirectoryQueue(cfg.completion_queue_dir).depths().ready == 0


def test_loop_with_concurrency_and_max_messages(tmp_path: Path) -> None:
    cfg = config(tmp_path)
    place_input(cfg)
    work = LocalDirectoryQueue(cfg.work_queue_dir)
    for _ in range(4):
        work.send(encode(reference_request()))  # duplicates of one attempt
    telemetry = RecordingTelemetry()
    worker = LocalWorker(
        cfg, clock=ManualClock(), concurrency=3, poll_interval=0.01, telemetry=telemetry
    )
    summary = worker.run(max_messages=4)
    assert (summary.received, summary.succeeded, summary.failed) == (4, 4, 0)
    completions = LocalDirectoryQueue(cfg.completion_queue_dir)
    bodies = [d.body for d in completions.receive(max_messages=10)]
    assert len(bodies) == 4
    events = [decode_event(b) for b in bodies]
    assert {e.result_sha256 for e in events} == {events[0].result_sha256}  # same result
    assert "worker.started" in telemetry.names() and "worker.stopped" in telemetry.names()


def blocking_registry(started: threading.Event, release: threading.Event) -> ProcessorRegistry:
    profile = ProcessingProfile(
        profile_id="blocking", version=1, job_type="reference.checksum", description="blocks"
    )

    class Blocking(Processor):
        processor_id = "test.blocking"
        version = "0.1.0"
        job_types = frozenset({"reference.checksum"})

        def profiles(self) -> tuple[ProcessingProfile, ...]:
            return (profile,)

        def process(self, context: ProcessingContext) -> ProcessorOutput:
            started.set()
            while not release.wait(0.01):
                context.check()
            return ProcessorOutput(verdict=Verdict.PASS)

    registry = ProcessorRegistry()
    registry.register(Blocking())
    registry.freeze()
    return registry


def _blocking_worker(
    tmp_path: Path, started: threading.Event, release: threading.Event
) -> tuple[LocalWorker, LocalDirectoryQueue]:
    cfg = config(tmp_path)
    place_input(cfg)
    work = LocalDirectoryQueue(cfg.work_queue_dir)
    work.send(encode(reference_request(profile=ProfileRef("blocking", 1), options={})))
    worker = LocalWorker(
        cfg,
        clock=ManualClock(),
        registry=blocking_registry(started, release),
        poll_interval=0.01,
        work_queue=work,
    )
    worker.engine.verify_idempotency_keys = False
    return worker, work


def test_first_stop_finishes_in_flight_work(tmp_path: Path) -> None:
    started, release = threading.Event(), threading.Event()
    worker, work = _blocking_worker(tmp_path, started, release)
    results: list[object] = []
    thread = threading.Thread(target=lambda: results.append(worker.run()))
    thread.start()
    assert started.wait(10)
    worker.request_stop()
    time.sleep(0.05)
    assert thread.is_alive()  # still finishing the job
    release.set()
    thread.join(10)
    summary = results[0]
    assert summary.succeeded == 1  # type: ignore[attr-defined]
    assert work.depths().to_dict() == {"ready": 0, "delayed": 0, "inflight": 0, "dead": 0}
    assert LocalDirectoryQueue(worker.config.completion_queue_dir).depths().ready == 1


def test_second_stop_cancels_and_releases_for_redelivery(tmp_path: Path) -> None:
    started, release = threading.Event(), threading.Event()
    worker, work = _blocking_worker(tmp_path, started, release)
    results: list[object] = []
    thread = threading.Thread(target=lambda: results.append(worker.run()))
    thread.start()
    assert started.wait(10)
    worker.request_stop()
    worker.handle_signal(15, None)  # the second signal
    thread.join(10)
    assert not thread.is_alive()
    assert results[0].failed == 1  # type: ignore[attr-defined]
    assert work.depths().ready == 1  # released with no delay, not acknowledged
    assert LocalDirectoryQueue(worker.config.completion_queue_dir).depths().ready == 0


def test_assets_root_layout_matches_django_local_storage(tmp_path: Path) -> None:
    cfg = config(tmp_path)
    worker = LocalWorker(cfg)
    assert isinstance(worker.storage, FilesystemObjectStorage)
    assert worker.storage.root(StoreName.ASSETS) == (tmp_path / "assets").resolve()
    assert worker.storage.writable == frozenset({StoreName.ARTIFACTS})
    assert worker.engine.namespace == "local"
