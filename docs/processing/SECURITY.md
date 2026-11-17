# Processing security

Scope: staff-uploaded game assets (models, audio, images) and the derived artifacts and reports
of processing jobs. **No child data is processed by these jobs.** Child photos (ADR-042) must
never use this pipeline without a separate, approved decision: they live in their own bucket,
owned by the child profile subsystem, and nothing here may read or write it.

"Wave 1" means the control exists in `lai_processing` now (commit `3c34409` or the in-progress
Wave 1 modules, as marked). "Downstream" names the task that must deliver it. Nothing here is
deployed.

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
| **Untrusted uploads** | Input identity (`sha256`, `size_bytes`, `content_type`) is part of the request. The engine heads the object and streams it into the private workspace computing SHA-256 and size **before** the processor runs; a mismatch is `checksum_mismatch` (engine: Wave 1, in progress). Processors only see verified bytes. | 002 validators treat every byte as hostile; 004 stores the expected identity from Django's own upload, never from the client |
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
| **Temporary files** | Engine (Wave 1, in progress): private workspace (mode 0700), byte budget, always removed in a `finally`, including on timeout. | 003: Lambda `/tmp` is per-execution-environment and reused; the handler must clean between invocations (card 003 asks for `/tmp` tests) |
| **Resource exhaustion** | Limits on input, output, temp bytes, execution time (cooperative), artifact count, metadata size, message size, findings (500), warnings (50), errors (8), JSON depth (16 in contracts, 32 in the parser), option counts. | 005: Lambda timeout, memory, ephemeral storage sized above `PLATFORM_CEILINGS`; **reserved concurrency** to cap parallel runs (card 005); queue alarms |
| **Output-trigger loops** | Dispatch is only through the Django outbox; S3 events never dispatch work (`ARCHITECTURE.md` section 8). | 005: if any object-created notification is configured, filter it to input prefixes, never `processing/artifacts/` |
| **Compromised worker** | No database credentials, no publish capability, no Bedrock access in the contract. | 005: worker role has no RDS, no Secrets Manager, no Bedrock, no Cognito rights |

## 3. Network placement of the worker

| Option | Egress | Cost | Recommendation |
|---|---|---|---|
| Lambda outside a VPC | Internet egress possible at network level | None extra | **Preferred by card 005** ("prefer no VPC/NAT"). Residual risk: a processor bug could open a socket. Mitigations: the core imports no network module, processors are reviewed, IAM limits what any credential can reach |
| Lambda in the VPC, no NAT, S3 gateway endpoint plus SQS interface endpoint | No internet egress | SQS interface endpoint is billed per AZ-hour (not verified against current pricing) | Stronger isolation if the owner wants it |
| Lambda in the VPC with NAT | Internet egress | NAT gateway hourly and data charges | Not recommended |

The worker never needs the RDS subnets in any option.

## 4. Approval-sensitive items

- Any IAM change to the existing asset bucket policy (005, owner approval).
- Any deployment of queues, roles or functions (ADR-019 G7).
- G10 (deployed logging verification) before production.
