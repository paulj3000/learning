# Wave 2 handoff (LAI-LAMBDA-002 to 005)

Audience: the four Wave 2 implementation agents and their reviewer. Read `ARCHITECTURE.md`,
`CONTRACTS.md` and `LIFECYCLE.md` first. Wave 2 starts from the merged Wave 1 commit on
`feature/serverless-processing` (LAI-LAMBDA-001). Symbol names below are those of the merged
code; if the code and this page ever disagree, the code wins and the principal corrects the page.

## 1. Frozen interfaces (Wave 2 consumes, never changes)

| Interface | Module and symbols |
|---|---|
| Contract schema v1 | `lai_processing.contracts`: `ProcessingJobRequest`, `ProcessingJobResult`, `CompletionEvent`, `ArtifactReference`, `ObjectRef`, `InputObject`, `SubjectRef`, `AssetContext`, `ProfileRef`, `ProcessorIdentity`, `Finding`, `ProcessingWarning`, `JobError`, `InputIdentity`, `ResultStatus`, `Verdict`, `Severity`, `MessageKind`, `SCHEMA_VERSION`, `SUPPORTED_SCHEMA_VERSIONS`, `StoreName`, `artifact_key`, `artifact_prefix`, `check_object_key`, `build_completion_event`, `result_digest`, `RESULT_ARTIFACT_TYPE`, `RESULT_LOGICAL_ID`, `encode`, `decode`, `decode_request`, `decode_result`, `decode_event`, `load_json`, `DEFAULT_MAX_MESSAGE_BYTES` |
| Job types and profiles | `lai_processing.contracts`: `JOB_TYPES`, `JobTypeSpec`, `job_type_spec`, `ProcessingProfile`, `OptionSpec` |
| Errors and limits | `lai_processing.core.errors`: `ErrorCode`, `RetryClass`, `ProcessingError`, `ERROR_CLASSIFICATION`, `SAFE_MESSAGES`, `error_from_exception`, `safe_details`. `lai_processing.core.limits`: `ResourceLimits`, `DEFAULT_LIMITS`, `PLATFORM_CEILINGS`, `effective_limits` |
| Canonical encoding | `lai_processing.core.canonical`: `canonical_json`, `sha256_hex`, `sha256_stream`, `format_timestamp`, `parse_timestamp` |
| Ports | `lai_processing.ports`: `ObjectStorage`, `ObjectInfo`, `StorageError`, `ObjectMissing`, `ObjectExists`, `StoragePermissionDenied`, `StorageUnavailable`, `MessageQueue`, `Delivery`, `SendReceipt`, `QueueFull`, `Clock`, `SystemClock`, `Telemetry`, `LoggingTelemetry`, `NullTelemetry`, `SAFE_FIELDS`, `check_fields` |
| Test fakes | `lai_processing.testing`: `MemoryObjectStorage`, `MemoryQueue`, `ManualClock`, `RecordingTelemetry`, `StoredObject` |
| Lifecycle API | `lai_processing.core.lifecycle`: `JobState`, `TRANSITIONS`, `TERMINAL_STATES`, `AUTOMATION_STOP_STATES`, `MANUAL_TRANSITIONS`, `InvalidTransition`, `check_transition(current, target, *, manual=False)`, `JobSnapshot`, `CompletionAction` (`APPLY`, `RETRY`, `DUPLICATE`, `STALE`, `REJECT`), `CompletionDecision`, `decide_completion(job, event, result=None)`, `next_attempt_number` |
| Retry API | `lai_processing.core.retry`: `RetryPolicy` (`should_retry`, `delay_seconds`, `backoff_ceiling`), `DEFAULT_RETRY_POLICY`, `SQS_MAX_DELAY_SECONDS`, `MAX_ATTEMPTS_CEILING` |
| Idempotency API | `lai_processing.core.idempotency`: `IDEMPOTENCY_KEY_VERSION`, `idempotency_key`, `idempotency_material`, `request_idempotency_key`, `verify_idempotency_key` |
| Processor and registry API | `lai_processing.core.processor`: `Processor` (ClassVars `processor_id`, `version`, `job_types`; `profiles()`, `validate()`, `process()`, `cleanup()`), `ProcessorOutput`, `ProcessingContext` (`check()`, `write_artifact(...)`, `input_path`), `CancellationToken`, `RESERVED_LOGICAL_IDS`. `lai_processing.core.registry`: `ProcessorRegistry` (`register`, `freeze`, `resolve`, `processors`, `profiles`, `describe`), `default_registry()` |
| Execution API | `lai_processing.core.execution`: `ExecutionEngine(registry, storage, telemetry, clock, ceilings, namespace, workspace_root, id_factory, verify_idempotency_keys=True)` with `execute(request, *, cancellation=None)`, `decode_and_execute(body)`, `complete(result, *, max_message_bytes)`. `lai_processing.core.workspace`: `Workspace` |

