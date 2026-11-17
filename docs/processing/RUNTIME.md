# Processing runtime: adapters, local worker and Lambda handler (LAI-LAMBDA-003)

**Nothing on this page is deployed.** No image has been built or pushed, no function exists, and
no AWS call was made while building this package. Infrastructure (queues, bucket, ECR, the
function) is LAI-LAMBDA-005 and needs owner approval to deploy.

Binding interface: [`WAVE2_INTERFACES.md`](WAVE2_INTERFACES.md) sections 1, 3, 4, 5 and 7. This
page describes how `processing/lai_processing_runtime/` implements them; it introduces no new
setting, message format, bucket identity, queue name or retry behaviour.

## 1. Architecture

```text
             Django (004)                              worker runtime (this package)
  submit -> outbox -> relay --work queue--> [Lambda handler | LocalWorker]
                                                 |  process_work_message (worker.py)
                                                 |    decode -> ExecutionEngine.execute
                                                 |    -> ExecutionEngine.complete
                                                 |    -> completions.send
  consumer <------------completion queue---------+
```

| Module | What |
|---|---|
| `config.py` | `RuntimeConfig.from_env` (the section 4 worker settings, nothing else); `LocalRuntimeConfig` |
| `filesystem.py` | `FilesystemObjectStorage` (`ObjectStorage` on directories) |
| `s3.py` | `S3ObjectStorage` (`ObjectStorage` on S3) and the botocore error classification |
| `sqs.py` | `SqsMessageQueue` (`MessageQueue` on an SQS standard queue) |
| `local_queue.py` | `LocalDirectoryQueue` (durable file-per-message `MessageQueue`) |
| `telemetry.py` | `JsonLogTelemetry` (JSON lines, closed field vocabulary) |
| `worker.py` | `process_work_message`: the per-record core both runtimes share |
| `local_worker.py`, `cli.py` | `LocalWorker` and `python -m lai_processing_runtime` |
| `lambda_handler.py` | `handler(event, context)`, the Lambda entry point |

Dependency rules (tested in `tests/processing/test_runtime_packaging.py`): the package never
imports Django or anything under `lai/`; boto3 and botocore are imported lazily inside the S3/SQS
adapters and the Lambda wiring only, so importing any module (and running the local worker)
loads neither. `lai_processing` still imports no boto3 and no `lai_processing_runtime`.

Packaging: `processing/pyproject.toml` ships both packages in the `lai-processing`
distribution; boto3 is the optional extra `aws` (`pip install './processing[aws]'`), pinned to
the repository's `requirements.txt` version. Django (004) already has boto3.

## 2. Store mapping (section 3)

| Store | S3 (`S3ObjectStorage`) | Filesystem (`FilesystemObjectStorage`) | Worker access |
|---|---|---|---|
| `assets` | `LAI_ASSET_BUCKET` | `<assets root>/<key>` (Django `LocalAssetStorage` layout under `LAI_ASSET_LOCAL_ROOT`) | read |
| `quarantine` | `LAI_PROCESSING_BUCKET` | `<processing root>/<key>` | read |
| `artifacts` | `LAI_PROCESSING_BUCKET` | `<processing root>/<key>` | read and create-only write |

Buckets come from `RuntimeConfig.buckets()` only; a message names a store and a key. Both
adapters re-validate every key with `check_object_key` and refuse a store they have no
location for.

### FilesystemObjectStorage

- **Containment and symlinks.** The path is walked one directory at a time with
  `openat(O_DIRECTORY | O_NOFOLLOW)` from the store root's descriptor, and the object is opened
  with `O_NOFOLLOW` (and `O_NONBLOCK`, so a planted FIFO cannot hang the worker). A symlink
  anywhere below the root, as a parent directory or as the final file, is refused with
  `StoragePermissionDenied` (`reason=symlink`), on reads, writes and deletes. The root itself is
  resolved once at construction, so a configured root may sit behind a symlink.
- **Version ids** are content-addressed: `sha256-<hex of the bytes>` (the contract's version
  alphabet has no `:`). They are deterministic across processes and hosts, so a redelivered
  attempt reports the same version, and a pinned read of a key whose bytes changed is
  `ObjectMissing`, as for a missing S3 version. `head` hashes the file (cached per device,
  inode, size, mtime and ctime). Requests built by Django for the local backend may leave
  `version_id` null or use this value.
- **Create-only atomic put.** Bytes go to an `O_EXCL` temporary file in the target directory,
  are counted and hashed as written, `fsync`ed, verified against `sha256` and `size_bytes`
  (mismatch: `CHECKSUM_MISMATCH`, nothing published), then published with `link()`, which fails
  if the key exists. An existing key is never overwritten; identical content is an idempotent
  success; different content is `ObjectExists`. Concurrent writers are safe because only one
  `link()` can win. Files are created `0600`, directories `0700`. Needs a filesystem with hard
  links (ext4, xfs, APFS).
