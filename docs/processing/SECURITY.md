# Processing security

Scope: staff-uploaded game assets (models, audio, images) and the derived artifacts and reports
of processing jobs. **No child data is processed by these jobs.** Child photos (ADR-042) must
never use this pipeline without a separate, approved decision: they live in their own bucket,
owned by the child profile subsystem, and nothing here may read or write it.

"Wave 1" means the control exists in `lai_processing` (LAI-LAMBDA-001, PR #40, merge-ready but
not merged). "Downstream" in section 2 names the task that was to deliver it; section 3 (added
2026-11-17) records what Wave 2 actually built for each of those items, and section 4 lists what
is still open. **Nothing here is deployed**: the IAM, queue policies and alarms below are
synthesized by CDK and pinned by tests, not live in AWS.

## 1. Trust boundaries

| Boundary | Trusted side | Untrusted side |
|---|---|---|
| Upload | Django (staff session, Django permissions, ADR-045) | The uploaded bytes |
| Work queue | Django (sole sender) | Anything that can reach the queue if IAM is wrong |
| Worker | The execution engine and registered processors | The request message and the input object |
| Completion queue | Django (sole consumer) | Every event, until verified against Django's own record |
| Artifacts | Django's record of key, size and SHA-256 | The stored bytes until re-verified |

## 2. Threats and controls

