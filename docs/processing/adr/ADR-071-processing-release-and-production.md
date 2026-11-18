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
   (`infra/lib/productionProcessing.ts`), present only when the committed
   `infra/config/prod-processing.json` says `"prodProcessing": true` (review F3: a shell flag could
   be forgotten on a routine `provision.sh prod` run and the change set would delete the estate).
   With it off the production templates are byte-identical to before. No separate
   processing stack, no ECR, no container, no Lambda VPC or database access.
3. **Environment isolation in the shared account**: `lai-prod-*` names, roles and parameters
   (`/lai/prod/`), `processing/artifacts/prod/`, the prod artifacts bucket
   `lai-prod-artifacts-<account>-<region>`, and the cost allocation tag
   `CostScope=lai-prod-processing` (plus `Project`, `Environment`, `Component=processing`).
4. **Scoped IAM**, asserted by CDK tests: asset-touching workers (media, audio, image, optimize)
   read (`GetObject`, `GetObjectVersion`: reads are by version id) `assets/*` and
   `processing/artifacts/<env>/*` (every artifact writer reads its write prefix for the 412
   verification), list the bucket only with an `s3:prefix` naming those prefixes (plain
   `StringLike`, review F10; see O15), create artifacts only with `PutObject` on
   `processing/artifacts/<env>/*` under the `s3:if-none-match` condition, and are explicitly denied
   every action on `processing/artifacts/<env>/capture/*` (staff captures). Large results under
   `jobs/results/` are written create-only as well. No worker can delete. Django alone deletes
   artifacts (retention) through `lai-django-processing-artifacts-<env>`. DLQ redrive is a separate
   role trusted by account principals with MFA (the owner limits who may assume it). The GitHub
   worker release role trusts the `django-prod` environment; it can upload and read release
   artifacts (uploads create-only), update and read the prod workers' code, and read the stack's
   outputs. It shares the environment subject with `lai-github-deploy-prod` (O16).
5. **Release pipeline**: `.github/workflows/release-prod-workers.yml`, `workflow_dispatch` only,
   every job gated by the repository variable `LAI_PROD_PROCESSING_DEPLOY_ENABLED == 'true'`, a
   typed confirmation, the existing `django-prod` environment (required reviewers), a
   deterministic manifest with SHA-256, kinds, processor versions and executable pins per
   artifact, an upload-only first release, absent (disabled) functions skipped, and a rollback job
   by manifest that requires the typed statement that every processing control is off.
6. **Rollback** (`../PROCESSING_RELEASE.md` section 6): feature controls off first, previous
   worker artifact by manifest, previous compatible Django release, never reverse a migration that
   destroys new data.

## Consequences

- Turning production processing on is a sequence of owner approvals, each recorded; nothing is
  deployed by the repository.
- The first production provisioning creates about 100 resources in `LaiDjangoEc2-prod`; the change
  set must show no replacement of the instance, database or load balancer (`provision.sh prod`).
- The production template is larger than 51,200 bytes (it already was). `provision.sh` now sends
  any template over that size through a bucket (`--s3-bucket`, default
  `lai-<env>-artifacts-<account>-<region>`, or `LAI_CFN_TEMPLATE_BUCKET` for the first run).

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
| O15 | Missing input reported as 403 instead of 404 (review F10) | The worker `ListBucket` grant now requires an `s3:prefix` naming `assets/` or `processing/artifacts/<env>/`, so a bucket-wide listing is impossible. A HEAD or GET carries no `s3:prefix`, so S3 answers 403 for a missing key and the worker reports `permission_denied` instead of `input_missing`. This reverses the 2026-11-17 owner decision (404 via `StringLikeIfExists`); the owner confirms or chooses the old trade-off |
| O16 | GitHub OIDC subject shared by two prod roles | `lai-github-deploy-prod` and `lai-github-workers-prod` both trust `repo:<owner>/<repo>:environment:django-prod`, so any job in that environment (either workflow) can assume either role. **Recommendation:** customise the repository's OIDC subject claim to include `job_workflow_ref` (GitHub `PUT /repos/{owner}/{repo}/actions/oidc/customization/sub`, owner action) and pin each role to its own workflow file; until then the two workflows' job conditions and required reviewers are the only separation |
| O17 | Redrive role trust (P9) | Account root with MFA: any account principal allowed `sts:AssumeRole` on it. Narrow to named role or user ARNs once the owner names the operators |

## Review findings addressed (2026-11-18)

| Finding | Resolution |
|---|---|
| F1 | `s3:GetObjectVersion` with every `GetObject` on `assets/*` and `processing/artifacts/<env>/*` (workers and Django) |
| F2 | `publish-workers.sh` skips functions that do not exist (notice) and updates the rest; `--upload-only` / workflow input `upload_only` for the first release |
| F3 | Production processing settings live in the committed `infra/config/prod-processing.json`; a disagreeing context or environment value fails synthesis |
| F4 | Manifest records `kind_versions`; `check-enable` and `rollback-plan` compare them (Meshopt/KTX2 need validator 1.2.0; a report's `required_processor_versions` is honoured); the rollback job requires the typed "all processing controls are off" and runs `rollback-plan --controls-off` |
| F5 | Per-kind ordering in `PROCESSING_RELEASE.md` section 2 and the workflow header; test that the 1.2.0 validator accepts requests without the options |
| F6 | Image worker reads its write prefix; CDK test and a synth-time rule enforce writer implies reader |
| F7 | `provision.sh` sends templates over 51,200 bytes through a bucket; tested offline |
| F8, F13 | Overstated wording fixed: the AI worker's foundation-model grant is any Region (cross-Region profile), the redrive trust is any MFA account principal allowed to assume it (O17), the release role also reads artifacts and stack outputs |
| F9 | Deterministic manifest (`created_at` = commit time, sorted keys, `--previous` from the dispatch input); an identical existing manifest or artifact is accepted |
| F10 | `ListBucket` with plain `StringLike` on `s3:prefix` (O15) |
| F11 | `jobs/results/*` writes are create-only; `store_result` sends `If-None-Match: *` and a concurrent delivery sends the result stored first |
| F12 | `LAI_FFMPEG_SHA256`, `LAI_GLTFPACK_SHA256`, `LAI_TOKTX_SHA256` are stack parameters filled from the manifest (`stack-parameters`, from the layer's build record). Shared libraries under `/opt/lib` are covered by the layer zip's SHA-256 in the manifest, not by the executable pin |
| F14 | Django and the proxy start and pass health first; the consumer and sweep start in a separate, non-fatal step |
| sec-6 | Explicit Deny for worker roles on `processing/artifacts/<env>/capture/*` |
