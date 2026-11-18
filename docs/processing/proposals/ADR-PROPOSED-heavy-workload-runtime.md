# Proposed decision: heavy processing that does not fit Lambda runs on AWS Batch with Fargate, behind the same job kind and result queue

**Status: Proposed, not accepted; no ADR number assigned.** Written 2026-11-17 by Workstream D
for LAI-LAMBDA-010 (GLB optimization). It is a contingency proposal: nothing measured so far
needs it. It is not in `docs/DECISIONS.md` and must not be cited as a decision. If accepted it
receives the next free number through the registry check (`scripts/check-adrs.ts`). It does not
approve any native tool, container registry or deployment.

Evidence: `docs/processing/feasibility/LAI-LAMBDA-010-glb-optimization.md` (section 6.2 and 7.1).
Builds on ADR-055, ADR-061 (runtime-independent processing), ADR-064 (one canonical path; a
container worker needs its own ADR; no ECS, Fargate or ECR in dev). Coordinates with the
derived-artifact design (`ADR-PROPOSED-derived-artifacts.md`, written concurrently), which owns
where outputs are stored.

## Context

- The Lambda worker is the canonical runtime (ADR-064). Lambda limits (AWS quotas page, read
  2026-11-17): 900 s timeout, 10,240 MB memory, 10,240 MB `/tmp`, 250 MB unzipped zip, 10 GB
  container image, no GPU.
- Measured on the repository corpus (feasibility 6.2): the slowest optimization job was 6.7 s
  and 246 MiB (UASTC on one 2048x2048 texture, on a workstation). The corpus is six GLBs and 116
  small `.gltf` files. **Nothing measured needs more than Lambda offers.**
- Foreseeable work that could: conversion of large FBX files, Blender-based baking or retargeting
  (Blender is a large install, GPU optional), big texture sets (UASTC at high effort over many
  images), and any batch that must run as one unit for more than 15 minutes.

## Proposed decision

1. **Trigger, not a default.** A job kind moves to the heavy runtime only when a measured run on
   the Lambda function exceeds 70% of a Lambda limit (time, memory or `/tmp`) or the tool cannot
   be packaged inside the container-image limit. Until then it stays on Lambda.
2. **Runtime.** AWS Batch on Fargate (single compute environment, one job queue, one job
   definition per tool image). Batch gives queueing, retries, per-job vCPU and memory choice and
   timeouts without a long-lived cluster. Fargate task limits and prices must be verified at
   decision time (the author's expectation: up to 16 vCPU, 120 GiB memory, 200 GiB ephemeral
   storage per task; not verified here).
3. **Same contract.** The `apps.jobs` kind, outbox, result schema and `jobs_consume_results`
   consumer are unchanged. A small dispatcher (Lambda on the existing media queue) calls
   `SubmitJob`; the task reads its input by the same bucket and key and writes its result
   message to the same results queue. No second job model, queue family, bucket or consumer
   (ADR-064 decision 1). No database access from the task.
4. **Packaging.** One container image per tool family in a private ECR repository: needs its own
   owner approval (ADR-064 decision 9); built in GitHub Actions with OIDC, pinned base image,
   source commit and binary SHA-256 recorded; scanned.
5. **Outputs and safety.** Same rules as the Lambda path: new unpublished versions by the
   derived-artifact design, argv lists without a shell, no network egress except the AWS
   endpoints the task needs, staff content only (never child photos, audio or text, ADR-042).
6. **Cost control.** Maximum vCPU of the compute environment capped; job timeout set per
   definition; an alarm on queue depth and on any task over its expected duration.

## Alternatives considered

| Alternative | Verdict |
|---|---|
| Stay on Lambda with a 10 GB container image | Fixes packaging only; the 900 s limit remains. Right choice while jobs fit |
| ECS `RunTask` on Fargate, no Batch | Fewer services, but queueing, retries and concurrency limits must be written by hand. Acceptable if jobs are rare |
| Step Functions splitting a job into Lambda steps | Works for batches of independent files (a texture set), not for a single long conversion. Combine with Lambda when the batch is separable |
| AWS Batch on EC2 (Spot or On-Demand) | Needed only for a GPU or more than Fargate's limits; adds instance management; revisit with a measured need |
| Run on the Django EC2 instance | Forbidden: ADR-061 and card 012 keep heavy work off the small instance |
| A third-party conversion service | Sends staff assets to a third party; out of scope without a privacy review |

## Consequences

- Adds a Batch compute environment, queue, job definition, task role, dispatcher, ECR repository
  and alarms: an operational surface that is justified only by a measured need.
- Cold start for a Fargate task is tens of seconds (unmeasured here), so it is wrong for small
  jobs; the trigger in decision 1 keeps small jobs on Lambda.
- Cost, as expected by the author and **to verify at decision time**: Fargate is billed per
  vCPU-hour and per GB-hour while the task runs; a 4 vCPU, 16 GB task running 30 minutes is a
  few cents at us-east-1 on-demand list prices (about 0.04 USD per vCPU-hour and 0.0044 USD per
  GB-hour; not verified for us-west-1). The cost drivers are the registry, the build pipeline and
  idle-free design, not compute.

## Approvals needed

| # | Item |
|---|---|
| H1 | Accept the trigger rule (stay on Lambda until a measured run passes 70% of a limit) |
| H2 | AWS Batch on Fargate as the single overflow runtime, or ECS RunTask for rare jobs |
| H3 | A private ECR repository and image pipeline for this workload (ADR-064 decision 9) |
| H4 | Every deployment of the above (explicit approval each time) |
