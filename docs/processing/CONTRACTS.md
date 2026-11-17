# Processing contracts, schema version 1

Source of truth: the code in `processing/lai_processing/contracts/` and
`processing/lai_processing/core/`. If this page and the code disagree, the code wins and this
page is the bug. Field rules below were read from commit `3c34409`.

## 1. Message kinds

| `kind` | Python type | Sent by | Sent to |
|---|---|---|---|
| `lai.processing.job_request` | `ProcessingJobRequest` (`contracts/jobs.py`) | Django (outbox dispatcher) | Work queue |
| `lai.processing.job_result` | `ProcessingJobResult` (`contracts/results.py`) | Worker | Inline in an event, or stored as an artifact |
| `lai.processing.job_completed` | `CompletionEvent` (`contracts/events.py`) | Worker | Completion queue |

`ArtifactReference`, `ProcessingProfile` and `ResourceLimits` are parts of messages or code
declarations, not messages of their own.

## 2. General rules (all messages)

| Rule | Where enforced |
|---|---|
| Every key listed for a message is **required**; nullable fields are present with `null`. Unknown keys are refused. | `_fields.exact_keys` |
| Encoding is canonical JSON: sorted keys, compact separators, ASCII only, no NaN or infinity. Equal values give equal bytes. | `core/canonical.canonical_json`, `codec.encode` |
| Decoding order: byte size limit, strict UTF-8, bracket depth (32), JSON with duplicate keys refused and NaN/Infinity refused, nested depth check, `kind`, `schema_version`, then full validation. | `codec.load_json`, `codec.decode` |
| Default decode size limit: 240 KiB (`DEFAULT_MAX_MESSAGE_BYTES`, below the 256 KiB SQS limit). | `codec.py` |
| Timestamps: `YYYY-MM-DDTHH:MM:SS[.ffffff]Z`, UTC only. Encoded with microseconds. Naive datetimes are refused. | `core/canonical.py` |
| Every failure is a `ProcessingError` with `details.field` naming the path. The offending value is never echoed. | `_fields.py` |
| Messages never contain file bytes, presigned URLs, bucket names, credentials or child data. | Design rule; `ObjectRef` names a logical store, not a bucket |

### 2.1 Identifier formats (`contracts/identifiers.py`)

| Name | Pattern | Max length | Used for |
|---|---|---|---|
| UUID | lowercase `8-4-4-4-12` hex | 36 | `job_id`, `attempt_id`, `event_id`, `asset_version_id`, `source_*_id` |
| NAMESPACE | `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` | 32 | `namespace` (environment, e.g. `dev`) |
| DOTTED_NAME | `^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$` | 64 | `job_type`, `processor_id`, `artifact_type` |
| SLUG | `^[a-z0-9]+(?:-[a-z0-9]+)*$` | 64 (asset id: 100) | `profile_id`, `asset_id` (same rule as `lai/apps/assets/storage.py`) |
| SNAKE | `^[a-z][a-z0-9_]*$` | 64 | `subject_type`, finding and warning `code` |
| SEMVER | `MAJOR.MINOR.PATCH` digits, no leading zeros | 32 | `processor_version` |
| SHA256 | 64 lowercase hex | 64 | every checksum |
| CORRELATION_ID | `^[A-Za-z0-9._-]{8,64}$` | 64 | `correlation_id` (same rule as `lai/apps/core/request_context.py`) |
| IDEMPOTENCY_KEY | `^ik1:[0-9a-f]{64}$` | 68 | `idempotency_key` |
| SUBJECT_ID | `^[A-Za-z0-9._:-]{1,128}$` | 128 | `subject.subject_id` |
| CONTENT_TYPE | `^[a-z]+/[a-z0-9][a-z0-9.+-]*$` | 100 | content types |
| OBJECT_VERSION_ID | `^[A-Za-z0-9._=+-]{1,1024}$` | 1024 | S3 object version ids |
| LOGICAL_ID | `^[a-z0-9]+(?:[-_][a-z0-9]+)*$` | 64 | artifact `logical_id` |

### 2.2 Object references (`ObjectRef`, `check_object_key`)

| Field | Type | Rule |
|---|---|---|
| `store` | `"assets"`, `"quarantine"` or `"artifacts"` | Logical store; adapters map (namespace, store) to a bucket |
| `key` | string | 1 to 1024 chars of `[A-Za-z0-9._=/-]`; no leading or trailing `/`; no empty, `.` or `..` segment; must start with the store prefix |
| `version_id` | string or null | OBJECT_VERSION_ID; when set, exactly that object version is read |

