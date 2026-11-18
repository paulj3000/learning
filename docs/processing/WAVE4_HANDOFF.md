# Wave 4 handoff (LAI-LAMBDA-008, 009, 010 and 013) on the canonical path

Rewritten 2026-11-17 for ADR-064 from the `feature/serverless-processing-wave3` version (kept on
that branch as history; it assumed the superseded `LaiProcessing-<env>` stack, an ECR worker image
and a separate runtime package). Cards: LAI-LAMBDA-008 (Sound Manager audio validation and
transcoding), LAI-LAMBDA-009 (NPC Manager animation inspection and mapping assistance),
LAI-LAMBDA-010 (texture compression and GLB optimization benchmarking) and LAI-LAMBDA-013 (asset
thumbnail generation and image conversion, split out of 010 on 2026-11-16).

## Status update (2026-11-17, late)

- Ogg upload checksum defect fixed on this branch (`04bd4df4`, see `AUDIO_INSPECTION.md`).
- 011 and 012 rewritten (three-tier dev acceptance, gate verification, production reconciliation).
- Design work for 008b, 010, 013a, 013b and derived artifacts is on separate stacked branches
  (section 7). None is merged here; none is approved.
- PR #42 still unmerged (owner action). No Wave 4 PR yet: owner to open it (section 7).

## Status (2026-11-17, integration branch `feature/serverless-processing-wave4`)

Integrated on `feature/serverless-processing-wave4`: the reviewed canonical PR #42 head plus every
Wave 4 workstream. Not merged, not deployed; no AWS resource was touched.

**Done (repository only):**

- **009** `asset.analyze_animation`: developer-complete (`NPC_ANIMATION_INSPECTION.md`).
- **008 phase 1** `asset.process_audio` header inspection: developer-complete
  (`AUDIO_INSPECTION.md`). Transcoding (phase 2, tracked as LAI-LAMBDA-008b) is not authorized.
- One jobs migration for both kinds: `jobs.0004_wave4_inspection_kinds`.
- **010** and **013**: feasibility studies only (`feasibility/`), proposed native-runtime decisions
  that are not accepted (`proposals/`), offline bench scripts (`scripts/processing/bench/`).
- **011** and **012**: documentation only (`LAI-LAMBDA-011-dev-acceptance.md`,
  `LAI-LAMBDA-012-production-rollout.md`); nothing executed.
- Integration fix after the canonical merge: the animation inspector now passes the GLB JSON
  element bound (`max_json_elements`) to `parse_document`.
- `scripts/processing/local-demo.sh` runs both kinds through the packaged worker zip with
  in-memory SQS and S3, plus invalid media, a duplicate result, a stale version, an unauthorized
  admin action and a transient S3 503 (retried, then applied).

**Remains:**

- Owner review and merge (W0), then the release with the consumer-first order (section 3).
- Live verification of both kinds: LAI-LAMBDA-011 section 5, owner-run, after a deployment the
  owner approves (W4-8).
- Owner decisions W4-1 to W4-8 (section 6) before any of 008 phase 2, 010 or 013 is implemented;
  no native tool, container image or artifact write exists or is authorized.
- Production: LAI-LAMBDA-012 decisions P1 to P13.

Read first: `CANONICAL_PATH.md`, `ASYNC_MODEL_VALIDATION.md`, `CONTRACTS.md`,
`GLB_VALIDATION.md`, `../infrastructure/dev-native-environment.md` section 9, and ADR-055,
ADR-061 and ADR-064 in `../DECISIONS.md`. The code wins over this page.

## 1. Where things stand

| Item | State |
|---|---|
| LAI-LAMBDA-001 to 007 | Re-landed on `feature/serverless-processing-canonical`: developer-complete, owner review pending, not merged, not deployed |
| Live AWS acceptance | LAI-LAMBDA-011, open; every deployment needs owner approval |
| Wave 4 | Integrated on `feature/serverless-processing-wave4` (see "Status" above): 009 and 008 phase 1 developer-complete; 008 phase 2 (transcoding) not authorized; 010 and 013 feasibility only; 011 and 012 documentation only. Nothing here is approved scope beyond that until its card's prerequisites and approvals (section 6) are met |

## 2. Rules from ADR-064

1. **Every workload is an `apps.jobs` kind.** One job model (`ProcessingJob`), the ADR-055 queues,
   the transactional outbox, `jobs_consume_results` as the only consumer. No second queue family,
   bucket, stack, consumer or job model.
2. **Zip first.** Pure-Python, standard-library work goes in `processing/lai_processing` and runs
   in the existing worker zip (`lambda/build.py`, size budget 2 MiB; about 351 KB today).
   `tests/processing/test_processing_runtime_independence.py` forbids `subprocess`, `ctypes`,
   `socket`, `importlib` and other modules anywhere in `lai_processing`, so native tools can never
   be called from it.
3. **Native tools need their own ADR.** FFmpeg, libvips, `toktx`, `gltfpack` or a renderer need a
   container image (or another runtime) only after an ADR for that workload approves it (ADR-064:
   containers only by a later decision; dev has no ECR). Pillow or libvips wheels might fit a zip
   for 013; that is decided with the card, by measurement.
