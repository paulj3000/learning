# Processing release: compatibility-gated sequence, manifest, pre-enable check, rollback

ADR-071 (`adr/ADR-071-processing-release-and-production.md`). Owner approval RELEASE, 2026-11-18.
Every AWS, GitHub and database step here is owner-run; the repository only defines and tests it.
Production infrastructure is in `PRODUCTION_PROCESSING.md`.

## 1. Invariant

**No incompatible message is emitted during a transition.** Django submits a kind only when (a)
its feature control is `on`, (b) its queue URL is configured, (c) Django can apply its results and
(d) the deployed worker of that queue accepts the kind. (a) and (b) are enforced by Django
(`COMPLETION_INTEGRATION.md` section 3); the stacks write a native queue URL only when its worker
exists; (c) and (d) are proven by the pre-enable check before (a) is ever switched on.

Results of every kind return on the one results queue to the one `jobs_consume_results`. A results
message is only ever produced by a worker for a job Django submitted, so (c) before (a) keeps
the results queue compatible too.

## 2. Phases (in order; each is an owner approval)

| Phase | What | Command or evidence | Gate to continue |
|---|---|---|---|
| 1 IAM and infrastructure | Queues, DLQs, roles, alarms, buckets, the derived-artifact policy; workers still disabled (`Enable*=false`) | `LAI_ENV=prod LAI_PROD_PROCESSING=true npm run infra:synth:prod`; `scripts/aws/provision.sh prod` (change set, review: no EC2/RDS/ALB replacement); `--execute` | Change set reviewed; alarms in `OK` or `INSUFFICIENT_DATA` |
| 2 Submissions disabled | Every feature control `off`; `LAI_JOBS_BACKEND` as before | SSM `/lai/prod/django/*`: no `LAI_AUDIO_TRANSCODING`, `LAI_IMAGE_CONVERSION`, `LAI_GLB_*`, `LAI_THUMBNAIL_CAPTURE` set to `on` | Django report `controls` all `off` |
| 3 Django migrations and consumer support | Release the Django commit that knows every new kind and artifact role (migrations `assets/0003_*`, `jobs/0005_*`, any `0006_*`), with the `jobs` compose profile when the backend is `sqs` | `deploy-django-ec2.yml` dispatch, `django-prod` approval; pre-migration snapshot | Report `pending_migrations` empty; `result_kinds` lists the new kinds |
| 4 Worker packages | Build, manifest, upload create-only, update function code; for a new worker first set `Enable*=true` and its code key through a change set | `release-prod-workers.yml` (`action=release`, typed confirmation, `django-prod` approval) | Manifest stored at `releases/processing/<sha>.json`; deployed `CodeSha256` equals the manifest |
| 5 Verification checks | Read-only checks (LAI-LAMBDA-012 B-7), then the pre-enable check per control | `processing_release.py check-enable --manifest <m> --django-report <r> --control <NAME> --env prod` | Exit 0 for the control to be enabled |
| 6 Enable | Set the one control to `on`, redeploy the running commit | SSM parameter, `deploy-django-ec2.yml` | Owner approval |
| 7 Acceptance | One synthetic job per kind, artifact recorded, nothing published automatically; monitor one week | LAI-LAMBDA-012 B-8 to B-10 | Owner sign-off |

Django and workers come from the **same commit** (the check refuses otherwise). Approve phases 3
and 4 in one sitting.

## 3. Release manifest

Schema: `scripts/release/processing-release-manifest.schema.json` (schema version 1). Written by
`scripts/release/processing_release.py manifest create` from `scripts/release/build-workers.sh`
output; stored create-only at `releases/processing/<git_sha>.json` in the environment's artifacts
bucket, never expired.

- One entry per artifact: `jobs-worker`, `audio-worker`, `ffmpeg-layer`, `image-worker`,
  `optimize-worker`; its content-addressed key (`lambda/<name>-<sha16>.zip`, layers under
  `lambda/layers/`), SHA-256, size, functions and accepted kinds.
- `previous_manifest_key` links releases for rollback.
- An audio worker without the FFmpeg layer in the same manifest is refused.
- Builders (`build-workers.sh` contract): `python3 -I <builder> --out <dir>/<name>` writes one zip:
  `native/pillow/build.py` (D), `native/gltf/build.py` (F, only with the optimize flag). The audio
  worker is `lambda/audio_worker/build.py --out <dir> --layer <zip>` (C), built only with the arm64
  FFmpeg layer that the workflow's `ffmpeg-layer-arm64` job builds natively on `ubuntu-24.04-arm`
  in Amazon Linux 2023 and tests with `tests/processing_native/test_audio_ffmpeg_integration.py`
  (no AWS access, nothing published). A missing builder means the artifact is not in the release,
  and the check refuses its control.

