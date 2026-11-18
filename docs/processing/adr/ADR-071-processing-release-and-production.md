# ADR-071: Compatibility-gated processing release and production processing infrastructure

**Status: Accepted (owner, 2026-11-18) for exactly two things: the compatibility-gated release
sequence (approval RELEASE) and the development of production processing infrastructure as code
(approval PRODUCTION: code, not deployment).** Everything else below is listed under "Open
decisions" and is not accepted by this record. The principal adds the `docs/DECISIONS.md` row at
integration (`docs/processing/COMPLETION_INTEGRATION.md` section 2).

Builds on ADR-037 (production Django on EC2), ADR-055, ADR-061, ADR-062, ADR-064 (one canonical
processing path), ADR-066 (derived artifacts, Option C, create-only writes, retention), ADR-067
(audio), ADR-068 (image), ADR-070 (optimization). Implementation: workstream G, branch
`feature/lambda-production-infrastructure`.

## Context

LAI-LAMBDA-012 (`../LAI-LAMBDA-012-production-rollout.md`) found production has no processing
infrastructure in CDK (D1 to D18) and asked for decisions P1 to P15. The completion work adds three
native workloads (audio, image, optimize) with their own queues and functions and derived artifacts
under `processing/artifacts/<env>/` in the existing asset bucket. Producers (Django) and consumers
(workers, `jobs_consume_results`) are released separately, so a release can emit a message one side
does not understand. The AWS account is shared by dev, prod and other projects.

## Decision (accepted)

1. **Compatibility-gated release.** A processing release goes through seven phases in order
   (`../PROCESSING_RELEASE.md`): (1) IAM and infrastructure, (2) submissions disabled, (3) Django
   migrations and consumer support, (4) worker packages, (5) verification checks, (6) enable,
   (7) acceptance. **Invariant: no incompatible message is emitted during the transition**: a kind
   is submitted only when its feature control is `on`, its queue URL is configured, Django can
   apply its results and the deployed worker accepts it. The check is
   `scripts/release/processing_release.py check-enable` over the release manifest and a Django
   report (`manage.py processing_release_check`, specified in `../PROCESSING_RELEASE.md` section 4).
2. **Production processing infrastructure as code** (P1-a): a construct of `LaiDjangoEc2-prod`
   (`infra/lib/productionProcessing.ts`), present only with the synth flag `prodProcessing=true`.
   With the flag off the production templates are byte-identical to before. No separate
   processing stack, no ECR, no container, no Lambda VPC or database access.
3. **Environment isolation in the shared account**: `lai-prod-*` names, roles and parameters
   (`/lai/prod/`), `processing/artifacts/prod/`, the prod artifacts bucket
   `lai-prod-artifacts-<account>-<region>`, and the cost allocation tag
   `CostScope=lai-prod-processing` (plus `Project`, `Environment`, `Component=processing`).
4. **Scoped IAM**, asserted by CDK tests: workers read inputs under `assets/*` (media, audio and
   optimize also `processing/artifacts/<env>/*`; image `assets/*` only), list the bucket only for
   those prefixes (`StringLikeIfExists`, so a missing key is 404), and create artifacts only with
   `PutObject` on `processing/artifacts/<env>/*` under the `s3:if-none-match` condition. No worker
   can delete. Django alone deletes there (retention) through `lai-django-processing-artifacts-<env>`.
   DLQ redrive is a separate MFA role; the GitHub worker release role trusts only `django-prod` and
   can upload create-only and update function code, nothing else.
5. **Release pipeline**: `.github/workflows/release-prod-workers.yml`, `workflow_dispatch` only,
   every job gated by the repository variable `LAI_PROD_PROCESSING_DEPLOY_ENABLED == 'true'`, a
   typed confirmation, the existing `django-prod` environment (required reviewers), an immutable
   manifest with SHA-256 per artifact, and a rollback job by manifest.
6. **Rollback** (`../PROCESSING_RELEASE.md` section 6): feature controls off first, previous
   worker artifact by manifest, previous compatible Django release, never reverse a migration that
   destroys new data.

## Consequences

- Turning production processing on is a sequence of owner approvals, each recorded; nothing is
  deployed by the repository.
- The first production provisioning creates about 100 resources in `LaiDjangoEc2-prod`; the change
  set must show no replacement of the instance, database or load balancer (`provision.sh prod`).
- The production template is larger than 51,200 bytes (it already was), so it is deployed from S3
  or with `aws cloudformation deploy`, as today.

## Open decisions (not accepted by this ADR)

| # | Decision | Default in code |
|---|---|---|
| O1 | Any production deployment or provisioning (P13) | Nothing deployed; `prodProcessing` off |
| O2 | Production processing budget amount (P15) | Required input `processingBudgetUsd`, **no default**: no budget resource without it |
| O3 | Activating the `CostScope` and `Environment` cost allocation tags in Billing | Not done (owner, console) |
| O4 | Lambda Insights (paid extension) | Not used: max memory from a log metric filter on the REPORT line |
| O5 | Concurrency per workload (P5) | ai 5, media 5, audio 2, image 2, optimize 2; reserved equal to the mapping maximum (`ReserveWorkerConcurrency=true`) |
| O6 | Optimize worker runtime and sizing (ADR-070) | Behind `optimizeWorker` flag, off; 3008 MB, 900 s, 4096 MB `/tmp` placeholders |
| O7 | Audio and image sizing (spikes pending) | audio 1024 MB / 300 s / 512 MB `/tmp` (Workstream C start); image 1024 MB / 120 s (Workstream D proposal); memory, timeout and `/tmp` configurable via `processingSizing` |
| O8 | Who may redrive DLQs (P9) | `lai-prod-jobs-dlq-redrive`, account principals with MFA; the owner names the people |
| O9 | Log retention for worker groups (P10) | 90 days (`ProcessingLogRetentionDays`) |
| O10 | Prod results and artifacts bucket lifecycle (P2) | `jobs/results/` 30 days, `tmp/` 1 day, worker zips and manifests never expire |
| O11 | `LAI_ENVIRONMENT=prod` (P7) | Operator-set; the pre-enable check refuses another namespace |
| O12 | Live verification that IAM enforces `s3:if-none-match` on the asset bucket (D8) | Statement written; must be proven live before enablement |
| O13 | Whether prod media worker handles speech | Not granted (prod has no speech bucket) |
| O14 | Studio `jobs` mode in production (P12), Multi-AZ RDS (P11) | Unchanged |