4. **Results do not rewrite published versions.** The module-level `IMMUTABLE_FIELDS` in
   `lai/apps/assets/models.py` include `metadata`, `clips`, `dimensions` and `validation_report`
   once an `AssetVersion` is published or retired. A result about a published version stays on the job (`result_recorded`), as for
   `asset.inspect` and Validate in background.
5. **No artifact writes yet.** The worker's contract storage port is read-only (`assets` store
   only). A workload that produces files (a transcode, an optimized GLB, a thumbnail) needs a
   design for where results live and an owner decision (section 6, W4-4).

## 3. Adding a kind (checklist)

Taken from how `asset.validate_model` landed on this branch:

| Step | File |
|---|---|
| Declare or reuse the job type (`asset.process_audio` for 008, `asset.analyze_animation` for 009, `asset.optimize` for 010 are already reserved; 013 adds its own with `owner_task="LAI-LAMBDA-013"`) | `processing/lai_processing/contracts/job_types.py` |
| Processor and profile, registered in `default_registry()` (Django resolves the processor version for the idempotency key and the gate, so it must import with no native dependency) | `processing/lai_processing/processors/<name>/`, `core/registry.py` |
| Kind constant and queue in `KIND_QUEUE` | `lai/apps/jobs/core/envelope.py` |
| Runner in `tasks.RUNNERS` (contract kinds call `contract.run`) | `lai/apps/jobs/core/tasks.py` |
| `JobKind` choice (`kind` is `max_length=40`) | `lai/apps/jobs/models.py` |
| Migration: `AlterField` on `kind` and re-create the `jobs_kind_valid` check constraint, which embeds the kind list | `lai/apps/jobs/migrations/0004_...` (after `0003_contract_kinds`); one migration for all Wave 4 kinds avoids number races |
| Handler module with `apply(job)` and `inline_ports(job)`, registered in `services.HANDLER_MODULES` | `lai/apps/<app>/...`, `lai/apps/jobs/services.py` |
| Worker ports for the kind | `lambda/jobs_worker/aws.py` (`Runtime.ports`) |
| Tests: library, worker contract (`tests/lambda/`), Django handler, zip contents and size | `tests/processing/`, `tests/lambda/`, `lai/apps/.../tests/` |

**Rollout is consumer first:** the worker zip that knows the kind and Django's migration and
handler ship in the same release, and Django must not send the kind (no flag on, no Admin action
used) until both are deployed. A message for a kind an older worker does not know is retried into
the DLQ and its job later times out.

## 4. The workloads

| Card | Kind | Packaging | Notes |
|---|---|---|---|
| 009 NPC animation inspection | `asset.analyze_animation` | Zip (standard library) | Safest first: reuses the GLB container and document parsing. Facts only (clips, targets, skins, keyframes); Django compares names to `apps.npcs.vocabulary.ANIMATION_STATES`; nothing writes `NpcModelVariant.animation_map`. Must not bump the GLB validator version (that would make every version `processor_outdated` at the gate) |
| 008 Audio validation and transcoding | `asset.process_audio` | Phase 1 inspection may fit the zip only if it stays standard library (header facts ported from `validation_media.validate_audio`); loudness (`ebur128`) and transcoding need FFmpeg, so a container after its own ADR | Loudness target, output format, and whether audio joins `ASYNC_FORMATS` are owner decisions. No child audio |
| 013 Thumbnails and image conversion | `asset.convert_image`, `asset.render_thumbnail` (proposed) | Image conversion: Pillow or libvips, zip if the wheels fit and the decision allows, else a container after its ADR. GLB thumbnails need a renderer and Lambda has no GPU: spike, measure, then the owner decides | **013 owns thumbnails and image conversion.** Header limits `MAX_IMAGE_SIDE` 4096 and `MAX_IMAGE_PIXELS` 16,000,000 checked before decoding. Derived images stay staff-only |
| 010 Texture compression and GLB optimization benchmarking | `asset.optimize` | `gltfpack`, `toktx` or Basis Universal: native, so a container after its own ADR | Benchmark first. **Reuses 013's image tooling** for any resize or re-encode, never a second copy. The game and both validators refuse `EXT_meshopt_compression`, `KHR_draco_mesh_compression` and `KHR_texture_basisu`, and `react/src` loads no decoder, so outputs cannot be used without engine and validator changes (ADR-020) and an owner decision |

Security baseline for any native work: inputs are already-validated asset versions with verified
checksums; the format is sniffed, never taken from a name; tools run as argv lists without a shell
and with no network; time, memory and disk are bounded below the job's limits; assets are staff
content, never child photos, audio or text. Every tool and its licence is recorded (FFmpeg in an
LGPL build; `gltfpack` MIT; KTX-Software and Basis Universal Apache-2.0; libvips LGPL; Pillow HPND).

## 5. Order