- **Errors:** missing file or directory `ObjectMissing`; `EACCES` and symlinks
  `StoragePermissionDenied`; any other `OSError` `StorageUnavailable` (errno name only).
- `delete` works only on writable non-assets stores; a missing object is not an error.
- Content types are not stored (`head` reports `None`).
- Residual risk: a hard link to a file outside the root cannot be detected cheaply; store roots
  must not be writable by untrusted local users.

### S3ObjectStorage

- `head_object` with `ChecksumMode='ENABLED'` and `VersionId` when the reference pins one; a
  response for another version is `ObjectMissing`.
- SHA-256 from `ChecksumSHA256` (base64 to hex). A composite checksum (`...-N`, or
  `ChecksumType == 'COMPOSITE'`), a malformed one or none is `sha256=None` and the engine's
  streamed hash decides. **The ETag is never used as a SHA-256** (tested with an ETag that looks
  like a digest).
- `open` is `get_object` (with `VersionId`) wrapped in a stream that asks the body for at most
  1 MiB per read and maps mid-stream transport errors to `StorageUnavailable`. `read` refuses an
  object whose `ContentLength` exceeds `max_bytes` before reading, and stops at `max_bytes + 1`.
- `put` spools and verifies the bytes locally first (size and SHA-256; a mismatch makes no
  request), then `put_object` with `ChecksumAlgorithm='SHA256'`, `ChecksumSHA256`,
  `IfNoneMatch='*'`, `ContentLength`, `ContentType` and `ServerSideEncryption` (default
  `AES256`, constructor argument for 005 if the bucket mandates KMS). `412 PreconditionFailed`:
  the existing object is headed; same recorded SHA-256 is an idempotent success, a different or
  unknown checksum is `ObjectExists`.
- Error classification (codes only, AWS messages are discarded):

| Botocore failure | Port error |
|---|---|
| `NoSuchKey`, `404`, `NotFound`, `NoSuchVersion` | `ObjectMissing` |
| `AccessDenied`, `403`, `Forbidden`, `ExpiredToken`, `InvalidAccessKeyId`, `NoSuchBucket` (misconfiguration), missing credentials | `StoragePermissionDenied` |
| `SlowDown`, `Throttling*`, `RequestTimeout`, `InternalError`, `ServiceUnavailable`, any 5xx or 429, `ConditionalRequestConflict`, connection and read timeouts, other `BotoCoreError` | `StorageUnavailable` |
| any other 4xx | `StorageError` (STORAGE_FAILURE) |

## 3. Transport (section 5)

### SqsMessageQueue

`send` refuses bodies over `max_message_bytes` (default 240 KiB) with `ValueError`, sends the
canonical ASCII JSON as `MessageBody` and `DelaySeconds` when non-zero. Transient send failures
(throttling, 5xx, connection, timeout) raise the port's `QueueFull`; other failures raise
`QueueError(operation, code, transient)`. `receive` uses `MaxNumberOfMessages` (1 to 10),
`WaitTimeSeconds` (constructor, 0 to 20), `VisibilityTimeout` and
`AttributeNames=['ApproximateReceiveCount']`, mapped to `Delivery.receive_count`. `ack` is
`delete_message`, `release` is `change_message_visibility(delay)`; a stale receipt is ignored.

### LocalDirectoryQueue

```text
<queue>/tmp/       being written
<queue>/ready/     <visible_at_ms>_<message id>_<receive count>.msg
<queue>/inflight/  <lease_expiry_ms>_<message id>_<receive count>_<token>.msg   (receipt)
<queue>/dead/      <message id>_<receive count>.msg
```

Writes go to `tmp/` and are renamed into `ready/`. `receive` returns expired leases to `ready/`
and claims visible messages by renaming them into `inflight/`; `rename` is the lock, so many
processes can share a queue (tested with four processes and 120 messages: each delivered once).
A message already received `max_receive_count` (5) times is moved to `dead/`. `ack` deletes,
`release` renames back with a delay. Wall-clock milliseconds, no network.

### Worker semantics (`process_work_message`)

Exactly section 5: insufficient time (remaining below the margin) starts nothing and fails the
record; otherwise the engine is copied with `max_execution_seconds =
max(1, min(840, engine ceiling, remaining - margin))`, the body is decoded (the same size limit
as `decode_and_execute`) and executed, `complete(max_message_bytes=completions.max_message_bytes)`
inlines or stores the result by reference, and the completion is sent. **The record succeeds
only after the send.** Any failure in `complete` or the send fails the record, so the transport
redelivers it and the same attempt reruns (create-only artifacts make the rerun harmless, and
Django deduplicates the second completion). Retryable and permanent job results both produce a
completion and succeed. An undecodable body (bad JSON, wrong kind, unsupported schema version,
invalid contract, oversize) produces no completion, fails the record and is logged as
`work.invalid` with only `error_code` and `receive_count`.

