# Canonical background processing path (ADR-064)

Owner decision, 2026-11-17: Django `apps.jobs`, SQS, Lambda and ADR-055 are the one
background-processing architecture. This page records how the serverless processing pull
requests were reconciled with it and what remains to re-land.

## The path

| Concern | Implementation on `main` |
|---|---|
| Job record | `apps.jobs.ProcessingJob` (one table, one admin, one sweep) |
| Reliable submission | Transactional outbox: committed `PENDING` row, on-commit send under `FOR UPDATE SKIP LOCKED`, `dispatched_at`; `services.relay()` in the consumer re-sends undispatched rows once a minute; 5 failed sends fail the job (`submit_failed`) |
| Work queues | `lai-<env>-jobs-ai`, `lai-<env>-jobs-media`, each with a DLQ after 3 receives |
| Workers | Zip-packaged arm64 Lambda functions outside the VPC (`lambda/jobs_worker`), no database access |
| Completion | Result in S3 (`jobs/results/`) first, then a schema-1 message to `lai-<env>-job-results` (DLQ after 5 receives, 14-day retention) |
| Consumer | `jobs_consume_results` (`lai-jobs-consumer.service`), the only consumer |
| Database outage | `SELECT 1` before every receive; no receive while PostgreSQL is down; the rest of a batch is released on a mid-batch database error; the sweep does not time jobs out while results are queued |
| Idempotency | Duplicate and late results ignored under a row lock; Studio slot uniqueness; S3 results written before the message |
| Cancellation, retries | Admin fail action (`fail_processingjob`); Studio cancel and retry (`cancel_generationbatch`, `retry_generationbatch`); SQS redelivery bounded by DLQs |
| Monitoring | One CloudWatch alarm per DLQ; Lambda, jobs and Django log groups; Django Admin job list |
| IAM | Instance: send to work queues, consume results. Workers: own queue, send results, own S3 prefix; AI worker: US inference profile and Guardrail in the Bedrock Region |
| Flags | `EnableLambdaProcessing`, `LAI_JOBS_BACKEND`, `LAI_STUDIO_RUN_MODE`, `LAI_DEV_NATIVE_ENABLED`; `LAI_ASSET_ASYNC_VALIDATION` (approved, default off) arrives with the contract kinds |
| Infrastructure | `LaiDevPlatform-dev` only; no ECR in dev |

## Disposition of the pull requests

**PR #40 (`feature/serverless-processing`, LAI-LAMBDA-001, ADR-061).** Not merged; branch kept.
Its `lai_processing` package (versioned contracts, codec, limits, classified errors, lifecycle,
retry policy, processor registry, local CLI) is useful and standard-library only. It re-lands as
the processor library inside the existing zip worker, and its job types become `apps.jobs` kinds.
Superseded: its separate work and completion queues and the `LaiProcessing-<env>` plan.

**PR #41 (`feature/serverless-processing-wave2`, LAI-LAMBDA-002 to 005, ADR-062).** Not merged;
branch kept. Ported to `main` now:

- the consumer that never spends a receive while the database is down (`jobs_consume_completions`
  behaviour, applied to `jobs_consume_results`);
- the outbox relay semantics of `jobs_dispatch`, folded into the existing consumer so no new
  systemd unit is needed.

To re-land on this path (LAI-LAMBDA-002 and 004 stay open until then):

- the `asset.validate_model` and `reference.checksum` kinds, as `JobKind` values on the media
  queue, with their attempt, receipt and artifact records extending `ProcessingJob` (no second
  model);
- the pure-Python GLB validator, packaged into `jobs-worker-<hash16>.zip`;
- the contract envelope, introduced consumer first (Django accepts it before any worker sends it);
- `LAI_ASSET_ASYNC_VALIDATION` (default off) and the Asset Library submission path.

Not taken: `LaiProcessing-<env>`, `LaiProcessingImages-<env>`, the ECR repository and
`Dockerfile.lambda`, `deploy-processing.yml` and the `processing-<env>` GitHub environments, the
processing bucket, `jobs_dispatch` and `jobs_consume_completions` as separate services, and the
`lai-jobs-dispatch` and `lai-jobs-completions` systemd units.

## Separately tracked workloads (do not block the first deployment)

| Workload | Card | Packaging |
|---|---|---|
| GLB optimization (meshopt, Draco, KTX2) | LAI-LAMBDA-010 | Native tools; a container image only after its own ADR |
| Audio transcoding and loudness | LAI-LAMBDA-008 | FFmpeg; a container image only after its own ADR |
| Thumbnails and image conversion | LAI-LAMBDA-013 | Pillow or libvips wheels may fit the zip; decided with the card |