| Step | Depends on |
|---|---|
| W0 Merge `feature/serverless-processing-canonical` | Owner review |
| W1 One jobs migration and the kinds for all Wave 4 cards; tracker rows | W0 |
| W2a 009 (zip) | W1 |
| W2b 013 image conversion | W1; packaging decision (zip or ADR) |
| W2c 008 phase 1 | W1; FFmpeg needs an ADR unless phase 1 stays standard library |
| W2d 010 benchmark harness | W1, W2b imaging module, its ADR |
| W3 013 GLB thumbnail spike, renderer decision | W2b |
| W4 Live verification | LAI-LAMBDA-011 and owner deployment approvals |

## 6. Owner decisions

| # | Decision | Blocks |
|---|---|---|
| W4-1 | An ADR for each native-tool workload (container image, registry, size, cold start, licence) | 008 beyond standard library, 010, 013 if the zip does not fit |
| W4-2 | GLB thumbnail renderer and runtime | 013 thumbnails |
| W4-3 | Fargate or another runtime for work over Lambda limits (FBX, Blender) | 009 FBX, 010 heavy |
| W4-4 | Durable derived files: promotion into the Asset Library as new unpublished versions, or a derived-object record, and how the worker may write them | 008 phase 2, 010, 013 |
| W4-5 | Loudness target and output format; whether audio joins `ASYNC_FORMATS` | 008 phase 2 |
| W4-6 | Loader and validator support for meshopt, Draco or KTX2 | Using 010 outputs |
| W4-7 | Any derivative delivered outside Django Admin | 013 beyond Admin |
| W4-8 | Every deployment and sizing change | All live use |

## 7. Release readiness (LAI-LAMBDA-011 and 012)

Documentation only; nothing has been executed or deployed.

- `LAI-LAMBDA-011-dev-acceptance.md`: the owner-run DEV live-acceptance checklist for the
  canonical release (deployment gates and the variable values that make a merge deploy nothing,
  infrastructure checks, consumer-first release order, the GLB cases, DLQ redrive, the RDS outage
  drill, overnight stop and start, monitoring, cost and rollback). Rewritten 2026-11-17 in three
  tiers: core acceptance (001 to 007), Wave 4 inspection acceptance (its section 5: the kinds
  `asset.analyze_animation` and `asset.process_audio`, kept apart from the core release), and
  future native-worker acceptance (its section 12: 008b, 010, 013a and 013b, blocked on W4-1 to
  W4-8, never blocking the other tiers). Its section 1, "Deployment gate verification", records
  that every deploy job on `main` was skipped because the repository gate variables were not
  `true`.
- `LAI-LAMBDA-012-production-rollout.md`: the production rollout plan. Production has no jobs
  queues, workers, consumer or maintenance schedule in CDK today, so turning processing on in
  production needs the owner decisions listed there (P1 to P15; P14 is whether the Wave 4 kinds
  ship in the first production release, P15 the processing budget).


## 7. Design branches and the owner review (2026-11-17)

| Branch (stacked on Wave 4 `48c98a18`) | Card | Content |
|---|---|---|
| `feature/lambda-derived-artifacts-design` | shared | `proposals/ADR-PROPOSED-derived-artifacts.md` (Option C recommended), `DERIVED_ARTIFACTS_INTEGRATION.md` |
| `feature/lambda-audio-transcoding-design` | 008b | updated `proposals/ADR-PROPOSED-native-audio-transcoding.md`, `AUDIO_TRANSCODING.md`, unwired profile model `contracts/audio_profiles.py`, offline `bench/audio_transcode_bench.py` |
| `feature/lambda-image-processing-design` | 013a | image-only `proposals/ADR-PROPOSED-image-conversion-and-thumbnails.md`, `feasibility/LAI-LAMBDA-013-image-conversion-contract.md`, standard-library EXIF/GPS scanner and upload warnings `image_location_present` / `image_metadata_present` (warnings only) |
| `feature/lambda-thumbnail-rendering-design` | 013b | `proposals/ADR-PROPOSED-glb-thumbnail-rendering.md`, `GLB_THUMBNAIL_SPEC.md`, `bench/thumbnail_framing.py` |
| `feature/lambda-glb-optimization-design` | 010 | updated 010 feasibility and proposal (Three.js loader change list, measurements), `proposals/ADR-PROPOSED-heavy-workload-runtime.md`, tests pinning that compressed extensions stay unpublishable |
| `feature/lambda-release-readiness-design` | 011, 012 | merged into Wave 4 (`0eaf75c1`) |

Card split proposed: LAI-LAMBDA-013a (image conversion, Pillow, zip-able) and 013b (GLB
thumbnails, browser renderer); they differ in runtime, packaging and acceptance criteria. 008b
tracks audio transcoding. All four native workloads use the one derived-artifact design once it is
accepted. Consolidated decisions: the APPROVALS_NEEDED list in the session report and in each
proposal's decision table.

Note on release order: `ASYNC_MODEL_VALIDATION.md` section 13 asks for the worker before or with
Django (a GLB `asset.inspect` now carries `max_bytes` that an old worker refuses), while section 3
of this page says consumer first. `LAI-LAMBDA-011-dev-acceptance.md` keeps consumer first and
forbids any GLB inspect or background action between the two deploys; the owner confirms this.
