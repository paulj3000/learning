# NPC animation inspection (`asset.analyze_animation`, LAI-LAMBDA-009)

Operator and developer guide. Code wins over this page:
`processing/lai_processing/processors/animation/`, `lai/apps/npcs/animation_inspection.py`,
`lai/apps/npcs/admin_animation.py`, `lai/apps/jobs/core/`. Status: developer-complete on
the Wave 4 integration branch `feature/serverless-processing-wave4` (from `feature/w4-npc-animation`,
on the reviewed canonical PR #42 head), not merged to `main`, not deployed. Local end-to-end run:
`scripts/processing/local-demo.sh` steps 10, 13 and 15 (packaged worker zip, in-memory SQS and S3). Read with `CANONICAL_PATH.md`, `ASYNC_MODEL_VALIDATION.md` and `WAVE4_HANDOFF.md`.

| Item | Value |
|---|---|
| Job type and `apps.jobs` kind | `asset.analyze_animation` (media queue) |
| Processor | `asset.animation_inspector` 1.0.0 |
| Profile | `animation-default` v1, no options |
| Handler module | `apps.npcs.animation_inspection` (`apply`, `inline_ports`) |
| Worker ports | `AssetPorts` (read only, `assets` store) |
| Dependencies | Python standard library only, in the existing worker zip |
| Migration | `jobs.0004_wave4_inspection_kinds`, shared with `asset.process_audio` (kind choices and the `jobs_kind_valid` check only) |

## 1. What it does

Staff ask, from the NPC model variant admin, what animation data the variant's model really has.
The worker reads the stored GLB of the version the variant resolves to (pinned, else the asset's
published default) and returns facts. Nothing is decided from them:

- `NpcModelVariant.animation_map` is never written. Staff map states with the existing variant
  form, which still checks every clip name against the model's clips.
- Nothing is published, and a published or retired version is never changed.
- A clip's name is never interpreted. `Armature|mixamo.com|Layer0` is reported exactly and flagged
  as an exporter's take name; no movement is inferred from it.

## 2. The processor

`inspect_glb` reuses the GLB validator's modules without changing them (the inspector never
changes the validator's version). Note: the validator itself is now `asset.glb_validator` 1.2.0
(1.1.0 Workstream B's policy, 1.2.0 ADR-070's compression rows and options), so background
validation evidence from an older validator is `processor_outdated` at the publication gate and
must be produced again; animation inspection results are unaffected:
`gltf.container.read_layout` and `read_at`, `gltf.jsonparse.parse_document`, `gltf.report.Report`
and `clean_text`, and the glTF tables and predicates in `gltf.document`. Container and JSON
problems therefore carry the validator's codes (`not_a_model`, `invalid_json`, `glb_length`, ...).

Read-only and bounded:

- No buffer is decoded. Keyframe counts come from accessor `count`; a clip's duration is the
  largest sampler input `max` (its start the smallest `min`). Only when an input accessor has no
  `min`/`max` does it read the first and last keyframe time, two 4-byte floats in the GLB binary
  chunk, after checking the range (`duration_source: "keyframe_data"`); otherwise the duration is
  unknown (`duration_unknown`). Nothing is fetched or resolved from a URI.
- Limits (profile complexity, clamped to 10 times the default; `max_json_bytes` 64 MiB,
  `max_json_depth` 128, `max_node_depth` 256): `max_animations` 200, `max_channels` and
  `max_animation_samplers` 20,000 in total, `max_keyframes` 10,000,000 (summed counts, never
  iterated), `max_nodes` 10,000, `max_accessors` 20,000, `max_skins` 200, `max_joints` 10,000,
  `max_json_bytes` 16 MiB, `max_json_depth` 64, `max_node_depth` 64, and `max_json_elements`
  1,000,000 (the GLB validator's string-aware structural pre-scan before `json.loads`; not
  raisable). Beyond one: `too_complex` (excess nesting is `invalid_json`).
  Child entries walked to build the hierarchy are bounded by `max_nodes`.
- Input size: the profile carries the GLB validator's limits (`GLB_LIMITS`), so a change to the
  model input ceiling (`max_input_bytes`, 50 MiB today) applies to both. A larger file is refused
  when the request is built (`resource_limit_exceeded`); the engine and the processor check again.
- Time: Django's request sets `max_execution_seconds` 90 (inside the 120 s media function); every
  loop calls `context.check()`.
- Output: at most 100 clips, 20 skins, 32 listed target nodes per clip and 16 listed root joints
  per skin; strings cleaned and cut to 200 characters; the object is fitted under
  `max_metadata_bytes` (64 KiB): target and root lists are emptied first, then the clip and skin
  lists (`lists_truncated: true`). Counts and `clip_count` always stay complete.

Verdict: `fail` when any finding is an error (the file or its animation data cannot be read
correctly), else `pass`. It is a statement about the data, never an approval.

### Finding codes

| Code | Severity | Meaning |
|---|---|---|
| Validator container and JSON codes, `gltf_version` | error | The GLB could not be read |
| `invalid_structure` | error | A top-level array is not an array |
| `too_complex` | error | A limit above was exceeded (inspection stops) |
| `invalid_animation` | error | An animation, sampler or channel is malformed, or has no samplers or channels |
| `unsupported_interpolation` | error | Interpolation other than `LINEAR`, `STEP`, `CUBICSPLINE` |
| `invalid_accessor_reference` | error | A sampler refers to a missing or malformed accessor |
| `invalid_keyframe_times` | error | Keyframe times are not float scalars, are negative, or end before they start |
| `invalid_sampler_reference` | error | A channel refers to a missing sampler |
| `unsupported_target_path` | error | A channel targets something other than translation, rotation, scale, weights |
| `invalid_node_reference` | error | A channel, joint, skeleton or child refers to a missing node |
| `invalid_skin` | error | A skin has no joints |
| `no_animations` | warning | The model has no clips |
| `missing_clip_name` | warning | A clip has no name (reported as `null`) |
| `duplicate_clip_name` | warning | Two clips share a name (both listed) |
| `clip_name_altered` | warning | Control or format characters were removed, or the name was cut (`name_exact: false`) |
| `generic_clip_name` | warning | An exporter's default take name (Mixamo, Blender `Action`, `Take 1`) |
| `targets_outside_skins` | warning | The model has skins and a clip moves nodes that are joints of none |
| `channel_without_node` | warning | A channel has no target node |
| `duration_unknown` | warning | Some keyframe times have no bounds and could not be read |
| `repeated_joint` | warning | A skin lists a joint twice |
| `node_hierarchy_invalid`, `hierarchy_not_measured`, `hierarchy_too_deep` | warning | Joint roots or depth may be incomplete |

Messages are code-authored and never quote a name; paths are index paths (`animations[2]`).

## 3. Result schema (`ProcessingJobResult.metadata`, `metadata_version` 1)

Deterministic (no timestamps, ids or file names); every key is always present.

| Key | Type | Meaning |
|---|---|---|
| `metadata_version` | int | `1` |
| `format` | `"glb"` or null | null when the bytes are not a GLB |
| `file_size_bytes` | int | Input size |
| `document_read` | bool | Whether the JSON document was read |
| `counts` | object or null | `animations`, `channels`, `samplers`, `keyframes`, `skins`, `joints`, `nodes` |
| `clip_count` | int | Animations in the document (complete even when `clips` is shortened) |
| `generic_clip_count` | int | Clips with an exporter's take name |
| `clips` | list | One entry per animation, in document order (below) |
| `skins` | list | One entry per valid skin (below) |
| `lists_truncated` | bool | Lists were emptied to fit `max_metadata_bytes` |

Clip: `index`, `name` (exact after cleaning, or null), `name_exact`, `generic_name`,
`duration_seconds` and `start_seconds` (6 places, or null), `duration_source`
(`accessor_bounds`, `keyframe_data` or null), `channel_count`, `sampler_count`,
`invalid_channel_count`, `invalid_sampler_count`, `keyframe_count` (sum of valid samplers' input
counts), `max_sampler_keyframes`, `interpolations` and `target_paths` (sorted), `target_node_count`,
`target_nodes` (`{index, name}`, sorted by index, at most 32), `targets_outside_skins`,
`channels_without_node`.

Skin: `index`, `name`, `joint_count`, `invalid_joint_count`, `skeleton` (`{index, name}` or null),
`root_joint_count`, `root_joints` (joints whose parent is not a joint of the same skin, at most 16),
`hierarchy_depth` (longest joint chain, or null when not measurable), `used_by_node_count`.

## 4. Django

`submit_animation_inspection(version, user=)`:

- refuses a non-GLB (`unsupported_format`) or a retired asset (`asset_retired`) with
  `InspectionRefused`; a request the profile refuses (for example the input limit) raises
  `JobsError` with the contract code, before any job exists;
- builds the ADR-061 request (`inspection_request`): namespace, subject `asset_version`, asset
  context, input `ObjectRef("assets", storage_key)` with the version's SHA-256 and size, profile,
  expiry 72 hours, budget 90 s, and an `ik1:` idempotency key over that exact version, its file
  and the processor version;
- reuses a job with the same key that is pending, running, or completed with an accepted outcome;
  a failed job, or one whose result was refused, may be submitted again (a new job).

`apply(job)` (under the job row lock; then asset row, then version row, as model validation):

| `subject_outcome` | Meaning | Version changed |
|---|---|---|
| `result_recorded` | The version is published or retired: the result stays on the job | No |
| `inspection_stored` | Never published (draft, validated, rejected): summary stored in `metadata["animation_inspection"]` | Metadata key only |
| `duplicate_result` | That job's summary is already stored | No |
| `stale_result` | A later inspection of this version is already stored | No |
| `processing_failed` | The job failed | No |
| `version_missing` | The version no longer exists | No |
| `result_invalid`, `*_mismatch` | Result not of this request (`assets.processing.result_mismatch`), or request not of this version's current file (`identity_mismatch` with this kind and profile) | No |

A redelivered result message is a duplicate at `apps.jobs.services.apply_result` (the job is
terminal) and never reaches the handler.

## 5. Django Admin

On **NPC model variants** (Django Admin, NPC Manager):

- **Inspect animations in background** (list action; staff with `npcs.change_npcmodelvariant`,
  which the NPC editors role has; at most 50 variants per run). Inspects the version each variant
  resolves to, or reports the existing job. Bundled-only models, non-GLB files and retired assets
  get a message and no job.
- **Animation inspection** (read-only section on an existing variant's page): the inspected file,
  job status and outcome with a link to the job page (where a stuck job can be marked failed), the
  clip table (exact names, exactness, take-name flag, duration, channels, samplers, keyframes,
  interpolation, target paths and nodes, targets that are not joints), skins, warnings and
  findings, and the **mapping helper, labelled "Suggestion only"**. Every value is escaped.
- The helper lists each runtime state of `apps.npcs.vocabulary.ANIMATION_STATES` (`idle`, `walk`,
  `run`, `talk`, `wave`, `point`, `celebrate`, `think`, `sad`, `laugh`, `jump`) with the current
  mapping, whether that clip is in the file, and a suggestion. A clip is suggested only when its
  exact name equals the state (`exact`) or equals it ignoring capitals (`case_insensitive`, for
  example `Idle` for `idle`), and only when exactly one clip matches (`ambiguous` otherwise). No
  other aliases are defined. Names that are not exact and exporter take names are never
  suggested. To use one, staff type it into the animation map field and save.

## 6. Tests

```bash
LAI_REQUIRE_POSTGRES=1 /Coding/ENV/bin/python -m pytest -q \
  tests/processing/test_processing_animation_inspection.py \
  tests/lambda/test_jobs_worker_contract.py tests/lambda/test_jobs_worker_package.py \
  lai/apps/npcs/tests/test_animation_inspection.py lai/apps/jobs/tests/test_jobs_core.py
```

## 7. Not done, and rollout

- FBX, Blender and any conversion are out of scope (owner decision W4-3).
- No artifact is written; nothing outside Django Admin shows the result.
- Rollout is consumer first (`WAVE4_HANDOFF.md` section 3): the worker zip and Django
  (migration, handler) ship together; do not use the action before both are deployed. Every
  deployment is an owner approval.
- The branch's `jobs.0004_asset_analyze_animation` was folded into the single Wave 4 jobs migration
  `jobs.0004_wave4_inspection_kinds` on the integration branch.
