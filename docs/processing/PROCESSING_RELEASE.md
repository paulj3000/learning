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
| 1 IAM and infrastructure | Queues, DLQs, roles, alarms, buckets, the derived-artifact policy; workers still disabled (`Enable*=false`) | A reviewed commit sets `"prodProcessing": true` in `infra/config/prod-processing.json`; `npm run infra:synth:prod`; `scripts/aws/provision.sh prod` (change set, review: no EC2/RDS/ALB replacement; first run names a template bucket with `LAI_CFN_TEMPLATE_BUCKET`); `--execute` | Change set reviewed; alarms in `OK` or `INSUFFICIENT_DATA` |
| 2 Submissions disabled | Every feature control `off`; `LAI_JOBS_BACKEND` as before | SSM `/lai/prod/django/*`: no `LAI_AUDIO_TRANSCODING`, `LAI_IMAGE_CONVERSION`, `LAI_GLB_*`, `LAI_THUMBNAIL_CAPTURE` set to `on` | Django report `controls` all `off` |
| 3 Django migrations and consumer support | Release the Django commit that knows every new kind and artifact role (migrations `assets/0003_*`, `jobs/0005_*`, any `0006_*`), with the `jobs` compose profile when the backend is `sqs` | `deploy-django-ec2.yml` dispatch, `django-prod` approval; pre-migration snapshot | Report `pending_migrations` empty; `result_kinds` lists the new kinds |
| 4 Worker packages | First release of a worker: `release-prod-workers.yml` with `upload_only` (artifacts and manifest stored, no function touched), then a change set with `Enable*=true` and the `stack-parameters` printed by the job (code keys, `AudioLayerKey`, SHA-256 pins). Later releases: the workflow updates every existing function and skips disabled ones | `release-prod-workers.yml` (`action=release`, typed confirmation, `previous_manifest`, `django-prod` approval) | Manifest stored at `releases/processing/<sha>.json`; deployed `CodeSha256` equals the manifest |
| 5 Verification checks | Read-only checks (LAI-LAMBDA-012 B-7), then the pre-enable check per control | `processing_release.py check-enable --manifest <m> --django-report <r> --control <NAME> --env prod` | Exit 0 for the control to be enabled |
| 6 Enable | Set the one control to `on`, redeploy the running commit | SSM parameter, `deploy-django-ec2.yml` | Owner approval |
| 7 Acceptance | One synthetic job per kind, artifact recorded, nothing published automatically; monitor one week | LAI-LAMBDA-012 B-8 to B-10 | Owner sign-off |

Django and workers come from the **same commit** (the check refuses otherwise). Approve phases 3
and 4 in one sitting.

**Ordering is per kind** (review F5), always with the kind's control off until phase 6:

| Kind or option | Ships first | Why |
|---|---|---|
| New native kinds (`asset.transcode_audio`, `asset.convert_image`, `asset.optimize`) | Django (3), then the worker (4) | Django must apply results before a worker can produce them; nothing is submitted while the control is off |
| GLB validator 1.2.0 options (`allow_meshopt`, `allow_ktx2`) | Either; the **1.2.0 media worker must ship before `LAI_GLB_MESHOPT` or `LAI_GLB_KTX2` is switched on** | Django omits the options while both controls are off, so an older media worker accepts every request (its verdicts become `processor_outdated` until it updates; nothing is lost). A newer worker accepts older requests without the options (`tests/processing/test_processing_glb_processor.py`). An older worker refuses unknown options, so `check-enable` refuses those controls until the manifest's `asset.validate_model` version is at least 1.2.0 |

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
- `kind_versions`: the processor (contract) version of every supported kind, read from the
  sources by `processing_release.py versions` (`build-workers.sh` writes `versions.json`).
  `check-enable` compares them with the per-control minimums (`CONTROL_MIN_VERSIONS`) and any
  `required_processor_versions` in the Django report; `rollback-plan` refuses a target that would
  route an enabled control to an older processor, and notes every version that goes back.
- `pins`: executable SHA-256 pins (`LAI_FFMPEG_SHA256` from the layer's
  `share/lai-ffmpeg/build-record.json`; `LAI_GLTFPACK_SHA256`, `LAI_TOKTX_SHA256` from an optimize
  build record). They reach the functions as stack parameters
  (`processing_release.py stack-parameters <manifest>`). Shared libraries under `/opt/lib` are
  covered by the layer zip's SHA-256, not by a pin.
- Deterministic (review F9): `created_at` is the commit time, keys are sorted, `previous` comes
  from the dispatch input; a re-dispatch of the same commit writes the same bytes and the upload
  accepts the identical object.
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

As implemented (`lai/apps/jobs/release_check.py`), the report also carries
`artifact_storage_configured`, `manifest_configured`, `manifest_kinds` and `failures`. It exits 1,
with safe reasons on stderr, only when a control that is `on` fails a check (no result handler,
kind not submittable, queue URL missing, kind absent from the configured release manifest,
pending migrations, artifact storage not configured, jobs backend not `sqs`); with every control
off it always exits 0. Pass `--exit-zero` when the caller (for example `processing_release.py
check-enable`) wants the JSON regardless and decides itself. It never prints URLs, ids or secrets
(booleans and names only) and runs in the release container
(`docker compose run --rm --no-deps -T django python manage.py processing_release_check --json --exit-zero`).

Runtime invariant: when `LAI_PROCESSING_RELEASE_MANIFEST` (path to the manifest from
`processing_release.py manifest create`) is set, Django refuses to submit any workload kind that
no released worker artifact lists in `supported_kinds` (`workload_not_released`; nothing is
recorded or queued). An unreadable or invalid manifest, or a `git_sha` that differs from
`LAI_RELEASE_SHA`, refuses every workload (fails closed). Unset keeps local development unchanged.

Kind-specific ordering: GLB validator 1.2.0 (ADR-070) adds the `allow_meshopt` and `allow_ktx2`
request options. Django sends each one only while its control is on, so with `LAI_GLB_MESHOPT`
and `LAI_GLB_KTX2` off a request stays acceptable to a media worker released before 1.2.0. Its
verdicts are then recorded as `processor_outdated` (the gate wants the current processor), which
blocks publishing but loses nothing; release the 1.2.0 media worker (phase 4) before switching
either control on (phase 6).
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
   submitted for the kind; in-flight messages finish or go to the DLQ. The rollback job refuses to
   start without the typed statement `all processing controls are off`; with a Django report at
   hand, `rollback-plan --django-report` checks it instead of trusting the statement.
2. **Previous worker artifact by manifest**: `processing_release.py rollback-plan --current <m>
   --target <earlier m> --django-report <r>` refuses while a control that is `on` routes a kind to
   a function the target does not accept, or to a processor older than that control needs (queue
   and contract compatibility), and lists every processor version that goes back. Then
   `release-prod-workers.yml` `action=rollback`, `rollback_manifest=releases/processing/<sha>.json`,
   `controls_off=all processing controls are off`; the job runs `rollback-plan --controls-off`,
   verifies every artifact's SHA-256 and updates the existing functions (absent ones are skipped).
   The executable pins of the target come back through its `stack-parameters` (change set). A layer rollback is the `AudioLayerKey` parameter (layer
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
