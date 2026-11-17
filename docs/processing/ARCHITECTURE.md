# Background processing architecture (LAI-LAMBDA-001 to 005)

Status (updated for Wave 3, 2026-11-17):

| Item | State |
|---|---|
| ADR-061 (runtime-independent processing) | Accepted by the owner, 2026-11-16 |
| ADR-062 (one Django job backbone) | Accepted by the owner, 2026-11-17, with decisions B4 to B7, the `LAI_ASSET_ASYNC_VALIDATION` flag (approved, default off; implemented in Wave 3) and prod reserved concurrency 5 |
| Wave 1 (LAI-LAMBDA-001) | Pull request #40 is merge-ready (all required checks green on `8ac16b4`) but **not merged**: the owner must press Merge (the GitHub connector returned 403) |
| Wave 2 (LAI-LAMBDA-002 to 005) | Integrated on `feature/serverless-processing-wave2` (pull request #41, **not merged**), tested locally, reviewed (five read-only reviews, fixes applied 2026-11-17), **provisional** on the unmerged Wave 1 foundation |
| Wave 3 (LAI-LAMBDA-006, 007) | Developer-complete on `feature/serverless-processing-wave3` (2026-11-17): Option A asynchronous validation behind `LAI_ASSET_ASYNC_VALIDATION` (default off everywhere), the completion hook registry and asset hook, the publication gate, the Admin "Background validation" section and action, the reconciliation timer and processing log alarms. Owner review pending, **not merged**, depends on the PR #40 and #41 merges (`WAVE3_INTERFACES.md`) |
| Deployment | **Nothing is deployed and deployment is not authorized** (`LAI_PROCESSING_DEPLOY_ENABLED` is not `true`). `infra/` now synthesizes `LaiProcessingImages-<env>` and `LaiProcessing-<env>`, but no stack has been deployed, no image has been built or pushed, and no live AWS acceptance has run |

Trello: [LAI-LAMBDA-001](https://trello.com/c/N5lWZeq4). Related documents in this folder:

| Document | Read it for |
|---|---|
| `CONTRACTS.md` | Every message field, compatibility rules, fixtures, the CLI, GLB validation metadata |
| `LIFECYCLE.md` | Identities, the four state machines, retries, duplicates, stale results, and (Wave 2) the durable enforcement as built |
| `SECURITY.md` | Threats and the control for each, Wave 1, Wave 2 and downstream |
| `OPERATIONS.md` | Built commands and services, overnight shutdown, DLQs, replay, alarms, cost |
| `WAVE2_INTERFACES.md` | The frozen Wave 2 decisions (settings, stores, transport, Django API, AWS names) |
| `GLB_VALIDATION.md` | Wave 2, 002: the `asset.validate_model` processor and its parity with Django |
| `RUNTIME.md` | Wave 2, 003: adapters, local worker, Lambda handler, image |
| `DJANGO_JOBS.md` | Wave 2, 004: models, outbox, consumer, admin, commands, settings |
| `../infrastructure/processing-infrastructure.md` | Wave 2, 005: CDK stacks, IAM, alarms, workflows, native units |
| `WAVE2_HANDOFF.md` | The Wave 2 plan as briefed (historical; superseded where it differs) |
| `WAVE3_HANDOFF.md` | Wave 3 (006, 007): the plan as briefed, with pointers to what was built |
| `WAVE3_INTERFACES.md` | Wave 3 as frozen and built: the flag, the upload draft path, the completion hook, lock order, the Admin section and the publication gate, plus integration notes |

## 1. Overview

Some asset work is too heavy or too slow for a Django request: validating large GLB models,
extracting metadata, analysing audio and animation, producing optimised derivatives. This
subsystem runs that work off the request path while keeping **Django authoritative** for every
job, every state change and every asset decision.

The design is **runtime independent**. The job logic lives in one standard-library-only Python
package, `lai_processing` (`processing/`), that runs the same way:

- in a unit test, with in-memory fakes (`lai_processing.testing`);
- on a developer machine, through the CLI (`python -m lai_processing`) or the local worker
  (`python -m lai_processing_runtime`, Wave 2);
- inside an AWS Lambda function, behind the thin adapter `lai_processing_runtime.lambda_handler`
  (Wave 2, code only; not deployed).

The transport between Django and workers is two queues: a **work queue** (Django to worker) and
a **completion queue** (worker to Django). The worker never connects to the database and never
publishes an asset. Processing success means "the worker finished and here is what it found";
publication stays a separate, explicit staff action in Django Admin (ADR-045).

## 2. One backbone, two job families (ADR-062, Wave 2)

While Wave 1 was in review, `main` merged ADR-055's `apps.jobs` (a Django `ProcessingJob`, a
schema-1 envelope, zip-packaged Lambda workers and a results consumer). Building the Wave 2 brief
literally would have created a second job table next to it, which ADR-033 forbids. ADR-062
therefore extends `apps.jobs`: **there is no `lai/apps/processing` app.**

```text
                         apps.jobs.ProcessingJob  (one table, one admin, one sweep)
                                       |
            +--------------------------+-----------------------------+
            |                                                        |
  LEGACY KINDS (ADR-055, unchanged)                      CONTRACT KINDS (ADR-061/062, Wave 2)
  studio.generate_chunk, speech.synthesize,             asset.validate_model, reference.checksum
  asset.inspect                                          state, namespace, idempotency_key, ...
            |                                                        |
  services.submit -> schema-1 envelope            processing.submit_processing_job
            |                                     -> job + JobAttempt + JobOutbox (one txn)
            v                                                        |  jobs_dispatch (relay)
  lai-dev-jobs-{ai,media} SQS                                        v
            |                                     lai-<env>-processing-work (+ DLQ)
            v                                                        |
  zip Lambda workers (ADR-055)                    lai-<env>-processing-worker (ECR image by
            |                                     digest; lai_processing + runtime adapters)
            v                                                        |
  results queue                                   lai-<env>-processing-completions (+ DLQ)
            |                                                        |
  jobs_consume_results                            jobs_consume_completions -> apply_completion
  (services.apply_result)                         (CompletionReceipt, JobArtifact, ack after commit)
            |                                                        |
  jobs_sweep: 60-minute timeout, pruning          jobs_reconcile: expires_at, stuck outbox rows
  (contract kinds excluded)                       (sweep never touches contract kinds)
```

| Aspect | Legacy kinds | Contract kinds |
|---|---|---|
| Kinds | `studio.generate_chunk`, `speech.synthesize`, `asset.inspect` | `asset.validate_model`, `reference.checksum` (`models.CONTRACT_KINDS`) |
| Messages | schema-1 envelope (`apps/jobs/core/envelope.py`) | `ProcessingJobRequest`, `CompletionEvent` (`lai_processing.contracts`) |
| Django code | `apps/jobs/services.py` | `apps/jobs/processing.py`, `apps/jobs/processing_transport.py` |
| Durable records | the job row | job row plus `JobAttempt`, `JobOutbox`, `CompletionReceipt`, `JobArtifact` (migration `jobs.0002_processing_contract_kinds`) |
| Queues and storage | ADR-055 queues and artifacts bucket | `lai-<env>-processing-*` queues, `lai-processing-<env>-<account>-<region>` bucket |
| Worker | ADR-055 zip Lambdas | ECR image `lai/processing-<env>` by digest (A4) |
| Expiry | `jobs_sweep` 60-minute rule | `expires_at` plus `jobs_reconcile` |

The two families are kept apart in code: `envelope.KINDS` does not contain contract kinds (so
`services.submit` refuses them), the database check `jobs_contract_fields` requires contract
fields for contract kinds and an empty `state` for legacy kinds, and `services.sweep` and
`services.fail_job` exclude contract kinds. Moving legacy kinds onto the contracts is a later,
separate decision.

## 3. End-to-end flow (contract kinds)

Steps 1 to 6 are built in Wave 2 (and demonstrated locally); steps 7 to 10 for an
`AssetVersion` are built in Wave 3 (`WAVE3_INTERFACES.md`), active only with
`LAI_ASSET_ASYNC_VALIDATION=on` (default off). With the flag on, step 2 creates a GLB version as
`DRAFT` and step 3 runs in the same transaction as the upload.

```text
 Staff (Django Admin)                       Django + PostgreSQL (authoritative)
 --------------------                       -----------------------------------
 1. upload file  ------------------------>  2. today: the synchronous upload stores and validates
                                               the version (VALIDATED or REJECTED)
                                            3. apps.assets.processing.submit_model_validation:
                                               in ONE transaction, job (CREATED -> QUEUED),
                                               JobAttempt 1 and a JobOutbox row with the
                                               encoded ProcessingJobRequest
                                            4. jobs_dispatch relays committed outbox rows
                                               (select_for_update(skip_locked=True))
                                               |
                                               v
                                   +----------------------+
                                   |  work queue + DLQ    |  (holds work while anything
                                   |                      |   downstream is stopped)
                                   +----------+-----------+
                                              |
                                              v
                                   +----------------------+   reads input (read-only)
                                   |  Worker              |   verifies sha256 + size first
                                   |  Lambda or local     |   runs asset.glb_validator
                                   |  no RDS, no publish  |   writes artifacts (create-only)
                                   +----------+-----------+
                                              |  CompletionEvent (result inline or by ref)
                                              v
                                   +----------------------+
                                   |  completion queue    |  (holds completions while
                                   |  + DLQ               |   EC2/RDS are stopped)
                                   +----------+-----------+
                                              |
                                              v
                                            5. jobs_consume_completions -> apply_completion:
                                               decode, verify, decide_completion() plus Django's
                                               own checks, persist under the job row lock,
                                               THEN ack the message
                                            6. job VALIDATED; result, verdict, findings and
                                               metadata on JobAttempt / job.result; JobArtifact rows
                                            7. (Wave 3) completion hook, same transaction: a DRAFT
                                               version becomes VALIDATED (pass) or REJECTED; the
                                               job moves to READY_FOR_REVIEW
 8. (Wave 3) staff review findings <------  ("Background validation" section in Django Admin)
 9. staff explicitly publishes ---------->  10. AssetVersion PUBLISHED (existing publish_version,
                                                which re-validates; with the flag on it also needs
                                                a passing background result, the gate)
```

Steps 6 and 10 are separate on purpose: no completion message, however valid, can publish. The
Wave 3 hook (`apps/assets/completion.py`) writes only to a `DRAFT` version and never publishes;
with the flag off, uploads stay synchronous and no job is created at upload.

## 4. Components and ownership

| Component | Owns | Never does | Where (Wave 2 status) |
|---|---|---|---|
| Django + PostgreSQL | Job rows, attempts, transitions, the outbox, receipts, artifact records, asset versions, review and publication | Run heavy processing inside a request (except the `inline` test backend) | `lai/apps/jobs` extended (004, built); `lai/apps/assets/processing.py` (built) |
| Outbox relay | Sending committed outbox rows to the work queue | Send before the job row commits | `manage.py jobs_dispatch`, unit `lai-jobs-dispatch.service` (built, not deployed) |
| Work queue + DLQ | Holding work messages durably, at-least-once delivery | Carry file bytes, URLs or credentials | `LaiProcessing-<env>` (`infra/lib/processingStack.ts`, synthesized, not deployed) |
| Worker | Executing one attempt: verify input, run the processor, write artifacts, send one completion | Connect to RDS, publish, call Bedrock, fetch URLs from messages | `lai_processing` core plus `lai_processing_runtime` (`worker.process_work_message`, `LocalWorker`, `lambda_handler.handler`) (003, built); image `processing/Dockerfile.lambda` (not built) |
| Processors | `reference.checksum` (Wave 1), `asset.glb_validator` for `asset.validate_model` (002) | Network access, non-stdlib imports | `processing/lai_processing/processors/` (built) |
| Completion queue + DLQ | Holding completions durably until Django consumes them | Accept sends from anyone but the worker role | `LaiProcessing-<env>` (synthesized, not deployed) |
| Completion consumer | Verifying and applying completions transactionally, then acknowledging | Acknowledge before commit | `manage.py jobs_consume_completions`, unit `lai-jobs-completions.service` (built, not deployed) |
| Reconciliation | Expiring overdue open jobs, reporting stuck outbox rows | Retry automatically | `manage.py jobs_reconcile` with a PostgreSQL advisory lock; `lai-jobs-reconcile.timer` every 10 minutes on native dev and one run in `power-native.sh verify` (Wave 3, built, not deployed); no prod schedule |
| S3 | Asset originals (read-only for workers), quarantine inputs and immutable artifacts | Serve artifacts publicly | Existing asset bucket plus a new private `lai-processing-<env>-<account>-<region>` bucket (A8; synthesized, not deployed) |
| Image publication | Building the worker image off-host and pushing it by digest | Deploy on merge | `LaiProcessingImages-<env>`, `.github/workflows/deploy-processing.yml` (dispatch-only, gated) and `ci.yml` job `processing-image` |

## 5. Package layout

Wave 1 created `lai_processing`; Wave 2 added `processors/gltf/` and the separate
`lai_processing_runtime` package. Both ship in the one `lai-processing` distribution
(`processing/pyproject.toml`); boto3 is the optional extra `aws`.

```text
processing/
  pyproject.toml                    # lai-processing 0.1.0, requires-python >=3.12; extra [aws] = boto3
  Dockerfile.lambda                 # Wave 2 (003): worker image, linux/arm64, Lambda python:3.12 base
  runtime-requirements.txt          # Wave 2 (003): boto3 and its pins for the image
  lai_processing/                   # stdlib only (enforced by tests)
    __init__.py, version.py         # __version__ = "0.1.0"; __main__.py runs the CLI
    core/
      errors.py                     # ErrorCode, RetryClass, ProcessingError, safe messages
      limits.py                     # ResourceLimits, DEFAULT_LIMITS, PLATFORM_CEILINGS
      canonical.py                  # canonical_json, sha256_*, strict UTC timestamps
      idempotency.py                # idempotency_key, request_idempotency_key, verify_*
      lifecycle.py                  # JobState, TRANSITIONS, check_transition, decide_completion
      retry.py                      # RetryPolicy, DEFAULT_RETRY_POLICY
      processor.py                  # Processor, ProcessorOutput, ProcessingContext, CancellationToken
      registry.py                   # ProcessorRegistry, default_registry: Reference + GlbValidator
      workspace.py                  # Workspace: private temp dir with a byte budget
      execution.py                  # ExecutionEngine: execute, decode_and_execute, complete
    contracts/                      # request, result, artifact, event, profiles, job types, codec,
                                    # fixtures/ (incl. request.asset_validate_model.json), schemas/
    ports/                          # ObjectStorage, MessageQueue, Clock, Telemetry (SAFE_FIELDS)
    processors/
      reference.py                  # ReferenceProcessor (reference.checksum, reference-default v1)
      gltf/                         # Wave 2 (002): asset.glb_validator 1.0.0, profile glb-default v1
        container.py, jsonparse.py, # GLB header/chunks; strict bounded JSON
        document.py, images.py,     # glTF document checks; PNG/JPEG/WebP headers
        metadata.py, report.py,     # deterministic metadata; findings and report artifact
        processor.py                # GlbValidatorProcessor
    testing/fakes.py                # MemoryObjectStorage, MemoryQueue, ManualClock, RecordingTelemetry
    cli/main.py                     # python -m lai_processing
  lai_processing_runtime/           # Wave 2 (003): never imports Django; boto3 imported lazily
    __init__.py                     # exports FilesystemObjectStorage, LocalDirectoryQueue,
                                    # S3ObjectStorage, SqsMessageQueue, QueueError, JsonLogTelemetry
    config.py                       # RuntimeConfig.from_env, LocalRuntimeConfig
    filesystem.py, s3.py            # ObjectStorage adapters
    local_queue.py, sqs.py          # MessageQueue adapters
    telemetry.py                    # JsonLogTelemetry (closed field vocabulary)
    worker.py                       # process_work_message: the per-record core of both runtimes
    local_worker.py, cli.py         # LocalWorker; python -m lai_processing_runtime
    lambda_handler.py               # handler(event, context)
tests/processing/                   # unit, contract, adversarial, GLB, runtime and packaging tests
```

Rules: nothing under `lai_processing` imports Django, boto3, AWS Lambda libraries, an HTTP client
or a database driver, and it never imports `lai_processing_runtime`; `lai_processing_runtime`
never imports Django or anything under `lai/` (`tests/processing/test_runtime_packaging.py`).

Integration fix (Wave 2): `lai_processing_runtime` originally did not export its adapters at
package level, so Django's `local` transport factory raised `ImportError` against the real
package (004 had tested against a stand-in). The package `__init__` now exports them.

## 6. Local versus AWS execution (updated for Wave 2)

| Concern | Unit tests / `inline` backend | Local async worker (`local` backend) | AWS (`sqs` backend; code built, deploy gated) |
|---|---|---|---|
| Storage | `MemoryObjectStorage`; `inline` reads `assets` through Django's asset storage | `FilesystemObjectStorage`: `assets` at `LAI_ASSET_LOCAL_ROOT`, processing stores under `LAI_PROCESSING_LOCAL_ROOT` | `S3ObjectStorage`: `assets` = `LAI_ASSET_BUCKET`, `quarantine` and `artifacts` = `LAI_PROCESSING_BUCKET` |
| Queue | `MemoryQueue` (one pair per process) | `LocalDirectoryQueue` under `<root>/queues/{work,completions}` | `SqsMessageQueue` on `lai-<env>-processing-{work,completions}` |
| Worker | `processing.run_inline()` after commit, in the Django process (tests and default dev only) | `python -m lai_processing_runtime worker --root ... --assets-root ...` | `lai_processing_runtime.lambda_handler.handler`, ECR image by digest, arm64 |
| Django side | same process | `manage.py jobs_dispatch` and `manage.py jobs_consume_completions` | same commands as systemd units `lai-jobs-dispatch` and `lai-jobs-completions` |
| Clock | `ManualClock` in tests | `SystemClock` | `SystemClock` |
| Telemetry | `RecordingTelemetry` / `LoggingTelemetry` | `JsonLogTelemetry` | `JsonLogTelemetry` to CloudWatch Logs |
| Database | Django's only | Django's only; the worker has none | Django's only; the worker has none |

The same contracts, execution engine and processors run in every column; only the adapters
change. `LAI_ASSET_LOCAL_ROOT` became environment-overridable at integration (default unchanged,
`lai/.asset-storage`) so a local worker and Django can share an explicit assets directory.

## 7. Why the worker does not connect to RDS

| Reason | Detail (evidence) |
|---|---|
| Database is private and isolated | RDS sits in `PRIVATE_ISOLATED` subnets with no NAT gateway (`infra/lib/djangoEc2Stack.ts`, `natGateways: 0`). A Lambda reaching it would have to run in the VPC and then needs VPC endpoints (or a NAT) for S3 and SQS. |
| Connection budget | RDS is `t4g.micro` by default (`djangoEc2Stack.ts`). Concurrent Lambda invocations each opening connections compete with gunicorn. RDS Proxy would be another paid component. |
| Credentials | A worker with database credentials can change any row. Without them, a compromised worker can at most send a completion that Django then verifies. |
| Stop schedule | Dev stops EC2 and RDS overnight (ADR-055 `lai-dev-power`, `OPERATIONS.md`). A worker that needs the database would fail all night; a worker that only needs S3 and SQS keeps working and its completions wait in the queue. |
| Single authority | Django already owns every rule about assets (ADR-035, ADR-045). One writer means one place for transitions, locking and audit. |

Consequence: the worker cannot report "started". A completion can arrive while Django still
shows the job `QUEUED`, and `decide_completion` accepts that (`LIFECYCLE.md`).

## 8. Durable hand-offs: outbox for dispatch, commit-then-ack for completions

**Dispatch (transactional outbox).** S3/SQS and PostgreSQL cannot commit together. Sending the
work message inside the request risks a message for a job row that rolled back, or a committed
row whose message was never sent. Instead, the job transition to `QUEUED` and an outbox row
holding the encoded request commit in **one** database transaction. A relay then sends unsent
outbox rows and marks them sent. A crash between send and mark resends the same message: a
duplicate, which the worker and the consumer already tolerate (same `attempt_id`, same artifact
keys, `DUPLICATE` decision). Built in Wave 2: `submit_processing_job`, `relay_outbox`,
`jobs_dispatch` (`LIFECYCLE.md` section 9).

**Completion (commit, then acknowledge).** The consumer receives an event, verifies it, applies
the decision in one transaction, and deletes (acks) the message **only after the commit
succeeds**. A crash before the ack redelivers the event; the second application is recognised
as a duplicate through the `CompletionReceipt` ledger (`event_id` unique) and the applied-attempt
ledger (`JobAttempt.applied_at`) and acknowledged without change. Built in Wave 2:
`apply_completion`, `jobs_consume_completions`.

Neither side claims exactly-once delivery. The system is at-least-once with idempotent
application (`LIFECYCLE.md`, section 6).

## 9. Wave plan

| Wave | Tasks | Content | State |
|---|---|---|---|
| 1 | LAI-LAMBDA-001 | Contracts v1, errors, limits, canonical encoding, ports, fakes, lifecycle, retry policy, execution engine, explicit registry, reference processor, CLI, fixtures, JSON Schemas, these docs, ADR-061 | PR #40 merge-ready, not merged |
| 2 | 002, 003, 004, 005 | GLB validator processor; runtime adapters, local worker and Lambda handler; `apps.jobs` contract kinds (models, outbox, consumer, admin, commands); CDK stacks `LaiProcessingImages-<env>` and `LaiProcessing-<env>`, workflows, native units | Integrated 2026-11-17, provisional on Wave 1; not deployed |
| 3 | [006](https://trello.com/c/SYUqyvWM), [007](https://trello.com/c/WQAi4PAi) | AssetVersion integration (Option A, synchronous upload then submit), `DRAFT` hook behind a flag, results onto the version, `READY_FOR_REVIEW`, publication gate, reconcile timer, replay runbooks; deployment verification in dev moves to LAI-LAMBDA-011 | Developer-complete on `feature/serverless-processing-wave3`, not merged (`WAVE3_INTERFACES.md`) |
| 4 | [008](https://trello.com/c/r7BVm0fV), [009](https://trello.com/c/ga6LzukZ), [010](https://trello.com/c/l1ahd2je) | 008: audio processing with FFmpeg in a reproducible container. 009: animation analysis. 010: ECS Fargate fallback for runs over 15 minutes | After Wave 3 |
| 5 | [011](https://trello.com/c/gUbA86BZ), [012](https://trello.com/c/CCHrKhmj) | 012: immutable ECR image digests and rollback (Wave 2 already deploys by digest); the small EC2 instance is **not** the default heavy-processing fallback. 011: see its card | After Wave 4 |

Scopes come from the Trello cards as relayed by the coordinator on 2026-11-16; where a card's
scope was not relayed, this page does not invent it. Note: `contracts/job_types.py` assigns the
reserved `asset.optimize` job type to LAI-LAMBDA-010, but card 010 is the ECS Fargate fallback
runtime. The owner task for `asset.optimize` must be corrected before Wave 4 (see
`WAVE2_HANDOFF.md`, "Inconsistencies").

**Single dispatch path.** The Django outbox is the only authoritative dispatch path (card 006:
"one authoritative dispatch path"). S3 object-created events are not used to start jobs: an
upload would then start work with no committed job row, and an object-created trigger on a bucket
the worker writes to risks output-trigger loops. `LaiProcessing-<env>` configures no S3 event
notification. If S3 events are ever added (for example for auditing), they must be filtered to
input prefixes and must never dispatch work.

## 10. Implemented versus not (Waves 2 and 3)

| Area | State |
|---|---|
| Contracts v1, errors, limits, canonical JSON, ports, fakes, lifecycle, retry, engine, registry, reference processor, CLI, fixtures, schemas, idempotency helper | Implemented in Wave 1 and unit-tested (`tests/processing/`) |
| GLB validator `asset.glb_validator` (`asset.validate_model`, `glb-default` v1) | **Wave 2, implemented**: registered in `default_registry()`, hostile and parity tests (`GLB_VALIDATION.md`) |
| Runtime adapters (filesystem, local queue, S3, SQS), JSON telemetry, local worker, Lambda handler | **Wave 2, implemented** and tested without network (`RUNTIME.md`) |
| Worker image (`processing/Dockerfile.lambda`) | Written; **not built or pushed** (the base image pull needs network); `ci.yml` `processing-image` builds and scans it in CI |
| Django contract kinds: fields, `JobAttempt`, `JobOutbox`, `CompletionReceipt`, `JobArtifact`, status mapping | **Wave 2, implemented** (`DJANGO_JOBS.md`, migration `jobs.0002_processing_contract_kinds`) |
| `submit_processing_job`, `relay_outbox`, `apply_completion`, `cancel_job`, `requeue_job`, `reconcile`, `run_inline` | **Wave 2, implemented** |
| `jobs_dispatch`, `jobs_consume_completions`, `jobs_reconcile` | **Wave 2, implemented**; systemd units (dev) and `docker-compose.yml` services `jobs-dispatch` and `jobs-completions` (prod) for the first two; Wave 3 adds `lai-jobs-reconcile.timer` (dev only) and the reconcile advisory lock |
| Django Admin for contract jobs (read-only fields, findings, attempts, artifacts, receipts; Cancel and Requeue actions) | **Wave 2, implemented** |
| `apps.assets.processing.submit_model_validation` | **Wave 2, implemented**; submits only. Wave 3 calls it from `upload_version` (flag on, GLB) and from the Admin action "Validate in background" |
| CDK `LaiProcessingImages-<env>`, `LaiProcessing-<env>`, IAM, queue policies, alarms, SSM settings, workflows | **Wave 2, synthesized and tested; not deployed** (`processing-infrastructure.md`) |
| Local end-to-end demonstration | **Ran successfully** at integration (`scripts/processing/local-demo.sh`, which since Wave 3 runs the flag-on draft, hook, gate and publish path; `lai/apps/jobs/tests/test_processing_wave2_end_to_end.py` and `test_processing_wave3_end_to_end.py`) |
| Job `VALIDATED -> READY_FOR_REVIEW` transition | **Wave 3, implemented**: set when a completion hook returns `review_ready` |
| AssetVersion integration: `DRAFT` flow, results onto `validation_report` and `metadata["model_validation"]`, review section on the version, publication gate | **Wave 3, implemented** behind `LAI_ASSET_ASYNC_VALIDATION` (default off) |
| Presigned uploads (Option B) | Not built; a future enhancement that needs an owner decision |
| DLQ runbook, processing log metric filters and alarms (dev) | **Wave 3, implemented** (`OPERATIONS.md` sections 8 and 9.1); no replay command by design |
| Live AWS acceptance | Not done; needs owner deployment authorization (A9, ADR-019 G7) and LAI-LAMBDA-011 |
| AI Question Studio | Unchanged. It keeps its PostgreSQL-backed `GenerationBatch` queue (`LAI_STUDIO_RUN_MODE`); LAI-AQS-027 stays open. Moving it to SQS needs a separate approval |
| Legacy `apps.jobs` kinds (ADR-055) | Unchanged in behaviour, envelopes, queues, worker zip and consumer |
| Child photos | Out of scope. They must never use this pipeline without a separate approved decision (ADR-042) |
