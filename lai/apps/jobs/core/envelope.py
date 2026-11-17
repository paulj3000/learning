"""Work and result envelopes, schema 1 (the jobs contract shared with the Lambda worker).

Work (Django -> SQS work queue -> worker):
    {"schema": 1, "job_id": "<uuid>", "kind": "<kind>", "attempt": 1,
     "submitted_at": "<iso>", "payload": {...}}

Result (worker -> SQS results queue -> `manage.py jobs_consume_results`):
    {"schema": 1, "job_id", "kind", "status": "running"|"succeeded"|"failed",
     "result": {...}|null, "result_s3_key": str|null,
     "error": {"code": str, "retryable": bool}|null,
     "worker": {"function": str, "request_id": str}, "finished_at": "<iso>"}

Validation is strict: unknown keys, wrong types and malformed values are rejected, and the
error message names only the field (never a value), so it is safe to log.
"""

import json
import re
import uuid
from datetime import UTC, datetime

SCHEMA = 1

STUDIO_GENERATE_CHUNK = "studio.generate_chunk"
SPEECH_SYNTHESIZE = "speech.synthesize"
ASSET_INSPECT = "asset.inspect"
#: Contract kinds (ADR-061 payload and result inside the schema-1 envelope; core/contract.py).
ASSET_VALIDATE_MODEL = "asset.validate_model"
REFERENCE_CHECKSUM = "reference.checksum"
#: LAI-LAMBDA-008 phase 1: audio header inspection (staff-triggered; never on upload).
ASSET_PROCESS_AUDIO = "asset.process_audio"

#: Which work queue (and so which worker function) runs each kind.
KIND_QUEUE = {
    STUDIO_GENERATE_CHUNK: "ai",
    SPEECH_SYNTHESIZE: "media",
    ASSET_INSPECT: "media",
    ASSET_VALIDATE_MODEL: "media",
    REFERENCE_CHECKSUM: "media",
    ASSET_PROCESS_AUDIO: "media",
}
KINDS = frozenset(KIND_QUEUE)
QUEUES = frozenset(KIND_QUEUE.values())

RUNNING = "running"
SUCCEEDED = "succeeded"
FAILED = "failed"
RESULT_STATUSES = frozenset({RUNNING, SUCCEEDED, FAILED})

#: Results larger than this travel through S3 (`result_s3_key`), not the SQS message.
INLINE_RESULT_LIMIT = 200 * 1024
RESULTS_PREFIX = "jobs/results/"

_CODE = re.compile(r"^[a-z0-9_]{1,64}$")
_WORK_KEYS = frozenset({"schema", "job_id", "kind", "attempt", "submitted_at", "payload"})
_RESULT_KEYS = frozenset(
    {
        "schema",
        "job_id",
        "kind",
        "status",
        "result",
        "result_s3_key",
        "error",
        "worker",
        "finished_at",
    }
)


class EnvelopeError(ValueError):
    """An envelope that breaks the contract. The message names a field, never a value."""


def kinds_for_queue(queue: str) -> frozenset[str]:
    return frozenset(kind for kind, owner in KIND_QUEUE.items() if owner == queue)


def result_key(job_id: str) -> str:
    return f"{RESULTS_PREFIX}{job_id}.json"


def iso_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _uuid(value: object) -> str:
    if not isinstance(value, str):
        raise EnvelopeError("job_id")
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise EnvelopeError("job_id") from None
    if str(parsed) != value.lower():
        raise EnvelopeError("job_id")
    return str(parsed)


def _iso(value: object, field: str) -> str:
    if not isinstance(value, str) or len(value) > 40:
        raise EnvelopeError(field)
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise EnvelopeError(field) from None
    return value