| Threat | Control in Wave 1 | Required downstream |
|---|---|---|
| **Untrusted uploads** | Input identity (`sha256`, `size_bytes`, `content_type`) is part of the request. The engine heads the object and streams it into the private workspace computing SHA-256 and size **before** the processor runs; a mismatch is `checksum_mismatch` (engine: Wave 1). Processors only see verified bytes. | 002 validators treat every byte as hostile; 004 stores the expected identity from Django's own upload, never from the client |
| **Path traversal** | `check_object_key` refuses `..`, `.`, empty segments, leading or trailing `/`, backslashes, control and non-conservative characters, keys over 1024 chars, keys outside the store prefix and (for quarantine and artifacts) outside the namespace. Artifact keys are built only by `artifact_key`. | 003 filesystem adapter must resolve paths under its root and refuse anything that escapes (symlinks included) |
| **Archive expansion** (zip bombs, GLB chunk lengths that lie) | Byte budgets: `max_input_bytes`, `max_temp_bytes`, `max_output_bytes`, clamped by `PLATFORM_CEILINGS`; `sha256_stream(max_bytes=...)` stops reading once over the limit. ZIP and RAR are not accepted asset formats (`docs/ASSET_LIBRARY.md` section 4). | 002: every GLB chunk and buffer length checked against the remaining file size before allocation; complexity counters (`max_vertices` and similar) from the profile |
| **Malformed GLB or audio** | Errors become classified codes with fixed messages; an unknown exception is `unexpected_failure` (manual), never retried in a loop and never echoed. | 002 and 008: bounded parsers, hostile and oversize fixtures (card 002), structures must end where the file ends |
| **SSRF and remote fetching** | Messages carry logical stores and keys, never URLs or bucket names; there is no URL field in any contract. The core imports no HTTP client. | 002: refuse external `uri` references (as `validation.py` does today); never fetch. 005: see section 3 for network placement |
| **Unsafe file types** | Content type in the request is metadata; processors must sniff magic bytes. | 002, 008: type from leading bytes only, never from extension or client content type (the existing Asset Library rule) |
| **Unauthorized S3 access** | Contracts only allow reads from `assets` and `quarantine` and writes to `artifacts` under the attempt prefix. | 005 IAM: worker role `s3:GetObject` (and `GetObjectVersion`) on `assets/*` and `processing/quarantine/<namespace>/*` only; `s3:PutObject` on `processing/artifacts/<namespace>/*` only; no delete, no list beyond what 404 handling needs, no ACL rights. Django's existing policy (`lai-django-asset-storage-<env>`) allows only `assets/{models,images,audio}/*`, so Django needs a reviewed addition for quarantine writes and artifact reads |
| **Cross-environment access** | `namespace` is in every message and every non-asset key; requests whose input is in another namespace are refused. | 005: per-environment buckets (or prefixes), queues and roles; the worker refuses `namespace_mismatch` against its configured namespace (engine) |
| **Cross-job artifact substitution** | `ArtifactReference` key must sit under `processing/artifacts/<namespace>/<source_job_id>/<source_attempt_id>/`; a result refuses artifacts of another job or attempt (`foreign_artifact`). | 004: consumer re-checks artifacts against the job and attempt it holds |
| **Forged completion messages** | `CompletionEvent` mirrors result identity and carries `result_sha256`; `verify_result` checks both. | 005: completion queue policy allows `sqs:SendMessage` only from the worker role. 004: Django verifies job, attempt, idempotency key, namespace and input checksum against its own record; mismatch is `REJECT` and a security signal. Optional later: HMAC over the event with a key in Secrets Manager (not designed) |
| **Duplicate processing** | Attempt-scoped immutable keys, create-only writes (identical rewrite is idempotent, different bytes `artifact_conflict`). | 004: unique idempotency key, applied-attempt ledger, `DUPLICATE` decision |
| **Stale results** | Results identify their attempt. | 004: `STALE` decision under the row lock (`LIFECYCLE.md`) |
| **Sensitive logging** | Telemetry accepts only `SAFE_FIELDS` (closed vocabulary of ids, codes, counts and durations), scalar values up to 128 chars, no newlines; anything else raises. Error messages are fixed per code; `details` pass through `safe_details`. Consistent with ADR-025. | 003: Lambda handler logs only through `Telemetry`; never log message bodies. 005: log retention set; G10 deployed-logging verification applies |
| **Temporary files** | Engine (Wave 1): private workspace (mode 0700), byte budget, always removed in a `finally`, including on timeout. | 003: Lambda `/tmp` is per-execution-environment and reused; the handler must clean between invocations (card 003 asks for `/tmp` tests) |
| **Resource exhaustion** | Limits on input, output, temp bytes, execution time (cooperative), artifact count, metadata size, message size, findings (500), warnings (50), errors (8), JSON depth (16 in contracts, 32 in the parser), option counts. | 005: Lambda timeout, memory, ephemeral storage sized above `PLATFORM_CEILINGS`; **reserved concurrency** to cap parallel runs (card 005); queue alarms |
| **Output-trigger loops** | Dispatch is only through the Django outbox; S3 events never dispatch work (`ARCHITECTURE.md` section 8). | 005: if any object-created notification is configured, filter it to input prefixes, never `processing/artifacts/` |
| **Compromised worker** | No database credentials, no publish capability, no Bedrock access in the contract. | 005: worker role has no RDS, no Secrets Manager, no Bedrock, no Cognito rights |

## 3. Wave 2 controls (as built, 2026-11-17)

Each row is code on `feature/serverless-processing-wave2`, with its tests. "Synthesized" means
CDK output pinned by `infra/lib/processingStack.test.ts`, not deployed.

