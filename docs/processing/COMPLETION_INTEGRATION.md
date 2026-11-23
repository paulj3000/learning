# Lambda processing completion: integration conventions (frozen interfaces)

Status: integration contract for the owner-approved completion work of 2026-11-18. Branch
`feature/serverless-processing-completion` (provisional base: Wave 4 `486d2acc`, because PR #42
and PR #43 could not be merged from the development session; it is reconciled with `main` after
they merge). Every workstream branch starts from this commit and follows the rules below. The
principal integrator owns every item marked "principal".

Nothing here deploys. No live AWS call is made by any test, demo or build.

## 1. Owner approvals in force (2026-11-18)

WAVE4, ARTIFACTS (Option C, existing asset bucket, `processing/artifacts/`, no automatic
publication), WRITES (narrow create-only worker writes), RETENTION (90 days unreviewed, 30 days
superseded, protect promoted and referenced), AUDIO (LGPL FFmpeg, Opus primary, MP3 alternative),
IMAGE (separate Pillow function), PRIVACY (strip sensitive metadata from new public-facing
derivatives, keep originals, no silent historical rewrite), THUMBNAILS (staff browser capture
only; server-side rendering deferred), OPTIMIZATION (Meshopt first, then KTX2), VALIDATION (reject
unsupported compression extensions), DEFECTS (IAM, terminal retention, import guards,
latest-validation gate), RELEASE (compatibility-gated sequence), PRODUCTION (infrastructure code
only, no deployment). No live AWS deployment is authorized.

## 2. ADR numbers (principal)

Highest number on `main` and every open branch: ADR-065 (`feature/storykeeper-castle-completion`).
Reserved for this work; each body lives in `docs/processing/adr/`, and the principal adds the
`docs/DECISIONS.md` rows at integration (workstreams do not edit `DECISIONS.md`):

| ADR | Subject | Owner |
|---|---|---|
| ADR-066 | Derived artifacts (Option C), create-only writes, retention | Workstream A |
| ADR-067 | Native audio transcoding with LGPL FFmpeg | Workstream C |
| ADR-068 | Separate Pillow image function and image privacy | Workstream D |
| ADR-069 | Staff browser GLB thumbnail capture | Workstream E |
| ADR-070 | GLB optimization: Meshopt then KTX2, compression support policy | Workstream F |
| ADR-071 | Compatibility-gated processing release and production processing infrastructure | Workstream G |

Each is "Accepted" only for what the owner approved on 2026-11-18; anything beyond is listed as
an open decision inside the ADR, never accepted on the owner's behalf.

## 3. Job kinds, queues and feature controls (Workstream A registers all of them)

| Kind | Queue (`JobQueue`) | Queue URL setting | Runtime | Feature control (default) |
|---|---|---|---|---|
| `asset.transcode_audio` | `audio` | `LAI_JOBS_AUDIO_QUEUE_URL` | Zip Lambda + LGPL FFmpeg layer | `LAI_AUDIO_TRANSCODING` (`off`) |
| `asset.convert_image` (convert, resize, thumbnail profiles) | `image` | `LAI_JOBS_IMAGE_QUEUE_URL` | Zip Lambda with Pillow | `LAI_IMAGE_CONVERSION` (`off`) |
| `asset.optimize` (already reserved) | `optimize` | `LAI_JOBS_OPTIMIZE_QUEUE_URL` | Decided by ADR-070 measurements | `LAI_GLB_MESHOPT`, `LAI_GLB_KTX2` (`off`) |
| none (staff upload) | none | none | Browser | `LAI_THUMBNAIL_CAPTURE` (`off`) |

Rules: a kind may be submitted only when its control is `on` and its queue URL is configured;
otherwise submission is refused with a safe message and nothing is queued (the RELEASE invariant:
no message is emitted before producers and consumers both support it). `LAI_ASSET_ASYNC_VALIDATION`
keeps controlling GLB validation only. Results of every kind return on the one existing results
queue to the one `jobs_consume_results`.

## 4. Derived artifact roles (Workstream A declares; workloads use)

From `DERIVED_ARTIFACTS_INTEGRATION.md` section 2, plus the staff capture role:

| Role | Producer | Content types | Promotable |
|---|---|---|---|
| `audio.transcoded` | `asset.transcode_audio` | `audio/ogg`, `audio/mpeg` | Yes |
| `audio.report` | `asset.transcode_audio` | `application/json` | No |
| `image.converted`, `image.resized` | `asset.convert_image` | `image/webp`, `image/png`, `image/jpeg` | Yes |
| `image.thumbnail` | `asset.convert_image` | `image/webp`, `image/png`, `image/jpeg` | No |
| `model.thumbnail` | staff browser capture (no job) | `image/webp`, `image/png` | No |
| `model.optimized` | `asset.optimize` | `model/gltf-binary` | Yes, publication gated by ADR-070 |
| `texture.compressed` | `asset.optimize` | `image/ktx2` | Yes, gated by ADR-070 |
| `model.optimize_report` | `asset.optimize` | `application/json` | No |

Keys: `processing/artifacts/<env>/<job id>/<attempt id>/<logical id>.<ext>` for job outputs and
`processing/artifacts/<env>/capture/<artifact id>.<ext>` for staff captures. Only trusted
identifiers appear in keys.

## 5. Package and file ownership

| Path | Owner |
|---|---|
| `lai/apps/assets/models.py` (artifact model), `assets` migration `0003_*`, artifact services, admin, retention, `asset_storage_audit` | A |
| `lai/apps/jobs/models.py` kinds and queues, `jobs` migration `0005_*`, dispatch routing, results consumer artifact recording, settings for section 3 | A |
| `processing/lai_processing/contracts/*` (roles in `JobTypeSpec`, new content types) | A |
| `lambda/jobs_worker/*` artifact storage port (create-only put) | A |
| Publication gate (`assets/services.py` gate functions), GLB extension policy in both validators, failed-job retention, `lambda/build.py` and repository import guards | B (jobs migration `0006_*` only if unavoidable, depending on `0004`; principal rewires) |
| `processing/lai_native/runtime/` (native tool adapter), `processing/lai_native/audio/`, `lambda/audio_worker/`, FFmpeg build under `native/ffmpeg/` | C |
| `processing/lai_native/image/`, `lambda/image_worker/`, Pillow build under `native/pillow/` | D |
| Thumbnail capture admin view, template and static JS | E |
| `processing/lai_native/optimize/`, `lambda/optimize_worker/`, `react/src` loader decoders, gltfpack and KTX tooling under `native/gltf/` | F (validator support for Meshopt and KTX2 lands after B, through the principal) |
| `infra/**` (all CDK: dev native workers and queues, artifact create-only write statement, read narrowing, production processing) and `.github/workflows/**` | G |
| `docs/DECISIONS.md`, `README.md`, `docs/IMPLEMENTATION_STATUS.md`, `tasks/TASK_TRACKER.md`, root processing docs | principal |

`processing/lai_processing` stays standard-library only (no subprocess, ctypes or native
imports). Native execution lives only in `processing/lai_native`, with its own import allowlist.
Native binaries, wheels and layers are build outputs (`/build/`, gitignored) and are never
committed.

## 6. Tests

Unit tests only during development, on an isolated PostgreSQL database per workstream:

```
POSTGRES_PORT=5432 POSTGRES_DB=lai_test_<workstream> \
  /Coding/learning-worktrees/storybook/.venv/bin/python -m pytest -q <paths>
```

No browser automation and no Playwright. Do not install packages into the shared storybook
virtualenv; native workstreams use their own virtualenv under the scratch or `/build/` directory.