| Store | Key prefix | Namespaced | Readable by worker | Writable by worker |
|---|---|---|---|---|
| `assets` | `assets/` (the Asset Library's existing keys) | No: the environment is the bucket | Yes (input) | No |
| `quarantine` | `processing/quarantine/<namespace>/` | Yes | Yes (input) | No |
| `artifacts` | `processing/artifacts/<namespace>/<job_id>/<attempt_id>/` | Yes | Result-by-reference only | Yes, create-only, own attempt prefix only |

Artifact keys are built only by `artifact_key(namespace, job_id, attempt_id, logical_id,
extension)`: `processing/artifacts/<namespace>/<job_id>/<attempt_id>/<logical_id>.<ext>`
(extension `^[a-z0-9]{1,10}$`).

## 3. `ProcessingJobRequest` (`kind = lai.processing.job_request`)

| Field | Type | Constraints | Meaning |
|---|---|---|---|
| `kind` | string | exactly `lai.processing.job_request` | Message kind |
| `schema_version` | int | in `SUPPORTED_SCHEMA_VERSIONS` (`{1}`) | Contract version |
| `job_id` | string | UUID | Django's job row |
| `job_type` | string | a key of `JOB_TYPES` (section 7), else `UNSUPPORTED_JOB_TYPE` | What to do |
| `namespace` | string | NAMESPACE | Environment the job belongs to |
| `subject` | object | `{subject_type: SNAKE, subject_id: SUBJECT_ID}` | What the job is about; for asset jobs `("asset_version", <asset_version_id>)` |
| `asset` | object or null | `{asset_id: SLUG<=100, asset_version_id: UUID, asset_version_number: int>=1}`; required when the job type `requires_asset` | Asset context (`AssetVersion` in Django) |
| `profile` | object | `{profile_id: SLUG, version: 1..1000000}` | Processing profile version to apply |
| `input` | object or null | `{ref: ObjectRef (assets or quarantine), content_type, size_bytes: 0..2^53, sha256}`; required when the job type `requires_input`; `size_bytes <= limits.max_input_bytes` else `RESOURCE_LIMIT_EXCEEDED`; quarantine key must be in this namespace | The one input and what it must be |
| `idempotency_key` | string | IDEMPOTENCY_KEY | Identity of the logical work (`LIFECYCLE.md` section 1) |
| `correlation_id` | string | CORRELATION_ID | Log tracing only |
| `attempt_id` | string | UUID | This execution attempt; new on every retry |
| `attempt_number` | int | 1 to 100 (`MAX_ATTEMPT_NUMBER`) | Ordinal of the attempt |
| `submitted_at` | timestamp | UTC | When Django queued this attempt |
| `expires_at` | timestamp or null | after `submitted_at` | After this, the worker refuses the job with `JOB_EXPIRED` |
| `options` | object | at most 32 keys `^[a-z][a-z0-9_]{0,63}$`; values are scalars (strings at most 256 chars, no control characters; ints within 2^53; finite floats; bool; null) or lists of at most 32 scalars | Requested options, resolved against the profile by the worker |
| `limits` | object | `ResourceLimits` (section 6) | Requested limits; clamped by the worker |

Cross-field rules: job-type spec (`requires_input`, `requires_asset`, `subject_type`); when the
subject is an `asset_version`, `subject.subject_id` must equal `asset.asset_version_id`.

## 4. `ProcessingJobResult` (`kind = lai.processing.job_result`)

| Field | Type | Constraints | Meaning |
|---|---|---|---|
| `kind`, `schema_version` | | as above, kind `lai.processing.job_result` | |
| `job_id`, `job_type`, `namespace`, `idempotency_key`, `correlation_id`, `attempt_id`, `attempt_number` | | same rules as the request | Copied from the request this attempt executed |
| `processor` | object or null | `{processor_id: DOTTED_NAME, processor_version: SEMVER}`; required when `succeeded` | Which processor release ran (null when none could be resolved) |
| `profile` | object | ProfileRef | Profile applied |
| `status` | `succeeded`, `failed`, `cancelled` | | Did the worker run the job to the end |
| `verdict` | `pass`, `fail`, `not_applicable`, or null | required when `succeeded`, null otherwise | What the processor concluded about the input |
| `retry_class` | string or null | must equal `errors[0].retry_class`; null when `succeeded` | Derived, repeated for easy routing |
| `input` | object or null | `{ref, sha256, size_bytes, verified: bool}` | The input as observed; `verified` only when the whole object was read and matched |
| `started_at`, `completed_at` | timestamps | `completed_at >= started_at` | Attempt timing |
| `duration_ms` | int | 0 to 86,400,000 | Elapsed time |
| `metadata` | object | plain JSON, depth at most 16, keys at most 128 chars; canonical size at most 256 KiB (`MAX_RESULT_METADATA_BYTES`); the job's `max_metadata_bytes` is enforced by the engine | Processor-specific facts (for a model: counts, bounds, clips) |
| `findings` | list of Finding | at most 500 | `{code: SNAKE, severity: error/warning/info, message: text<=500, path: text<=200}`; same shape as `AssetVersion.validation_report` |
| `warnings` | list | at most 50 | `{code: SNAKE, message: text<=500}`: notes about the run, not the input |
| `errors` | list of JobError | at most 8; at least 1 unless `succeeded` | `{code: ErrorCode, retry_class, message, details}` (section 8) |
| `artifacts` | list of ArtifactReference | unique `logical_id`; each from this job and attempt, this namespace, same `processor` and `profile` | Derived objects |

Status invariants (`_check_status_invariants`):

| `status` | `errors` | `verdict` | `processor` | Other |
|---|---|---|---|---|
| `succeeded` | empty | required | required | `pass` is refused if any finding has severity `error` |
| `failed` | at least one, first is not `cancelled` | null | optional | |
| `cancelled` | first error code is `cancelled` | null | optional | |

`JobError` is self-checking: `retry_class` must equal the code's classification and `message`
must equal the code's fixed safe message, so a result cannot carry free text. `details` must
survive `safe_details` unchanged (at most 16 entries, identifier keys at most 64 chars, scalar
values, strings at most 200 chars without newlines).

## 5. `ArtifactReference` and `CompletionEvent`

### 5.1 `ArtifactReference` (`contracts/artifacts.py`)

| Field | Type | Constraints | Meaning |
|---|---|---|---|
| `artifact_type` | string | DOTTED_NAME | What it is, e.g. `report.job_result` |
| `logical_id` | string | LOGICAL_ID | Stable name inside the attempt |
| `ref` | ObjectRef | store `artifacts`; key under `artifact_prefix(namespace, source_job_id, source_attempt_id)` | Where it is |
| `content_type` | string | CONTENT_TYPE | Media type |
| `size_bytes` | int | 0 to 2^53 | Size |
| `sha256` | string | SHA256 | Checksum of the stored bytes |
| `source_job_id`, `source_attempt_id` | UUID | | Producing job and attempt (cross-job substitution check) |
| `processor` | ProcessorIdentity | | Producer |
| `profile` | ProfileRef | | Profile used |

A presigned URL is never an artifact identity; Django issues URLs on demand.

### 5.2 `CompletionEvent` (`kind = lai.processing.job_completed`)

| Field | Type | Constraints | Meaning |
|---|---|---|---|
| `kind`, `schema_version` | | kind `lai.processing.job_completed` | |
| `event_id` | UUID | | Identity of this event (diagnostics; not the dedup key) |
| `emitted_at` | timestamp | | When the worker emitted it |
| `job_id`, `job_type`, `namespace`, `idempotency_key`, `correlation_id`, `attempt_id`, `attempt_number`, `status` | | must equal the result's fields (`_MIRRORED`) | Routing envelope |
| `retry_class` | string or null | inline: must equal the result's; by reference: any valid RetryClass or null | Routing hint |
| `result_sha256` | SHA256 | SHA-256 of the result's canonical JSON | Integrity of the result |
| `result` | object or null | exactly one of `result` and `result_ref` is non-null | Inline result |
| `result_ref` | ArtifactReference or null | `artifact_type == "report.job_result"`, same job and attempt, same namespace, `sha256 == result_sha256` | Result stored as an artifact |

`build_completion_event` inlines the result when the encoded event fits `max_message_bytes`;
otherwise it stores the canonical result through a `store_result` callback as an artifact
(logical id `job-result`) and references it. Without the callback an oversized result fails with
`MESSAGE_TOO_LARGE`: large data never travels on a queue. After reading a referenced result, the
consumer calls `CompletionEvent.verify_result(result)`, which checks the mirrored fields and the
digest (`CHECKSUM_MISMATCH` on a mismatch).

## 6. `ResourceLimits` (`core/limits.py`)

All values are integers in `1..2^53`. `complexity` holds at most 32 processor-specific counters,
keys `^[a-z][a-z0-9_]{0,63}$`. The worker uses `effective_limits(requested, PLATFORM_CEILINGS)`:
each value is the minimum of the request and the ceiling; a complexity counter is clamped only if
the ceiling names it.

| Field | Meaning | `DEFAULT_LIMITS` | `PLATFORM_CEILINGS` |
|---|---|---|---|
| `max_input_bytes` | Largest input object | 50 MiB (matches `LAI_ASSET_MAX_UPLOAD_BYTES` default) | 512 MiB |
| `max_output_bytes` | Total artifact bytes | 200 MiB | 1024 MiB |
| `max_execution_seconds` | Wall-clock budget (cooperative) | 300 | 840 (below Lambda's 900 s, margin for cleanup and publish) |
| `max_temp_bytes` | Private workspace budget | 400 MiB | 10 GiB (Lambda ephemeral maximum) |
| `max_artifact_count` | Artifacts per result | 16 | 64 |
| `max_metadata_bytes` | Canonical size of `metadata` | 64 KiB | 256 KiB |
| `max_message_bytes` | Size of any request, result or event | 64 KiB | 240 KiB |
| `complexity` | e.g. `{"max_vertices": 200000}` | `{}` | `{}` |

## 7. Job types and profiles

### 7.1 Closed job-type catalog (`contracts/job_types.py`)

| `job_type` | Category | Requires asset | Requires input | Subject type | Owner task | State |
|---|---|---|---|---|---|---|
| `reference.checksum` | reference | No | Yes | any | LAI-LAMBDA-001 | Reference processor (Wave 1) |
| `asset.validate_model` | asset | Yes | Yes | `asset_version` | LAI-LAMBDA-002 | Contract frozen, processor Wave 2 |
| `asset.process_audio` | asset | Yes | Yes | `asset_version` | LAI-LAMBDA-008 | Reserved |
| `asset.analyze_animation` | asset | Yes | Yes | `asset_version` | LAI-LAMBDA-009 | Reserved |
| `asset.optimize` | asset | Yes | Yes | `asset_version` | LAI-LAMBDA-010 | Reserved |

A job type is declared in code before any message may name it. No dynamic registration, no code
loading from a message. Whether a processor exists is a separate question for the processor
registry (`UNSUPPORTED_PROCESSOR`, MANUAL).

### 7.2 `ProcessingProfile` (`contracts/profiles.py`)

Declared in code next to its processor; never sent on the wire (requests carry only a
`ProfileRef`). A profile version is immutable once used; new behaviour is a new version.

| Field | Type | Meaning |
|---|---|---|
| `profile_id` | SLUG | Name |
| `version` | int 1..1,000,000 | Immutable version |
| `job_type` | catalog key | The job type it serves |
| `description` | string | Human description |
| `options` | map of SNAKE name to `OptionSpec` | Options a request may set |
| `limits` | ResourceLimits | Default limits (default `DEFAULT_LIMITS`) |

`OptionSpec`: `type` (`bool`, `int`, `str`), `default`, `required` (a required option has no
default), `choices`, `minimum`, `maximum`. `resolve_options(supplied)` refuses unknown options,
wrong types, values out of range or outside `choices`, and missing required options, all with
`INVALID_PROCESSING_PROFILE`, and returns sorted resolved options with defaults filled in.
Note: the request envelope admits floats, nulls and lists in `options`, but a profile accepts only
`bool`, `int` and `str`, so those are refused at resolution.

## 8. Error codes (`core/errors.py`)

Retry classes: **retryable** (transient; bounded retries), **permanent** (input or request wrong),
**cancelled** (never retried), **manual** (an operator must act; not retried automatically).

| Code | Retry class | Fixed safe message |
|---|---|---|
| `invalid_input` | permanent | The job request or its input is not valid. |
| `unsupported_input` | permanent | The input file type is not supported by this processor. |
| `unsupported_schema_version` | permanent | The message schema version is not supported. |
| `unsupported_job_type` | permanent | The job type is not known. |
| `unsupported_processor` | manual | No registered processor handles this job. |
| `invalid_processing_profile` | permanent | The processing profile is not valid for this job. |
| `invalid_object_reference` | permanent | An object reference is malformed or not allowed. |
| `checksum_mismatch` | permanent | The input does not match its recorded checksum or size. |
| `input_missing` | manual | The input object does not exist. |
| `permission_denied` | manual | The worker is not allowed to access a required object. |
| `resource_limit_exceeded` | permanent | The job exceeded a processing limit. |
| `message_too_large` | permanent | The message exceeds the maximum allowed size. |
| `processing_timeout` | retryable | The job did not finish within its time limit. |
| `temporary_failure` | retryable | A temporary failure interrupted the job. |
| `throttled` | retryable | A dependent service throttled the job. |
| `storage_failure` | retryable | The storage service failed. |
| `artifact_conflict` | manual | A different artifact already exists at the target location. |
| `duplicate_request` | permanent | This job attempt was already processed. |
| `job_expired` | permanent | The job expired before it could be processed. |
| `namespace_mismatch` | permanent | The job belongs to a different environment. |
| `unexpected_failure` | manual | The processor failed unexpectedly. |
| `cancelled` | cancelled | The job was cancelled. |

`error_from_exception` maps `TimeoutError` to `processing_timeout`, `MemoryError` to
`resource_limit_exceeded`, `PermissionError` to `permission_denied`, `ConnectionError` to
`temporary_failure`, and anything else to `unexpected_failure` (manual, so an unknown bug is not
retried in a loop). Only the exception type name is kept, as `details.exception_type`.

Storage port exceptions carry their codes: `ObjectMissing` (`input_missing`),
`StoragePermissionDenied` (`permission_denied`), `StorageUnavailable` (`storage_failure`),
`ObjectExists` (`artifact_conflict`).

## 9. Compatibility rules

1. Readers accept every version in `SUPPORTED_SCHEMA_VERSIONS` and refuse others with
   `unsupported_schema_version` (permanent). Today that set is `{1}`.
2. **Any change that makes a previously valid message invalid, or changes what a field means, is
   a new schema version.** That includes adding a required field, removing a field, narrowing a
   pattern or bound, adding an enum value a reader would refuse, and changing a default's effect.
   Because unknown keys are refused, adding even an optional field is a new version.
3. **Consumer first.** Django must deploy a reader for version N+1 before any writer emits N+1.
   The order for a work-message change: workers learn to read N+1, then Django emits it. For a
   completion change: Django learns to read N+1, then workers emit it.
4. **Dual-read window.** Readers accept N and N+1 until no N message can remain in any queue or
   DLQ (at least the queue retention, 14 days, plus the replay window), then N is dropped.
5. A job type, profile version or processor version is never reused with different behaviour.
6. Contract changes go through the principal (`WAVE2_HANDOFF.md`, "Change control").

Note on rule 4: at `3c34409` each dataclass's `__post_init__` checks `schema_version ==
SCHEMA_VERSION`, not membership in `SUPPORTED_SCHEMA_VERSIONS`. That is correct while only v1
exists; the first v2 change must widen these checks to make the dual-read window real.

## 10. Examples and JSON Schemas

Fixtures and schemas ship as package data (`pyproject.toml`: `fixtures/*.json`,
`schemas/*.json`). They are being written by a parallel Wave 1 agent and were not in commit
`3c34409`; the planned files are:

| File (under `processing/lai_processing/contracts/`) | Shows |
|---|---|
| `fixtures/request.reference.json` | A `reference.checksum` request |
| `fixtures/request.asset_validate_model.json` | An `asset.validate_model` request with an `asset` context |
| `fixtures/result.succeeded.json` | A succeeded result with a verdict |
| `fixtures/result.failed_retryable.json` | A failed result with a retryable error |
| `fixtures/result.cancelled.json` | A cancelled result |
| `fixtures/event.inline.json` | A completion event with the result inline |
| `fixtures/event.by_reference.json` | A completion event with `result_ref` |
| `fixtures/invalid/manifest.json` | Invalid messages and the error each must produce |
| `schemas/job_request.v1.schema.json` | JSON Schema for requests |
| `schemas/job_result.v1.schema.json` | JSON Schema for results |
| `schemas/job_completed.v1.schema.json` | JSON Schema for events |

The JSON Schemas are documentation and cross-language aids. The Python contracts are
authoritative: some rules (status invariants, artifact prefixes, digest checks) are not
expressible in JSON Schema.

## 11. Inspecting contracts with the CLI

The CLI (`python -m lai_processing`, also installed as `lai-processing`) is being written by the
principal in Wave 1. Planned commands:

| Command | Does |
|---|---|
| `python -m lai_processing --version` / `--help` | Version and usage |
| `python -m lai_processing processors list` | Registered processors and the job types they serve |
| `python -m lai_processing validate-job FILE` | Strictly decode a request and report the first error's code and field |
| `python -m lai_processing run FILE --input-file PATH --output-dir DIR` | Execute a request locally against a file, write the result and artifacts |

Exit codes: `0` success; `1` the job failed (a result is still written); `2` usage error;
`3` the request is invalid.

Example (once the CLI and fixtures are merged; run from the repository root):

```bash
pip install ./processing
python -m lai_processing validate-job processing/lai_processing/contracts/fixtures/request.reference.json
```