| Threat | Wave 2 control | Where |
|---|---|---|
| **Hostile GLB input** (002) | Bounded structural validator, stdlib only, no network. Container checks before parsing (magic, version 2, declared length equals file size, chunk lengths within the file and `max_json_bytes`, no trailing bytes). Strict JSON: UTF-8 without BOM, unique keys, no `NaN`/`Infinity`, depth at most `max_json_depth` (64), recursion overflow refused, not crashed. Every array counted against its limit before it is walked; every product (`stride * (count - 1)`) capped first; nothing allocated from a declared size; vertex data never decoded. Complexity limits (nodes, meshes, accessors, vertices, triangles, joints and more) from profile `glb-default` v1, a request may override but the processor clamps each to 10 x its default. Every loop calls `context.check()` (cancellation and deadline). Data-URI images decode a bounded 64 KiB prefix; JPEG segment walk at most 256 segments | `processing/lai_processing/processors/gltf/`; `GLB_VALIDATION.md` sections 2 and 3; `tests/processing/test_processing_glb_*.py` |
| **SSRF / remote references** (002) | Every buffer or image `uri` other than an embedded `data:` URI (`http(s)`, `file:`, `s3:`, relative or traversal paths, non-strings) is the finding `external_resource` and is never fetched, opened or resolved | `gltf/document.py`, `GLB_VALIDATION.md` check 6 and 10 |
| **File content in messages** (002) | Finding messages are authored by code and never quote file content; `path` is an index path (`accessors[3]`). Strings copied into metadata are stripped of control, format (bidi), surrogate and private-use characters and cut to 200 characters | `gltf/report.py`, `gltf/metadata.py` |
| **Bad file passing as good** (002) | At most 200 findings; truncation adds `too_many_findings` as an `error` if a dropped finding was an error, so truncation cannot turn fail into pass. Parity corpus: the processor never passes a file Django refuses | `lai/apps/assets/tests/test_glb_processing_parity.py` |
| **Path traversal and symlinks, filesystem** (003) | `FilesystemObjectStorage` re-validates every key with `check_object_key`, walks one directory at a time with `openat(O_DIRECTORY or O_NOFOLLOW)` from the store root's descriptor, opens files with `O_NOFOLLOW` and `O_NONBLOCK` (a planted FIFO cannot hang the worker). A symlink anywhere below the root is `StoragePermissionDenied` (`reason=symlink`) on read, write and delete. Create-only put via an `O_EXCL` temp file, `fsync`, verify, then `link()` (fails if the key exists). Files `0600`, directories `0700` | `processing/lai_processing_runtime/filesystem.py`, `tests/processing/test_runtime_filesystem.py` |
| **Integrity, S3** (003) | SHA-256 only from `ChecksumSHA256` (`head_object` with `ChecksumMode='ENABLED'`, base64 to hex). A composite (`...-N` or `ChecksumType == 'COMPOSITE'`), malformed or missing checksum is "unknown" and the engine's streamed hash decides. **The ETag is never used as a SHA-256** (tested with an ETag that looks like a digest). `put` verifies size and SHA-256 locally before any request, then `put_object` with `ChecksumAlgorithm='SHA256'`, `ChecksumSHA256`, `IfNoneMatch='*'` and SSE. A 412 is resolved by reading the existing object's recorded checksum: same is idempotent success, different or unknown is `ObjectExists` | `lai_processing_runtime/s3.py`, `tests/processing/test_runtime_s3.py` |
| **Error leakage, S3/SQS** (003) | botocore errors are classified by code only; AWS messages are discarded | `s3.py`, `sqs.py` |
| **Unauthorized S3 access** (005) | Worker role: `ReadInputs` (`s3:GetObject`, `GetObjectVersion` on `<asset bucket>/assets/*` and `processing/quarantine/<env>/*`), `WriteArtifacts` (`s3:PutObject` on `processing/artifacts/<env>/*`), `VerifyOwnArtifacts` (`s3:GetObject` on its own `processing/artifacts/<env>/*` only). No `s3:Delete*`, no `s3:List*`, no ACL rights, no `*` resource. Django managed policy `lai-django-processing-<env>`: `QuarantineObjects` (put and get on quarantine), `ReadArtifacts` (get on artifacts). Processing bucket: block public access, bucket-owner-enforced, SSE-S3, TLS 1.2+ only, versioned, retained | `infra/lib/processingStack.ts` (synthesized) |
| **Integration defect fixed: VerifyOwnArtifacts** | The first worker role could only `PutObject` artifacts, but the S3 adapter resolves a create-only 412 by reading the existing object. A redelivered attempt would therefore have failed `permission_denied` instead of being an idempotent rewrite. Fixed by the `VerifyOwnArtifacts` grant, scoped to the worker's own artifacts prefix | `processingStack.ts` line with `grant('VerifyOwnArtifacts', ...)` |
| **403 for a missing input** (consequence of no `ListBucket`) | Without `s3:ListBucket`, S3 answers a HEAD of a missing key with 403. The adapter classifies 403 as `permission_denied` (MANUAL), not `input_missing` (also MANUAL). Both stop automatic retry and surface for staff; the job's safe error names `permission_denied`, so an operator must check whether the key exists before suspecting IAM. Deliberately not fixed by granting `ListBucket` (it would let the worker enumerate keys) | `RUNTIME.md` "IAM consequences"; `processing-infrastructure.md` section 3 |
| **Forged work or completion messages** (005) | Queue resource policies deny `sqs:SendMessage` to every principal except `lai-django-ec2-<env>` (work queue, `OnlyDjangoSendsWork`) and except the worker role (completion queue, `OnlyTheWorkerSendsCompletions`), plus TLS-only denies on all four queues; SSE-SQS. `additionalSenderRoleArns` may add an operator role for DLQ redrives (validated as IAM role ARNs) | `processingStack.ts` (synthesized) |
| **Forged or wrong completions, Django** (004) | Every completion is verified against Django's own record under the job row lock; mismatches are `REJECT` with a fixed reason (`unknown_job`, `namespace_mismatch`, `event_id_reused`, `identity_mismatch`, `result_mismatch`, `input_mismatch`, `unknown_attempt`, `attempt_mismatch`, `processor_mismatch`, `profile_mismatch`, `input_unverified`, `artifact_foreign`, `result_too_large`) and logged as `processing.completion_rejected` with ids and reason only. A by-reference result is read (at most 4 MiB) only for a job Django knows, so a forged event cannot make Django read arbitrary objects | `lai/apps/jobs/processing.py` (`apply_completion`, `_check_against_job`); `LIFECYCLE.md` section 9.3 |
| **Duplicate and stale processing** (004) | Unique (`namespace`, `idempotency_key`), `JobAttempt.applied_at` ledger, `CompletionReceipt.event_id` unique, `STALE` under the row lock | `LIFECYCLE.md` section 9 |
| **Django writes to processing storage** (004) | Django builds every processing store with `writable=frozenset()`: it only reads by-reference results | `apps/jobs/processing_transport.py` |
| **Sensitive logging, worker** (003) | `JsonLogTelemetry` emits JSON lines only through `check_fields` (closed `SAFE_FIELDS`: ids, codes, counts, durations); events such as `work.invalid`, `work.failed`, `work.completed`, `work.skipped`, `work.interrupted`, `work.completion_failed`, `job.started`, `job.duration`, `worker.started`, `worker.stopped`, `worker.tmp_cleaned`. Never a message body, input, file name or exception message; `work.invalid` carries only `error_code` and `receive_count`. A missing setting raises `ConfigError` naming the setting, never its value | `lai_processing_runtime/telemetry.py`, `worker.py`, `config.py`; `test_runtime_packaging.py` (telemetry privacy) |
| **Sensitive logging, Django** (004) | Logs carry job ids, attempt ids, kinds, actions, reasons and error codes only; never bodies, object keys, metadata or findings (ADR-025). The admin shows the request template (`payload`) to superusers only | `processing.py`, `admin.py` |
| **Temporary files, Lambda** (003) | Job workspaces in `/tmp/lai-processing-workspaces`, emptied at the start and end of every invocation without following symlinks; the engine also removes each workspace in a `finally` | `lambda_handler.py`, `test_runtime_lambda.py` |
| **Resource exhaustion** (003, 005) | Job deadline clamped to `remaining - margin` (at most 840 s) so a deadline is `processing_timeout`, never a silent kill. Lambda 600 s, 2048 MB memory and ephemeral storage, arm64, reserved concurrency dev 2 / prod 5, batch size 1, `ReportBatchItemFailures` | `worker.py`, `processingStack.ts` |
| **Output-trigger loops** (005) | No S3 event notification on the processing bucket; dispatch only from the outbox | `processingStack.ts` |
| **Compromised worker** (005) | Worker role has no RDS, Secrets Manager, SSM, KMS, Bedrock, Cognito, IAM or STS permission; ECR pull only for its repository; logs only to its pre-created log group | `processingStack.ts`, `processingStack.test.ts` |
| **Supply chain, image** (003, 005) | Image copies only `lai_processing/` and `lai_processing_runtime/`; runtime pins equal `requirements.txt` (tested); no secret, bucket or URL baked in. CI builds it for linux/arm64 and scans it with Trivy (fails on fixable CRITICAL). The function references the image by digest only; ECR tags immutable, scan on push | `processing/Dockerfile.lambda`, `ci.yml` `processing-image`, `processingImagesStack.ts` |
| **Unreviewed deployment** (005) | `deploy-processing.yml` is `workflow_dispatch` only, from `main`, gated by `LAI_PROCESSING_DEPLOY_ENABLED == 'true'` and a protected `processing-<env>` environment; `execute_change_set` defaults to false. Merging deploys nothing new | `.github/workflows/deploy-processing.yml` |