### Change control

- Any change to a frozen interface goes through the principal, never directly from a Wave 2
  branch.
- A contract change that makes a valid message invalid, or changes meaning, bumps the schema
  version and follows the consumer-first rule (`CONTRACTS.md` section 9).
- A Wave 2 agent that needs a new error code, telemetry field, job type, or port method asks the
  principal; the principal lands it on the integration branch and every agent rebases.

## 2. Parallel execution plan

| Task | Can start now | Blocks on | Merge order |
|---|---|---|---|
| 002 GLB validator | Yes | Nothing (frozen interfaces only) | Any |
| 003 Adapters and Lambda handler | Yes | Seam agreement with 004 (section 7) | Before 004's AWS wiring; 004 tests use fakes |
| 004 Django processing app | Yes | Seam agreement with 003; idempotency helper in core | After the core helper |
| 005 Infrastructure | Code and tests yes; **deploy no** | Owner approvals (section 8) | Any; deploy only after approval |

## 3. LAI-LAMBDA-002: GLB/glTF validator and metadata extraction

- **Trello:** https://trello.com/c/PDHxtgBP
- **Status:** READY.
- **Prerequisites:** Wave 1 merged (registry, execution engine, contracts).
- **Interfaces consumed:** `ProcessingProfile`, `OptionSpec`, `ResourceLimits.complexity_limit`,
  `Finding`, `Severity`, `Verdict`, `ProcessingError`, `ErrorCode`, the registry registration API
  (`ProcessorRegistry.register`; add the processor to `default_registry()`'s explicit list) and
  the `Processor` base class, `ProcessingContext.check()` (call it in every parsing loop),
  `job_type_spec("asset.validate_model")`.
- **Owns:** `processing/lai_processing/processors/glb.py` (and helper modules under
  `processors/`, e.g. a pure `gltf` parser), its profile declaration(s), its registry entry,
  `tests/processing/processors/test_glb*.py`, fixtures under `tests/processing/fixtures/glb/`
  (exact path free within `tests/processing/`), golden metadata files. Parity tests may live
  under `lai/apps/assets/tests/` in a new file.
- **Expected implementation (card scope):** full glTF 2.0/GLB validation: header and chunk
  layout, buffers, buffer views and accessors with bounds, external-resource policy (refuse
  external `uri`, as `lai/apps/assets/validation.py` does), meshes, triangle counts, materials,
  texture references, skeletons, animation clips and durations, Mixamo generic clip names.
  Extract a **pure** parser from `lai/apps/assets/validation.py` (today it reads Django
  `settings` and imports `.models`): limits come from the profile and `ResourceLimits`, not
  settings. Findings keep the Asset Library shape `{code, severity, message, path}` and, where a
  check exists in both, the **same codes**, so a result maps onto `AssetVersion.validation_report`.
  Verdict `fail` if any `error` finding.
- **Do not break Django's synchronous path.** `validation.py` keeps working unchanged in this
  task. Switching Django to call the shared parser is a follow-up: it needs the Django image to
  install `processing/` (`lai/Dockerfile` copies `lai/` only today).
- **Unit tests:** valid, invalid, oversize and hostile fixtures (card): lying chunk lengths,
  truncated files, trailing data, huge counts, deep JSON, external URIs, data-URI bombs,
  unsupported compression extensions; golden metadata output (byte-stable canonical JSON);
  parity tests: every fixture gives the same pass or fail and the same error codes in
  `validation.py` and the new processor; time and memory stay within the profile limits.
- **Acceptance:** `asset.validate_model` runs through the CLI and the engine with fakes; all
  fixtures pass; parity suite green; no Django, boto3 or network import in the processor.
- **Integration dependencies:** 004 maps its result onto `AssetVersion`; 003 runs it in Lambda.
- **Prohibited overlap:** do not edit contracts, ports, lifecycle, engine or other processors;
  do not change `lai/apps/assets/validation.py` behaviour.

## 4. LAI-LAMBDA-003: local async worker, adapters, Lambda handler

- **Trello:** https://trello.com/c/ckPzB21a
- **Status:** READY (agree the seam in section 7 with 004 on day one).
- **Prerequisites:** Wave 1 merged.
- **Interfaces consumed:** `ObjectStorage`, `ObjectInfo`, storage error classes, `MessageQueue`,
  `Delivery`, `SendReceipt`, `QueueFull`, `Telemetry`, `LoggingTelemetry`, `Clock`,
  `decode_request`, `encode`, `build_completion_event`, `artifact_key`, `StoreName`, the
  `ExecutionEngine.decode_and_execute` and `ExecutionEngine.complete`, `CancellationToken`
  (cancel when the Lambda context's remaining time falls below the cleanup margin).
- **Owns:** a separate adapters package so the core stays boto3-free, proposed
  `processing/lai_processing_adapters/` with: `filesystem.py` (`ObjectStorage` on a directory
  root), `s3.py` (`ObjectStorage` on S3: `GetObject` with `VersionId`, `PutObject` with
  `IfNoneMatch="*"` and `ChecksumSHA256`, error mapping to the port's classes), `sqs.py`
  (`MessageQueue` on SQS), `local_worker.py` (a polling worker that never runs inside a Django
  HTTP request), `lambda_handler.py` (SQS event to engine to completion queue, returning
  `batchItemFailures`), a container build file for the Lambda image, and tests under
  `tests/processing/adapters/`. Packaging metadata for the adapters (its own `pyproject.toml`
  with `boto3` as a dependency) is a new dependency and must be declared, not slipped in.
- **Expected implementation (card scope):** local async worker that does not block Django HTTP;
  filesystem adapter; storage and queue abstraction; containerized Lambda handler invocation;
  the same core in both runtimes; LocalStack not required. Logical store to bucket and prefix
  mapping lives in adapter configuration, never in messages. Clean `/tmp` between invocations.
- **Unit tests:** file-mount and `/tmp` handling; fake SQS envelopes and real SQS record parsing
  (a captured-shape fixture of an SQS Lambda event); partial batch failure; `botocore` Stubber for
  S3 and SQS (no network); create-only semantics (identical rewrite ok, different bytes
  `ObjectExists`); version-pinned reads; error mapping (404 to `ObjectMissing`, 403 to
  `StoragePermissionDenied`, 5xx and throttling to `StorageUnavailable`); oversized result goes
  by reference.
- **Acceptance:** a request fixture runs end to end locally (filesystem plus local queue) and in
  a locally invoked Lambda container with the same result bytes; the core package still imports
  no boto3.
- **Integration dependencies:** 004 uses the SQS adapter for dispatch and consumption; 005
  provides queue URLs, bucket names and the image repository.
- **Prohibited overlap:** no Django code; no CDK; no change to `lai_processing` core modules.
- **Note:** "No Docker on EC2" is satisfied: the image is built off-host (GitHub Actions) and
  run by Lambda. Local container runs are developer-machine only.

## 5. LAI-LAMBDA-004: Django `processing` app

- **Trello:** https://trello.com/c/tMJsWpFd
- **Status:** READY for models, services, Admin and commands against fakes. The `DRAFT`
  integration stays behind a flag. Blocked only on the core idempotency helper for merge.
- **Prerequisites:** Wave 1 merged, including lifecycle and the idempotency helper.
- **Interfaces consumed:** `JobState`, `decide_completion`, `RetryPolicy` (Wave 1, names to
  confirm), `ProcessingJobRequest`, `CompletionEvent`, `CompletionEvent.verify_result`,
  `ProcessingJobResult`, `decode_event`, `decode_result`, `encode`, `MessageQueue`, `ObjectStorage`,
  `MemoryQueue` and `MemoryObjectStorage` in tests.
- **Owns:** `lai/apps/processing/` (models, migrations, services, admin, management commands,
  tests); its settings entries; adding `processing/` to the Django image (`lai/Dockerfile` and
  requirements) so Django can import `lai_processing`; flag-guarded hooks in
  `lai/apps/assets/services.py` only if strictly needed, coordinated with the Asset Library owner.
- **Expected implementation (card scope):**
  - Models: `ProcessingJob` (linked to `AssetVersion` where applicable; input object version and
    hash, profile, status, attempts, error details, timestamps, correlation ids; unique
    idempotency key per namespace), `ProcessingAttempt` (attempt id, number, applied marker:
    the applied ledger), `ProcessingOutbox` (encoded request, sent marker), `ProcessingArtifact`
    (store, key, version id, sha256, size, content type, source job and attempt).
  - Guarded transitions with `select_for_update`, validated through the lifecycle module.
  - Transactional outbox and a dispatch command; a completion consumer command (systemd-ready)
    that acks only after commit; lease and reconciliation command.
  - Staff-only status in Django Admin (no React staff UI, ADR-045); staff re-queue and cancel
    actions with Django permissions.
  - `AssetVersion` `DRAFT` integration behind a flag, default off; processing success never
    publishes; publishing stays the existing staff action.
  - Django is the sole database writer.
- **Unit tests:** every transition allowed and refused; concurrent submit gives one job;
  outbox written atomically with `QUEUED`; consumer: apply, retry (new attempt and delayed
  outbox), duplicate, stale, reject (each acked after commit), database error releases without
  ack; by-reference results read and verified; authorization of Admin actions; no child data
  anywhere.
- **Acceptance:** an end-to-end test with `MemoryQueue` and `MemoryObjectStorage` (submit,
  dispatch, worker via the engine, completion, review state) passes; duplicate and replayed
  completions change nothing; flag off leaves the Asset Library behaviour unchanged.
- **Integration dependencies:** 003 adapters for AWS; 002 result shape for `AssetVersion` mapping;
  006 (Wave 3) adds presigned uploads and enqueue after upload.
- **Prohibited overlap:** no change to `lai_processing` core or contracts; no CDK; no React.

## 6. LAI-LAMBDA-005: AWS infrastructure reconciliation

- **Trello:** https://trello.com/c/cgbkYzMc
- **Status:** READY for CDK code and tests; **BLOCKED for any deploy** (owner approvals, section 8).
- **Prerequisites:** none for code; coordinate with LAI-INFRA-001/002
  (`docs/infrastructure/inventory.md`, `resource-ownership.md` section 3.4).
- **Interfaces consumed:** `PLATFORM_CEILINGS` (to size timeout, memory, ephemeral storage),
  `DEFAULT_MAX_MESSAGE_BYTES`, store prefixes from `contracts/identifiers.py`.
- **Owns:** a new stack `infra/lib/processingStack.ts` (`LaiProcessing-<env>`), its test file,
  its wiring in `infra/bin/app.ts`, an optional step in `scripts/aws/provision.sh`, and the
  matching rows in `docs/infrastructure/resource-ownership.md`.
- **Expected implementation (card scope):** environment-isolated S3 paths or buckets; SQS work
  and completion queues with DLQs (`OPERATIONS.md` section 2); Lambda from a container image in
  ECR, image referenced by digest through a CloudFormation parameter (keeps the bootstrapless
  model); restricted IAM per prefix (`SECURITY.md`); log retention; alarms on queue age, errors
  and throttles; reserved concurrency; no object-created dispatch (safe filters if any S3 event
  exists, never on artifact prefixes); prefer no VPC and no NAT; timeout, memory and ephemeral
  storage sizing; visibility timeout; `ReportBatchItemFailures`; separate environment configs;
  cost and IAM docs; no Docker on EC2 (build off-host).
- **Unit tests (Jest, as the other stacks):** queue and DLQ properties; queue policies (only the
  worker sends completions, only Django sends work); IAM statements exact (no wildcards beyond
  the prefixes); Lambda image from a parameter, no CDK asset; reserved concurrency set; alarms
  present; no VPC/NAT unless configured; stacks other than `LaiProcessing` still have zero
  Lambda (existing tests in `infra/lib/djangoDeployment.test.ts` keep passing).
- **Acceptance:** `cdk synth` with the bootstrapless synthesizer succeeds; tests pass;
  `resource-ownership.md` updated; nothing deployed.
- **Prohibited overlap:** no Python changes; no change to `LaiDjangoEc2` beyond what the owner
  approves (for example granting the instance role queue access by name).

## 7. The 003 and 004 seam (agree before coding)

| Seam | Owner | Agreement |
|---|---|---|
| Work-queue send | 004 dispatcher calls `MessageQueue.send(encode(request))` | 003 supplies `SqsMessageQueue` implementing the port; 004 tests with `MemoryQueue` |
| Completion receive and ack | 004 consumer calls `receive`, then `ack` after commit or `release(delay_seconds=...)` on failure | Same port; visibility handled by the adapter |
| By-reference results | 004 reads with `ObjectStorage.read(ref, max_bytes=...)` | 003 supplies the S3 adapter; store-to-bucket mapping from Django settings |
| Adapter construction | 004 owns a small factory in `lai/apps/processing/` that imports 003's classes lazily, so Django runs without boto3 paths in tests | 003 keeps constructor signatures stable once agreed |

## 8. Approvals needed (owner)

| # | Item | Recommendation |
|---|---|---|
| A1 | Release system. The Wave 1 brief mentioned CodePipeline/CodeBuild, but the owner rejected them on 2026-11-09 (`docs/infrastructure/deployment-design.md` P1) | Build and push the worker image from GitHub Actions with OIDC; no CodePipeline/CodeBuild |
| A2 | The brief says no development load balancer or WAF, but `LaiDjangoEc2-<env>` defines an ALB and a WAF Web ACL for every environment | Out of scope for processing; decide separately. Processing needs neither |
| A3 | "CloudFormation-based deployment". The repository uses CDK synthesized to CloudFormation and deployed with `aws cloudformation deploy` change sets (`scripts/aws/provision.sh`) | Compatible: keep CDK as the single source; no hand-written competing templates. `lai-dev-complete.yaml` is still missing (blocker B1, decision D1) |
| A4 | Lambda code delivery in a bootstrapless setup. Options: (a) bootstrap the account; (b) upload a zip to an artifact bucket from GitHub Actions and pass key and version as parameters; (c) container image in ECR, digest as a parameter | **(c)**, as cards 003, 005 and 012 ask (container image, immutable digest, rollback). Needs a decision on the repository: a new `lai/processing` ECR repository (recommended, owned by `LaiDjangoRelease` or `LaiProcessing`) or reuse of `lai/django` |
| A5 | Overnight stop/start schedule (00:00 to 08:00 Pacific) does not exist in IaC | Approve a scheduler resource and its owning stack, or keep stops manual |
| A6 | "No Docker on EC2" versus today's design: the Django instance runs gunicorn under Docker Compose with the image from ECR (ADR-037, `infra/lib/djangoEc2Stack.ts`), and dev may run PostgreSQL in a container (`databaseMode: container`) | Processing adds no Docker on EC2. Whether to change ADR-037's runtime or remove the container database mode is a separate owner decision |
| A7 | Card 005 asks for separate staging and prod configs; the repository has only `dev` and `prod` environments | Confirm whether a staging environment is intended |
| A8 | IAM change to the asset bucket (Django needs quarantine writes and artifact reads; the worker needs read and artifact-write rights) | Separate processing bucket per environment, or new prefixes in the asset bucket with reviewed policies |
| A9 | Any deployment (ADR-019 G7) | Per-stack change set review by the owner |
| A10 | ADR numbering: `docs/DECISIONS.md` says the next free number is 055, but open PRs hold 055 to 060 | Use ADR-061 and add a registry note |

## 9. Inconsistencies found while drafting, and how they were resolved

- `asset.optimize` is owned by LAI-LAMBDA-010 (texture compression and GLB optimisation; ECS
  Fargate is only that card's fallback runtime for runs over 15 minutes). The catalog is correct.
- The idempotency key helper now exists (`core/idempotency.py`); the request still carries no
  processor identity, so `processor_version` is optional in the key and both forms verify.
- `CompletionEvent` now carries `retry_class` as its own field, so a by-reference event
  round-trips byte for byte and `decide_completion` routes a by-reference failure without
  fetching the result.
- `ports/storage.py` no longer mentions a Wave 1 filesystem adapter; that adapter is 003's.
- Request `options` accept floats, nulls and lists, while `OptionSpec` declares only `bool`,
  `int` and `str` in v1. That is intentional: a profile is stricter than the envelope, and any
  undeclared type is refused by `resolve_options`. A processor that needs another option type
  adds it to `OptionSpec` (principal change).