def _object(raw: object) -> dict:
    if isinstance(raw, bytes | str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise EnvelopeError("json") from None
    if not isinstance(raw, dict):
        raise EnvelopeError("envelope")
    return raw


def _exact_keys(data: dict, allowed: frozenset[str]) -> None:
    if set(data) != allowed:
        raise EnvelopeError("keys")


def _schema(data: dict) -> None:
    if type(data.get("schema")) is not int or data["schema"] != SCHEMA:
        raise EnvelopeError("schema")


def build_work(job_id: str, kind: str, payload: dict, *, attempt: int = 1) -> dict:
    envelope = {
        "schema": SCHEMA,
        "job_id": str(job_id),
        "kind": kind,
        "attempt": attempt,
        "submitted_at": iso_now(),
        "payload": payload,
    }
    return parse_work(envelope)


def parse_work(raw: object, *, allowed_kinds: frozenset[str] = KINDS) -> dict:
    """A validated work envelope. `allowed_kinds` narrows the kinds (a worker's own queue)."""
    data = _object(raw)
    _exact_keys(data, _WORK_KEYS)
    _schema(data)
    data["job_id"] = _uuid(data["job_id"])
    if data["kind"] not in KINDS:
        raise EnvelopeError("kind")
    if data["kind"] not in allowed_kinds:
        raise EnvelopeError("queue")
    attempt = data["attempt"]
    if type(attempt) is not int or not 1 <= attempt <= 100:
        raise EnvelopeError("attempt")
    _iso(data["submitted_at"], "submitted_at")
    if not isinstance(data["payload"], dict):
        raise EnvelopeError("payload")
    return data


def build_result(
    job_id: str,
    kind: str,
    status: str,
    *,
    result: dict | None = None,
    error_code: str | None = None,
    retryable: bool = False,
    function: str = "",
    request_id: str = "",
    result_s3_key: str | None = None,
) -> dict:
    envelope = {
        "schema": SCHEMA,
        "job_id": str(job_id),
        "kind": kind,
        "status": status,
        "result": result,
        "result_s3_key": result_s3_key,
        "error": {"code": error_code, "retryable": bool(retryable)} if error_code else None,
        "worker": {"function": function[:140], "request_id": request_id[:100]},
        "finished_at": iso_now(),
    }
    return parse_result(envelope)


def parse_result(raw: object) -> dict:
    """A validated result envelope (see the module docstring for the rules)."""
    data = _object(raw)
    _exact_keys(data, _RESULT_KEYS)
    _schema(data)
    job_id = data["job_id"] = _uuid(data["job_id"])
    if data["kind"] not in KINDS:
        raise EnvelopeError("kind")
    status = data["status"]
    if status not in RESULT_STATUSES:
        raise EnvelopeError("status")
    result, pointer, error = data["result"], data["result_s3_key"], data["error"]
    if result is not None and not isinstance(result, dict):
        raise EnvelopeError("result")
    if pointer is not None and pointer != result_key(job_id):
        raise EnvelopeError("result_s3_key")
    if result is not None and pointer is not None:
        raise EnvelopeError("result")
    if error is not None:
        if not isinstance(error, dict) or set(error) != {"code", "retryable"}:
            raise EnvelopeError("error")
        if not isinstance(error["code"], str) or not _CODE.fullmatch(error["code"]):
            raise EnvelopeError("error.code")
        if type(error["retryable"]) is not bool:
            raise EnvelopeError("error.retryable")
    if status == FAILED and error is None:
        raise EnvelopeError("error")
    if status != FAILED and error is not None:
        raise EnvelopeError("error")
    if status == RUNNING and (result is not None or pointer is not None):
        raise EnvelopeError("result")
    if status == SUCCEEDED and result is None and pointer is None:
        raise EnvelopeError("result")
    worker = data["worker"]
    if (
        not isinstance(worker, dict)
        or set(worker) != {"function", "request_id"}
        or not all(isinstance(worker[k], str) and len(worker[k]) <= 140 for k in worker)
    ):
        raise EnvelopeError("worker")
    _iso(data["finished_at"], "finished_at")
    return data


def encode(envelope: dict) -> str:
    return json.dumps(envelope, separators=(",", ":"), sort_keys=True)


def for_message(envelope: dict) -> dict:
    """The SQS form of a final result: inline when small, an S3 pointer otherwise.

    The worker always stores the full envelope at `result_key(job_id)` first, so a pointer is
    always resolvable and a redelivered work message can re-send the same result.
    """
    if envelope["result"] is None or len(encode(envelope).encode()) <= INLINE_RESULT_LIMIT:
        return envelope
    return {**envelope, "result": None, "result_s3_key": result_key(envelope["job_id"])}
