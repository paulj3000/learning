# Background processing architecture (LAI-LAMBDA-001)

Status: Wave 1 foundation. Proposed design, recorded in ADR-061 (`docs/DECISIONS.md`,
owner acceptance pending). **Nothing in this subsystem is deployed.** No SQS queue, Lambda
function, EventBridge rule or processing IAM role exists in `infra/` or in AWS today.

Trello: [LAI-LAMBDA-001](https://trello.com/c/N5lWZeq4). Related documents in this folder:

| Document | Read it for |
|---|---|
| `CONTRACTS.md` | Every message field, compatibility rules, fixtures, the CLI |
| `LIFECYCLE.md` | Identities, the four state machines, retries, duplicates, stale results |
| `SECURITY.md` | Threats and the control for each, Wave 1 versus downstream |
| `OPERATIONS.md` | Overnight shutdown, queues, DLQs, replay, alarms, cost |
| `WAVE2_HANDOFF.md` | The four parallel Wave 2 workstreams and their frozen interfaces |

## 1. Overview

Some asset work is too heavy or too slow for a Django request: validating large GLB models,
extracting metadata, analysing audio and animation, producing optimised derivatives. This
subsystem runs that work off the request path while keeping **Django authoritative** for every
job, every state change and every asset decision.

The design is **runtime independent**. The job logic lives in one standard-library-only Python
package, `lai_processing` (`processing/`), that runs the same way:

- in a unit test, with in-memory fakes (`lai_processing.testing`);
- on a developer machine, through the CLI (`python -m lai_processing`);
- later, inside an AWS Lambda function, behind a thin adapter (Wave 2, LAI-LAMBDA-003).

The transport between Django and workers is two queues: a **work queue** (Django to worker) and
a **completion queue** (worker to Django). The worker never connects to the database and never
publishes an asset. Processing success means "the worker finished and here is what it found";
publication stays a separate, explicit staff action in Django Admin (ADR-045).

## 2. End-to-end flow (target, not built)

```text
 Staff (Django Admin)                       Django + PostgreSQL (authoritative)
 --------------------                       -----------------------------------
 1. upload file  ------------------------>  2. create ProcessingJob row (CREATED)
                                            3. store original privately in S3 (UPLOADING)
                                            4. in ONE transaction: job -> QUEUED and an
                                               outbox row with the encoded job_request
                                            5. outbox dispatcher sends the work message
                                               |
                                               v
                                   +----------------------+
                                   |  SQS work queue      |  (holds work while anything
                                   |  + DLQ               |   downstream is stopped)
                                   +----------+-----------+
                                              |
                                              v
                                   +----------------------+   reads input (S3, read-only)
                                   |  Worker (Lambda)     |   verifies sha256 + size first
                                   |  lai_processing core |   runs the processor
                                   |  no RDS, no publish  |   writes artifacts (create-only)
                                   +----------+-----------+
                                              |  job_completed event (result inline or by ref)
                                              v
                                   +----------------------+
                                   |  SQS completion queue|  (holds completions while
                                   |  + DLQ               |   EC2/RDS are stopped)
                                   +----------+-----------+
                                              |
                                              v
                                            6. completion consumer (Django):
                                               decode, verify job/attempt/key/namespace/
                                               checksums, decide_completion(), persist
                                               in one transaction, THEN ack the message
                                            7. job VALIDATED -> READY_FOR_REVIEW
 8. staff reviews findings and metadata <-
 9. staff explicitly publishes ---------->  10. AssetVersion PUBLISHED (existing service)
```

Steps 6 and 10 are separate on purpose: no completion message, however valid, can publish.

## 3. Components and ownership

| Component | Owns | Never does | Where (status) |
|---|---|---|---|
| Django + PostgreSQL | Job rows, attempts, state transitions, the outbox, artifact records, asset versions, review and publication | Run heavy processing inside a request | `lai/apps/processing` (Wave 2, LAI-LAMBDA-004, not built) |
| Outbox dispatcher | Sending committed outbox rows to the work queue | Send before the job row commits | Django management command (004, not built) |
| Work queue + DLQ | Holding work messages durably, at-least-once delivery | Carry file bytes, URLs or credentials | CDK stack `LaiProcessing-<env>` (005, not built) |
| Worker | Executing one attempt: verify input, run processor, write artifacts, emit one completion event | Connect to RDS, publish, call Bedrock, fetch URLs from messages | `lai_processing` core (Wave 1) plus a Lambda handler (003, not built) |
| Completion queue + DLQ | Holding completion events durably until Django consumes them | Be written by anyone but the worker role | `LaiProcessing-<env>` (005, not built) |
| Completion consumer | Verifying and applying completions transactionally, then acknowledging | Acknowledge before commit | Django management command / systemd service (004, not built) |
| S3 | Inputs (assets, quarantine) and immutable artifacts | Serve artifacts publicly | Existing asset bucket or a new processing bucket (005 decision) |

## 4. Package layout

Everything below exists on `feature/serverless-processing` (Wave 1, LAI-LAMBDA-001).

```text
processing/
  pyproject.toml                    # lai-processing 0.1.0, requires-python >=3.12, no dependencies
  lai_processing/
    __init__.py, version.py         # __version__ = "0.1.0"; __main__.py runs the CLI
    core/
      errors.py                     # ErrorCode, RetryClass, ProcessingError, safe messages
      limits.py                     # ResourceLimits, DEFAULT_LIMITS, PLATFORM_CEILINGS
      canonical.py                  # canonical_json, sha256_*, strict UTC timestamps
      idempotency.py                # idempotency_key, request_idempotency_key, verify_*
      lifecycle.py                  # JobState, TRANSITIONS, check_transition, decide_completion
      retry.py                      # RetryPolicy, DEFAULT_RETRY_POLICY
      processor.py                  # Processor, ProcessorOutput, ProcessingContext, CancellationToken
      registry.py                   # ProcessorRegistry, default_registry (explicit list)
      workspace.py                  # Workspace: private temp dir with a byte budget
      execution.py                  # ExecutionEngine: execute, decode_and_execute, complete
    contracts/
      common.py, identifiers.py,    # envelope building blocks, key safety rules
      jobs.py, results.py,          # ProcessingJobRequest, ProcessingJobResult
      artifacts.py, events.py,      # ArtifactReference, CompletionEvent
      profiles.py, job_types.py,    # ProcessingProfile, closed job-type catalog
      codec.py, _fields.py          # strict decode/encode
      fixtures/                     # valid examples, invalid/ with manifest.json
      schemas/                      # JSON Schema 2020-12 for request, result, event (v1)
    ports/
      storage.py, queue.py,         # ObjectStorage, MessageQueue protocols
      clock.py, telemetry.py        # Clock, Telemetry with SAFE_FIELDS
    processors/reference.py         # ReferenceProcessor (reference.checksum, profile reference-default v1)
    testing/fakes.py                # MemoryObjectStorage, MemoryQueue, ManualClock,
                                    #          RecordingTelemetry
    cli/main.py                     # python -m lai_processing
tests/processing/                   # unit, contract, adversarial and integration tests
```

Rule: nothing under `lai_processing` imports Django, boto3, AWS Lambda libraries, an HTTP client
or a database driver (`lai_processing/__init__.py` docstring). Adapters for those live outside the
core package (Wave 2).

## 5. Local versus AWS execution

| Concern | Unit tests / local CLI (Wave 1) | Local async worker (Wave 2, 003) | AWS (Wave 2 code, deploy gated) |
|---|---|---|---|
| Storage | `MemoryObjectStorage` | Filesystem adapter | S3 adapter (boto3), outside the core |
| Queue | `MemoryQueue` (visibility, redelivery, DLQ list) | Local queue adapter | SQS adapter |
| Clock | `ManualClock` | `SystemClock` | `SystemClock` |
| Telemetry | `RecordingTelemetry` | `LoggingTelemetry` | `LoggingTelemetry` to CloudWatch Logs |
| Entry point | `python -m lai_processing run FILE --input-file PATH --output-dir DIR` | worker loop that does not block Django HTTP | Lambda handler (003), packaged as a container image built off-host (GitHub Actions) and stored in ECR (005, 012) |
| Database | none | none | none (the worker never has one) |

The same contracts, the same execution engine and the same processors run in every column. Only
the adapters change.

## 6. Why the worker does not connect to RDS

| Reason | Detail (evidence) |
|---|---|
| Database is private and isolated | RDS sits in `PRIVATE_ISOLATED` subnets with no NAT gateway (`infra/lib/djangoEc2Stack.ts`, `natGateways: 0`). A Lambda reaching it would have to run in the VPC and then needs VPC endpoints (or a NAT) for S3 and SQS. |
| Connection budget | RDS is `t4g.micro` by default (`djangoEc2Stack.ts`). Concurrent Lambda invocations each opening connections compete with gunicorn. RDS Proxy would be another paid component. |
| Credentials | A worker with database credentials can change any row. Without them, a compromised worker can at most send a completion that Django then verifies. |
| Stop schedule | The dev environment may stop EC2 and RDS overnight (`OPERATIONS.md`). A worker that needs the database would fail all night; a worker that only needs S3 and SQS keeps working and its completions wait in the queue. |
| Single authority | Django already owns every rule about assets (ADR-035, ADR-045). One writer means one place for transitions, locking and audit. |

Consequence: the worker cannot report "started". A completion can arrive while Django still
shows the job `QUEUED`, and `decide_completion` accepts that (`LIFECYCLE.md`).

## 7. Durable hand-offs: outbox for dispatch, commit-then-ack for completions

**Dispatch (transactional outbox).** S3/SQS and PostgreSQL cannot commit together. Sending the
work message inside the request risks a message for a job row that rolled back, or a committed
row whose message was never sent. Instead, the job transition to `QUEUED` and an outbox row
holding the encoded request commit in **one** database transaction. A dispatcher then sends
unsent outbox rows and marks them sent. A crash between send and mark resends the same message:
a duplicate, which the worker and the consumer already tolerate (same `attempt_id`, same
artifact keys, `DUPLICATE` decision).

**Completion (commit, then acknowledge).** The consumer receives an event, verifies it, applies
the decision in one transaction, and deletes (acks) the message **only after the commit
succeeds**. A crash before the ack redelivers the event; the second application is recognised
as a duplicate through the applied-attempt ledger and acknowledged without change.

Neither side claims exactly-once delivery. The system is at-least-once with idempotent
application (`LIFECYCLE.md`, section 6).

## 8. Wave plan

| Wave | Tasks | Content | Parallelism |
|---|---|---|---|
| 1 | LAI-LAMBDA-001 | Contracts v1, errors, limits, canonical encoding, ports, fakes, lifecycle, retry policy, execution engine, explicit registry, reference processor, CLI, fixtures, JSON Schemas, these docs, ADR-061 (proposed) | One task, several agents on disjoint files |
| 2 | 002, 003, 004, 005 | GLB validator processor; adapters (filesystem, S3, SQS) and Lambda handler; Django `processing` app (models, outbox, consumer, Admin); CDK stack `LaiProcessing-<env>` | All four in parallel against the frozen Wave 1 interfaces (`WAVE2_HANDOFF.md`) |
| 3 | [006](https://trello.com/c/SYUqyvWM), [007](https://trello.com/c/WQAi4PAi) | 006: Django presigned uploads plus durable enqueue after upload, ack completions only after commit, poison jobs, replay, stopped-host backlog. 007: see its card | After Wave 2 |
| 4 | [008](https://trello.com/c/r7BVm0fV), [009](https://trello.com/c/ga6LzukZ), [010](https://trello.com/c/l1ahd2je) | 008: audio processing with FFmpeg in a reproducible container. 009: animation analysis. 010: ECS Fargate fallback for runs over 15 minutes | Parallel |
| 5 | [011](https://trello.com/c/gUbA86BZ), [012](https://trello.com/c/CCHrKhmj) | 012: immutable ECR image digests and rollback; the small EC2 instance is **not** the default heavy-processing fallback. 011: see its card | After Wave 4 |

Scopes come from the Trello cards as relayed by the coordinator on 2026-11-16; where a card's
scope was not relayed, this page does not invent it. Note: `contracts/job_types.py` assigns the
reserved `asset.optimize` job type to LAI-LAMBDA-010, but card 010 is the ECS Fargate fallback
runtime. The owner task for `asset.optimize` must be corrected before Wave 4 (see
`WAVE2_HANDOFF.md`, "Inconsistencies").

**Single dispatch path.** The Django outbox is the only authoritative dispatch path (card 006:
"one authoritative dispatch path"). S3 object-created events are not used to start jobs: an
upload would then start work with no committed job row, and an object-created trigger on a bucket
the worker writes to risks output-trigger loops (card 005 asks for safe filters for exactly that
reason). If S3 events are ever added (for example for auditing), they must be filtered to input
prefixes and must never dispatch work.

## 9. Implemented versus not

| Area | State at the time of writing |
|---|---|
| Contracts v1 (request, result, artifact, event, profile, limits) | Implemented in `contracts/`, strict decoding in `codec.py` |
| Error taxonomy, limits, canonical JSON | Implemented in `core/` |
| Ports and in-memory fakes | Implemented in `ports/`, `testing/fakes.py` |
| Lifecycle, retry policy, execution engine, registry, reference processor, CLI, fixtures, schemas | Implemented in Wave 1 and unit-tested (`tests/processing/`) |
| Idempotency key helper | Implemented: `core/idempotency.py`; the execution engine verifies every request's key before reading input |
| Django `processing` app, outbox, consumer | Not built (004) |
| S3/SQS adapters, Lambda handler | Not built (003) |
| SQS queues, DLQs, Lambda, IAM, alarms | Not defined in `infra/`, not deployed (005, approvals needed) |
| AssetVersion `DRAFT` asynchronous validation | Not built; `DRAFT` is "reserved for a future asynchronous validation step; no code path creates it today" (`docs/ASSET_LIBRARY.md` section 3) |
| AI Question Studio | Unchanged. It keeps its PostgreSQL-backed `GenerationBatch` queue (`LAI_STUDIO_RUN_MODE`); LAI-AQS-027 stays open. It may adopt these contracts later, but moving it to SQS needs a separate approval |
| Child photos | Out of scope. They must never use this pipeline without a separate approved decision (ADR-042) |
