## ADR-061: Runtime-independent background processing: Django-authoritative jobs, SQS work and completion queues, and Lambda workers that never touch the database or publish

Status: Proposed (owner acceptance pending). LAI-LAMBDA-001, Trello
[N5lWZeq4](https://trello.com/c/N5lWZeq4), branch `feature/serverless-processing`. Development
only: no queue, function, role or alarm is defined in `infra/` or deployed. Builds on ADR-019,
ADR-025, ADR-035, ADR-042 and ADR-045. Detail: `docs/processing/`.

**Registry note.** `docs/DECISIONS.md` lists 055 as the next free number, but open pull requests
#26 to #39 already hold decision numbers 055 to 060. This decision takes 061; the registry row should say
so, and the next-free line should move past 061.

**Context.** Staff upload game assets in Django Admin, and the Asset Library validates them
synchronously inside the request (`lai/apps/assets/services.py`, `validation.py`). Heavier work is
coming: full glTF analysis, audio processing with FFmpeg, animation analysis, derived
artifacts, and runs that can take minutes. `AssetVersion.DRAFT` is reserved for a future
asynchronous validation step and no code path creates it. The repository has no SQS, Lambda or
EventBridge resource; every `infra/` stack is bootstrapless (`BootstraplessSynthesizer`) and
tests assert zero Lambda functions per stack. RDS PostgreSQL 16 (`t4g.micro` by default) sits in
private isolated subnets with no NAT gateway. The owner's target for the dev environment is a
small EC2 instance with Django, RDS Single-AZ, S3, Lambda for heavy processing, SQS work and
completion queues, CloudWatch, us-west-1, no Docker and no PostgreSQL on EC2, and an optional
overnight stop from 00:00 to 08:00 Pacific. AI Question Studio already runs long batches on a
PostgreSQL-backed queue (`GenerationBatch`, `LAI_STUDIO_RUN_MODE`), with LAI-AQS-027 open.

**Decision.**

1. **Runtime independence.** Job logic lives in `lai_processing` (`processing/`), a
   standard-library-only package with versioned contracts, a classified error taxonomy,
   resource limits, ports (storage, queue, clock, telemetry), a pure lifecycle module, a retry
   policy, an execution engine and an explicit processor registry. It imports no Django, boto3,
   Lambda runtime, HTTP client or database driver. Tests, the local CLI, a local worker and
   Lambda all run the same core; only adapters differ.
2. **Django and PostgreSQL are authoritative.** Django creates every job row, owns every state
   transition (row lock plus the lifecycle module), records attempts, artifacts and results,
   and remains the only database writer. Processing success never publishes: it brings a job to
   `READY_FOR_REVIEW`, and publication stays the existing explicit staff action (ADR-045).
3. **Two SQS queues, each with a DLQ.** A work queue (Django to worker) and a completion queue
   (worker to Django). Messages are canonical JSON contracts, schema version 1, strictly decoded,
   at most 240 KiB, and never carry file bytes, URLs, bucket names, credentials or child data.
   Large results travel as an artifact referenced by the completion event.
4. **The worker never connects to RDS by default and never publishes.** It reads its input from
   S3, verifies size and SHA-256 before the processor runs, writes immutable artifacts under its
   own attempt prefix, and sends one completion event.
5. **Single dispatch path.** A transactional outbox: the job's move to `QUEUED` and the encoded
   request commit in one transaction; a dispatcher sends committed rows. S3 object-created
   events do not dispatch work.
6. **Delivery guarantee.** At-least-once, never exactly-once. Idempotent application through a
   unique idempotency key per namespace, attempt-scoped artifact keys with create-only writes,
   an applied-attempt ledger, and a pure decision (`APPLY`, `RETRY`, `DUPLICATE`, `STALE`,
   `REJECT`). The consumer acknowledges a completion only after its transaction commits.
   Application retries are new attempts (3 attempts, exponential backoff with full jitter,
   capped at 900 s); transport redelivery is bounded by DLQs (`maxReceiveCount` 5).
7. **Security boundaries.** Logical stores, not buckets, in messages; strict key validation;
   namespace in every message and key; per-prefix least-privilege IAM; only the worker role may
   send completions and only Django may send work; Django verifies every completion against its
   own record and logs mismatches as security signals; telemetry restricted to a closed field
   vocabulary (ADR-025); fixed error messages. No child data is processed; child photos
   (ADR-042) never use this pipeline without a separate decision.
8. **Local development.** In-memory fakes and the CLI need no AWS. A local worker with filesystem
   storage runs outside Django HTTP requests (LAI-LAMBDA-003). LocalStack is not required.
9. **Extensibility.** Job types are a closed catalog in code; processors are registered
   explicitly; profiles are immutable per version. New processors (audio, animation,
   optimisation) add code, not infrastructure. Runs over 15 minutes go to an ECS Fargate fallback
   (LAI-LAMBDA-010), not to the Django EC2 instance.
10. **Infrastructure ownership.** CDK stays the single source of infrastructure. A new stack
    `LaiProcessing-<env>`, separate from `LaiDjangoEc2-<env>`, owns the queues, DLQs, worker
    function, its role and alarms (as `resource-ownership.md` section 3.4 already proposes). The
    worker ships as a container image built off-host in GitHub Actions, stored in ECR and
    referenced by immutable digest through a CloudFormation parameter, which keeps the
    bootstrapless model (pending approval A4).
11. **Shutdown and recovery.** Queues retain work and completions for 14 days. While EC2 and RDS
    are stopped, the worker keeps processing (it needs only S3 and SQS) and completions
    accumulate. On startup the consumer drains the backlog idempotently and reconciliation finds
    expired or stuck jobs. Jobs carry `expires_at`; an expired job fails with `job_expired`.
12. **AI Question Studio is unchanged.** It keeps its PostgreSQL-backed queue; it may adopt these
    contracts later, but moving it to SQS needs a separate approval.

**Why the worker does not connect to RDS by default.** Connection limits on a `t4g.micro`
instance shared with gunicorn; VPC placement would need NAT or paid interface endpoints because
RDS subnets are isolated; database credentials in a worker widen the blast radius of any
processor bug; the overnight stop would make every database-dependent worker fail; and a single
writer keeps transitions, locking and audit in one place (Django).

**Alternatives considered.**

| Alternative | Why not chosen |
|---|---|
| Lambda writes RDS directly | Reasons above; also splits transition logic between two runtimes |
| Django-only PostgreSQL job queue (as AQS) | No new AWS resources, but heavy work would run on the small EC2 instance (card 012 forbids it as the default fallback) and stop with it overnight |
| Celery with Redis | A broker to run and pay for on EC2 or ElastiCache; workers still need the host |
| Step Functions | Useful for multi-step flows later; adds state outside Django and cost for single-step jobs |
| EventBridge Pipes | Another moving part between queue and worker with no need today |
| AWS Batch or ECS Fargate as the primary runtime | Slower start and more infrastructure for short jobs; kept as the over-15-minute fallback (010) |
| S3 object-created events triggering Lambda directly | Starts work without a committed job row, bypasses Django authority, and risks output-trigger loops; the outbox is the single dispatch path |

**Consequences.** Heavy processing leaves the request path and the EC2 host. Two queues, two
DLQs, a function, a role, an ECR repository and alarms become new resources to operate. Django
gains a processing app, a dispatcher and a consumer service. Every change to a message is a
versioned, consumer-first change. Results can arrive while a job still shows `QUEUED`.

**Approvals needed.**

| # | Item |
|---|---|
| A1 | The Wave 1 brief named CodePipeline/CodeBuild; the owner rejected them on 2026-11-09 (`deployment-design.md` P1). Proposed: GitHub Actions with OIDC builds the worker image |
| A2 | The brief says no development load balancer or WAF; `LaiDjangoEc2-<env>` defines both. Not changed by this decision |
| A3 | "CloudFormation-based deployment": CDK synthesized to CloudFormation and applied by `provision.sh` change sets is compatible; no hand-written competing template (`lai-dev-complete.yaml` is still missing, blocker B1 and decision D1) |
| A4 | Lambda code delivery without CDK bootstrap: container image by digest (recommended), zip by parameter, or bootstrapping the account; and which ECR repository |
| A5 | The overnight stop/start schedule does not exist in IaC |
| A6 | "No Docker on EC2" conflicts with today's Django runtime (Docker Compose, ADR-037) and the dev `container` database mode; processing adds no Docker on EC2 |
| A7 | Card 005 names staging; the repository has only dev and prod |
| A8 | Asset bucket IAM: new prefixes in the asset bucket or a separate processing bucket |
| A9 | Every deployment (ADR-019 G7) |