## 4. Pre-enable check

`processing_release.py check-enable` refuses a control unless: Django and the manifest have the
same `git_sha`; no migration is pending; the backend is `sqs`; for every kind the control gates,
Django can apply its results and register it for submission, and the function of its queue in the
manifest accepts it; the queue URL setting is configured; Django's namespace is the environment
(`LAI_ENVIRONMENT=prod`, P7). `LAI_THUMBNAIL_CAPTURE` has no job and needs only the first two.

**Django side (spec; implementation belongs to Workstream A / the principal):**
`python manage.py processing_release_check --json` prints, and changes nothing:

```json
{
  "schema_version": 1,
  "environment": "<settings namespace, apps.assets.processing.namespace()>",
  "git_sha": "<LAI_RELEASE_SHA>",
  "jobs_backend": "sqs | disabled",
  "result_kinds": ["<kinds with a registered result handler>"],
  "submittable_kinds": ["<kinds in KIND_QUEUE whose queue setting exists>"],
  "controls": {"LAI_AUDIO_TRANSCODING": "on | off", "...": "..."},
  "queue_urls_configured": {"LAI_JOBS_AUDIO_QUEUE_URL": true, "...": false},
  "pending_migrations": ["app.0005_name"]
}
```

It exits 0 even when something is off (the tool decides), never prints URLs, ids or secrets
(booleans only), and runs in the release container
(`docker compose run --rm --no-deps -T django python manage.py processing_release_check --json`).
Control-to-kind mapping: `CONTROLS` in `processing_release.py` (from COMPLETION_INTEGRATION
section 3); the tests pin it.

## 5. Pipeline gates

- `release-prod-workers.yml`: `workflow_dispatch` only; every job requires
  `vars.LAI_PROD_PROCESSING_DEPLOY_ENABLED == 'true'` (repository variable, unset by default) and
  the dispatch; `gate` also requires `main` and the typed confirmation `release lai-prod workers`
  or `rollback lai-prod workers`; AWS access only in `publish` and `rollback`, environment
  `django-prod` (existing required reviewers; no new GitHub environment, ADR-064 guard), role
  `vars.LAI_PROD_WORKER_RELEASE_ROLE_ARN` (stack output `WorkerReleaseRoleArn`).
- Artifacts are verified against the manifest before credentials are requested and again after
  download for a rollback; uploads are create-only; the deployed `CodeSha256` is checked.
- The FFmpeg layer is uploaded but never published by the workflow: the audio function's layer
  is the stack parameter `AudioLayerKey` (change set).
- Repository tests (`tests/repo/test_processing_release.py`): no push, schedule or pull-request
  workflow references the prod worker functions, role or scripts; the push path filters of
  `deploy-django-ec2.yml` and `deploy-dev-lambda.yml` are pinned (not widened); the release
  tooling lives outside every push path.
- Repository variables the owner sets when approving: `LAI_PROD_PROCESSING_DEPLOY_ENABLED`,
  `LAI_PROD_WORKER_RELEASE_ROLE_ARN`, `LAI_PROD_ARTIFACT_BUCKET`, optionally
  `LAI_PROD_OPTIMIZE_WORKER`. Close the gate again after the release.

## 6. Rollback

Order: first stop new work, then return code, never data.

1. **Feature controls off** (SSM, redeploy the running commit). From then on nothing new is
   submitted for the kind; in-flight messages finish or go to the DLQ.
2. **Previous worker artifact by manifest**: `processing_release.py rollback-plan --current <m>
   --target <earlier m> --django-report <r>` refuses while a control that is `on` routes a kind to
   a function the target does not accept (queue compatibility). Then `release-prod-workers.yml`
   `action=rollback`, `rollback_manifest=releases/processing/<sha>.json`; the job verifies every
   artifact's SHA-256 before updating. A layer rollback is the `AudioLayerKey` parameter (layer
   versions are retained on replacement).
3. **Previous compatible Django release**: `deploy-django-ec2.yml` `action=rollback`. Older Django
   must still apply any result already queued: drain the queues first or mark unfinished jobs of
   new kinds failed (LAI-LAMBDA-011 section 11.3).
4. **Result schema compatibility**: the results envelope stays schema 1; a new optional field is
   ignored by older consumers, a new required field needs a new schema version and both consumers
   deployed before any producer.
5. **Migrations**: never reverse a migration that drops or rewrites data created by the new
   release (artifact rows, job rows of new kinds). `deploy-django.sh` never reverses migrations;
   rolling back code past an additive migration is fine while the controls are off.
6. **Infrastructure** stays deployed with the workers disabled (`Enable*=false`); remove only by an
   approved change set after the queues are empty.