## 4. Remaining downstream items

| Item | Owner |
|---|---|
| Live verification of every IAM statement, queue policy and alarm (nothing is deployed) | Owner deploy approval, then 006/007 dev verification (`WAVE3_HANDOFF.md`) |
| Presigned uploads to `processing/quarantine/<env>/...`: checksum-bound PUT, size limit, content sniffing after upload, quarantine-to-assets promotion | 006/007 |
| Mapping results onto `AssetVersion` without trusting the worker (Django re-checks identity; `publish_version` keeps re-validating) | 006/007 |
| REJECT alerting: no CloudWatch metric filter or alarm on `processing.completion_rejected` exists yet | 006 |
| DLQ replay runbook and operator redrive role (`additionalSenderRoleArns`) | 006 |
| Resolved at integration: the consumer checks the database before each receive and hands back the rest of a batch after a database error, so an outage no longer moves completions to the DLQ | Done (Wave 2) |
| Optional HMAC over completion events (not designed) | Later, if the owner wants defence beyond IAM |
| Residual: a hard link inside a filesystem store root to a file outside it is not detected; roots must not be writable by untrusted local users | Accepted for local use |
| Residual: Lambda outside a VPC has network egress; mitigated by stdlib-only processors, no HTTP client, review and IAM | Accepted (card 005) |
| `pip install --require-hashes` for the image | 005 follow-up / 012 |
| Deploy role for `LaiProcessing-<env>` (B4 in `processing-infrastructure.md`) is as privileged as the reviewers of `processing-<env>` | Owner decision |
| G10 deployed-logging verification before production | ADR-019 gate |

## 5. Network placement of the worker

| Option | Egress | Cost | Recommendation |
|---|---|---|---|
| Lambda outside a VPC | Internet egress possible at network level | None extra | **Preferred by card 005** ("prefer no VPC/NAT") and **chosen in Wave 2** (`processingStack.ts`: no VPC). Residual risk: a processor bug could open a socket. Mitigations: the core imports no network module, processors are reviewed, IAM limits what any credential can reach |
| Lambda in the VPC, no NAT, S3 gateway endpoint plus SQS interface endpoint | No internet egress | SQS interface endpoint is billed per AZ-hour (not verified against current pricing) | Stronger isolation if the owner wants it |
| Lambda in the VPC with NAT | Internet egress | NAT gateway hourly and data charges | Not recommended |

The worker never needs the RDS subnets in any option.

## 6. Approval-sensitive items

- Any IAM change to the existing asset bucket policy (005, owner approval).
- Any deployment of queues, roles or functions (ADR-019 G7).
- G10 (deployed logging verification) before production.