An interruption (the worker's own `CancellationToken`, cancelled on a forced local shutdown) is
not a job cancellation: its CANCELLED result is not sent and the record fails for redelivery.

### Poison messages and DLQ policy

| Case | Lambda | Local worker |
|---|---|---|
| Undecodable work | batch item failure each receive; SQS moves it to the work DLQ after `maxReceiveCount` 5 | released with backoff; moved to `queues/work/dead/` after 5 receives |
| Completion send or by-reference store failure | batch item failure; same attempt reruns | released with `RetryPolicy` full-jitter delay (base 2 s, cap 60 s) keyed on the receive count |
| Lambda time below margin | not started; batch item failure (it counts as a receive) | n/a |
| Job failed (retryable or permanent) | completion sent; record succeeds; Django decides the retry | same |

Replay from the DLQ is in `OPERATIONS.md` section 7.

## 4. Local worker

The local worker is an ordinary process; it never runs inside a Django HTTP request and keeps no
durable job state (Django owns jobs, attempts and the completion ledger).

```sh
cd processing
# Drop a request into <root>/queues/work; --input-file also stores its input (checked against
# the request's size and SHA-256) at <root>/<input key>.
python -m lai_processing_runtime enqueue --root ../lai/.processing-local \
    lai_processing/contracts/fixtures/request.reference.json \
    --input-file lai_processing/contracts/fixtures/request.reference.input.txt
python -m lai_processing_runtime worker --root ../lai/.processing-local --once
python -m lai_processing_runtime status --root ../lai/.processing-local
# Long-running, two threads, Django's local asset storage as the assets store:
python -m lai_processing_runtime worker --root ../lai/.processing-local \
    --assets-root ../lai/.asset-storage --concurrency 2 --poll-interval 1
```

(The reference fixture expires on 2026-11-17T12:00Z; after that a run reports `job_expired`,
which is the correct behaviour. The tests run it on a fixed clock.)

Flags: `--namespace` (default `local`; must match Django), `--once`, `--concurrency N` (threads),
`--poll-interval S`, `--max-messages N`, `--job-timeout S` (default 600, the Lambda timeout; the
lease is the timeout plus twice the margin, so a healthy job is never redelivered while it
runs), `--cleanup-margin S`, `--log-level`, `--assets-root DIR` (default: `--root`).
Completions land in `<root>/queues/completions/ready/` for Django's `local` consumer (004).
Job workspaces are under `<root>/tmp/workspaces` and are removed after every job.

Stopping: the first SIGTERM or SIGINT stops receiving and lets in-flight jobs finish; a second
one cancels them (they end as interrupted and are released for redelivery, never reported to
Django as cancelled).

Exit codes: 0 ok (with `--once`: every delivery succeeded), 1 with `--once` at least one
delivery failed, 2 usage, 3 invalid request (`enqueue`), 4 file or storage error.

## 5. Lambda handler

`lai_processing_runtime.lambda_handler.handler`, behind an SQS event source mapping with
`ReportBatchItemFailures` (batch size 1 by default, section 7):

- Parses the real SQS event shape (`Records[].messageId`, `body`,
  `attributes.ApproximateReceiveCount`, `eventSource`, `eventSourceARN`) and returns
  `{"batchItemFailures": [{"itemIdentifier": messageId}, ...]}`.
- Before each record reads `context.get_remaining_time_in_millis()`; below the cleanup margin
  (`LAI_PROCESSING_CLEANUP_MARGIN_SECONDS`, default 30) it starts nothing more and reports that
  record and all later ones as failures. A started job is clamped to `remaining - margin`.
- **Malformed invocation (documented choice): raise.** An event that is not a mapping, has no
  `Records` list, or has a record without a `messageId` raises `ValueError`: there is no item
  identifier to report, and a function error returns the whole batch to the queue, where the
  DLQ policy applies. A record whose `eventSource` is not `aws:sqs`, or whose body is not a
  string, is a batch item failure.
- Clients, adapters, `default_registry()` and the engine are built lazily on the first
  invocation from `RuntimeConfig.from_env(os.environ)` and cached for the execution
  environment; the engine's namespace is pinned to `LAI_PROCESSING_NAMESPACE`. A missing or
  invalid setting raises `ConfigError` naming the setting (never its value). boto3 clients use
  standard retries (3 attempts), 5 s connect and 60 s read timeouts; the region and credentials
  come from the Lambda environment and role.
- `/tmp`: job workspaces live in `/tmp/lai-processing-workspaces`; anything there is removed at
  the start and end of every invocation (leftovers of a killed invocation), without following
  symlinks. The engine also removes each job's workspace in a `finally`.
- Logs: JSON lines on standard error through `JsonLogTelemetry` only (`SAFE_FIELDS`: ids,
  codes, counts, durations); never a message body, input, file name or exception message.

## 6. Image

`processing/Dockerfile.lambda` builds from `public.ecr.aws/lambda/python:3.12`, installs
`processing/runtime-requirements.txt` (boto3, botocore, s3transfer, jmespath, python-dateutil,
six and urllib3, pinned exactly to `requirements.txt`; a test enforces it) into
`${LAMBDA_TASK_ROOT}` (ahead of the runtime's bundled boto3 on `sys.path`), copies only
`lai_processing/` and `lai_processing_runtime/`, and sets
`CMD ["lai_processing_runtime.lambda_handler.handler"]`. `processing/.dockerignore` admits only
those paths and excludes caches, the contract fixtures and the JSON Schemas. No secret,
bucket or queue URL is baked in. The Lambda base image runs the handler as the sandbox user,
so there is no `USER` to set.

Build and run locally (developer machine or CI; nothing is pushed):

```sh
# From the repository root; arm64 is the function's architecture (section 7).
docker buildx build --platform linux/arm64 -f processing/Dockerfile.lambda \
    -t lai-processing:local --load processing/

# Pin the base image by digest for a release (CI resolves it and passes it in):
docker buildx imagetools inspect public.ecr.aws/lambda/python:3.12   # read the digest
docker buildx build --platform linux/arm64 -f processing/Dockerfile.lambda \
    --build-arg BASE_IMAGE=public.ecr.aws/lambda/python:3.12@sha256:<digest> \
    -t lai-processing:local --load processing/

# Invoke through the Runtime Interface Emulator bundled in the base image. With no AWS
# credentials the handler can still be exercised end to end only against fakes; against real
# queues and buckets it needs a role, which is a deployment step (005), not a local one.
docker run --rm -p 9000:8080 \
    -e LAI_PROCESSING_NAMESPACE=local \
    -e LAI_PROCESSING_BUCKET=example-processing-bucket \
    -e LAI_ASSET_BUCKET=example-asset-bucket \
    -e LAI_PROCESSING_COMPLETION_QUEUE_URL=https://sqs.eu-west-2.amazonaws.com/000000000000/example \
    -e AWS_REGION=eu-west-2 lai-processing:local
curl -s -XPOST http://localhost:9000/2015-03-31/functions/function/invocations \
    -d '{"Records": []}'      # -> {"batchItemFailures": []}
```

On an x86 machine, `--platform linux/arm64` needs QEMU binfmt (Docker Desktop has it).

**Docker is never needed on the EC2 Django server.** The image is built off-host (GitHub
Actions, 005) and run by Lambda; Django on the instance imports `lai_processing` and
`lai_processing_runtime` from the release wheel (section 8) and talks to SQS and S3 directly.

## 7. Tests

`/Coding/ENV/bin/python -m pytest -q tests/processing/` (no network, no AWS, no Docker):
`test_runtime_config.py`, `test_runtime_filesystem.py`, `test_runtime_s3.py` and
`test_runtime_sqs.py` (botocore `Stubber`), `test_runtime_local_queue.py` (including four
processes sharing a queue), `test_runtime_worker.py`, `test_runtime_lambda.py` (a captured-shape
SQS event, partial failures, the remaining-time cutoff, `/tmp`, identical results in both
runtimes), `test_runtime_local_worker.py` (the Wave 1 reference fixture end to end, graceful and
forced stop), `test_runtime_cli.py` and `test_runtime_packaging.py` (import independence,
pins, the Dockerfile, telemetry privacy).

## 8. Not done here

- The image has not been built in this task (the base image was not available offline, and
  pulling it is a network call); the RIE invocation above is documented, not run.
- `pip install --require-hashes` for the image needs hashes resolved online; follow-up for 005's
  CI job.
- Lambda-side `CancellationToken` cancellation on a timer is not used: the job deadline clamp
  already converts a near-deadline job into `processing_timeout`.

## IAM consequences for the S3 adapter (integration note, LAI-LAMBDA-005)

- The worker role has no `s3:ListBucket`, so a HEAD of a missing input key returns 403, which
  the adapter classifies as `permission_denied` (MANUAL), not `input_missing` (also MANUAL). Both
  stop automatic retries and surface for review; the job's safe error says which code applied.
- A redelivered attempt rewrites the same immutable artifact keys. `put` answers a create-only
  conflict (412) by reading the existing object's checksum, which needs `s3:GetObject` on the
  worker's own `processing/artifacts/<env>/*` prefix (grant `VerifyOwnArtifacts`), so an
  identical rewrite stays an idempotent success.
