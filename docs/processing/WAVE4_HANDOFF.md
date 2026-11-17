# Wave 4 handoff (LAI-LAMBDA-008, 009, 010 and 013)

Written 2026-11-17 for the Wave 4 implementation agents, their reviewer and the project owner.
Cards: [LAI-LAMBDA-008](https://trello.com/c/r7BVm0fV) (Sound Manager audio validation and
transcoding), [LAI-LAMBDA-009](https://trello.com/c/ga6LzukZ) (NPC Manager animation inspection
and mapping assistance), [LAI-LAMBDA-010](https://trello.com/c/l1ahd2je) (texture compression and
GLB optimization benchmarking) and [LAI-LAMBDA-013](https://trello.com/c/hj71jv81) (asset
thumbnail generation and image conversion, split out of 010 on 2026-11-16).

Read first: `ARCHITECTURE.md`, `CONTRACTS.md`, `WAVE2_INTERFACES.md` and `WAVE3_INTERFACES.md`
(both frozen), `WAVE3_HANDOFF.md`, `RUNTIME.md`, `GLB_VALIDATION.md`, `SECURITY.md`,
`OPERATIONS.md`, `../infrastructure/processing-infrastructure.md`, `../ASSET_LIBRARY.md`
sections 17, 21 and 23, and ADR-045, ADR-050, ADR-054, ADR-055, ADR-061 and ADR-062 in
`../DECISIONS.md`. **The code wins over this page and over every other doc; correct the page if
they disagree.** Symbols below were checked against `feature/serverless-processing-wave3` at
`07568e6` (Wave 3 foundation commit).

## 1. Where things stand (2026-11-17)

| Item | State |
|---|---|
| Wave 1 (LAI-LAMBDA-001, PR #40) | Merge-ready, **not merged to `main`** |
| Wave 2 (002 to 005, PR #41) | Reviewed in development, **not merged to `main`** |
| Wave 3 (006, 007) | In development on `feature/serverless-processing-wave3`: upload Option A behind `LAI_ASSET_ASYNC_VALIDATION` (default `off`), completion hook registry keyed by `(job_type, subject_type)`, Admin results section, publication gate. Foundation commit landed; `apps/assets/completion.py` does not exist yet |
| Deployment | **Nothing is deployed.** Live AWS acceptance is LAI-LAMBDA-011; every AWS step needs explicit owner approval (A9, ADR-019 G7) |
| Tracker | `tasks/TASK_TRACKER.md` lists 008 to 012 but **not 013**; add it through the principal |

Wave 4 code is dependency-ready only after the Wave 1, 2 and 3 merges (section 9). Agents may
prototype on branches cut from the Wave 3 branch, but nothing merges ahead of Wave 3.

## 2. Repository facts that shape Wave 4

1. **Three job types are already reserved** in `processing/lai_processing/contracts/job_types.py`:
   `asset.process_audio` (owner `LAI-LAMBDA-008`), `asset.analyze_animation` (009) and
   `asset.optimize` (010), all category `asset`, `requires_asset=True`, `requires_input=True`,
   subject `asset_version`. **None is a Django contract kind yet**: `CONTRACT_KINDS` in
   `lai/apps/jobs/models.py` is `{asset.validate_model, reference.checksum}`. 013 has no reserved
   type. Use the reserved names; renaming a declared job type is a contract change.
2. **The core forbids native code.** `tests/processing/test_processing_runtime_independence.py`
   rejects `subprocess`, `ctypes`, `socket`, `importlib` and others anywhere in `lai_processing`
   (processors included), and ADR-061 makes the package standard-library only. FFmpeg, libvips,
   toktx, gltfpack or a renderer can therefore never be called from `lai_processing`.
3. **Django builds the same registry.** `apps.jobs.processing.get_registry()` calls
   `lai_processing.core.registry.default_registry()` to resolve the processor version for the
   idempotency key, and the Wave 3 gate compares `processor_version`. Every processor class must
   import and register on the Django host with no native dependency (section 3.2).
4. **Published versions are immutable.** `AssetVersion.save` refuses changes to
   `IMMUTABLE_FIELDS` (which include `metadata`, `clips`, `dimensions`, `validation_report`) once
   a version is `PUBLISHED` or `RETIRED`. Results about published versions stay on the job
   (`ProcessingJob.result`, `JobArtifact`), as the legacy `asset.inspect` flow already does.
5. **Async upload covers GLB only.** `apps.assets.processing.ASYNC_FORMATS == {"glb"}`; audio and
   images keep the synchronous `VALIDATED` path.
6. **The game cannot load optimized GLBs.** Both validators (`lai/apps/assets/validation.py` and
   `processors/gltf/document.py`) refuse `KHR_draco_mesh_compression`, `EXT_meshopt_compression`
   and `KHR_texture_basisu` (`NEEDS_DECODER`, error `needs_decoder`), and `react/src` loads no
   `KTX2Loader`, `MeshoptDecoder` or `DRACOLoader`. GLB textures must be PNG or JPEG.
7. **One worker, one queue.** `LaiProcessing-<env>` has one work queue and one function; default
   sizing (`defaultWorkerSizing`) is 600 s, 2048 MB memory, 2048 MB ephemeral storage, arm64,
   batch 1; `validateWorkerSizing` caps the timeout at `MAX_WORKER_TIMEOUT_SECONDS` (840).
   `PLATFORM_CEILINGS` caps a job at 840 s, 512 MiB input, 1 GiB output, 10 GiB temp.
8. **Artifacts expire in dev.** The processing bucket rule `artifact-versions` expires current
   artifacts after 90 days in dev (kept in prod). A derived file is not a durable asset.
9. **Benchmark corpus is mostly outside git.** The repository holds six GLBs
   (`content/models/npc-pip-pirate.glb`, five under `react/public/models/`) plus
   `react/public/models/treasure-chest.gltf`, and **no audio files at all**. Castle and most
   Treasure Rush models live in the Asset Library stores.
10. **Docs drift to fix (principal).** `ARCHITECTURE.md` section 9 describes Wave 4 card 010 as
    "ECS Fargate fallback" and omits 013; `WAVE2_HANDOFF.md` section 9 already says 010 owns
    `asset.optimize` with Fargate only as its fallback. ADR-050 (Sound Manager) is still
    `Proposed` in the registry although `lai/apps/audio` is on this branch.

## 3. Shared design (principal-owned foundation, before agents start)

### 3.1 Adding a contract kind (verified against `7a795fa`, which added `asset.validate_model`)

| Step | File |
|---|---|
| Declare the job type (already done for the three reserved ones; 013 adds its own) | `processing/lai_processing/contracts/job_types.py` `_SPECS` |
| Constant, `CONTRACT_KINDS`, `JobKind` choice (`kind` is `max_length=40`) | `lai/apps/jobs/models.py` |
| Migration: `AlterField` on `kind` choices and **re-create the check constraints `jobs_kind_valid` and `jobs_contract_fields`**, which embed the literal kind list | `lai/apps/jobs/migrations/0004_...` (next free after `0003_processing_subject_outcome`) |
| Keep `test_processing_models.py` green (`CONTRACT_KINDS <= JobKind.values`, disjoint from `envelope.KINDS`) | `lai/apps/jobs/tests/` |
| Register the processor in `default_registry()` | `processing/lai_processing/core/registry.py` |

`register_completion_hook` raises `ImproperlyConfigured` for a kind not in `CONTRACT_KINDS`, so
the kind must exist before any hook. **One migration adds every Wave 4 kind** (process_audio,
analyze_animation, optimize and 013's), written by the principal, so agents never race on
migration numbers or on the constraint lists.

### 3.2 Native tools behind a port (proposal; principal decides and freezes it)

| Layer | Content |
|---|---|
| Port, stdlib only | New `lai_processing/ports/tools.py`: a `ToolRunner` protocol, `run(tool: str, argv: Sequence[str], *, timeout_s, max_stdout_bytes, cwd) -> ToolResult(exit_code, stdout, stderr_tail)` with `tool` from a closed set (`ffprobe`, `ffmpeg`, `vips`, `toktx`, `gltfpack`, ...) |
| Context | `ProcessingContext.tools: ToolRunner \| None`, set by `ExecutionEngine(tools=...)`; `None` on the Django host and in default tests |
| Processor | Declares id, version, profiles and options in `lai_processing/processors/<name>/` and builds argv lists (pure string work); raises `ProcessingError(UNSUPPORTED_PROCESSOR)` (MANUAL) when `context.tools` is `None` or lacks a required tool |
| Adapter | New `lai_processing_runtime/tools.py` `SubprocessToolRunner`: absolute paths under one image directory (proposed `/opt/lai-tools/bin`), `shell=False`, empty environment plus a fixed allowlist, `cwd` inside the workspace, timeout `min(requested, context deadline - margin)`, `RLIMIT_AS`/`RLIMIT_FSIZE`/`RLIMIT_NPROC` via `preexec_fn`, kill on timeout, stdout capped, stderr never logged raw (closed telemetry vocabulary, ADR-025) |
| Wiring | `lambda_handler.py` and `local_worker.LocalWorker` pass the runner; tests pass a `FakeToolRunner` that returns recorded outputs |

Prefer CLI tools in a subprocess over in-process C libraries (Pillow, pyvips): a decompression
bomb or codec crash then kills a child process under rlimits, not the worker. An in-process
library is acceptable only inside `lai_processing_runtime`, never in `lai_processing`.

### 3.3 Results onto Django (extends `WAVE3_INTERFACES.md` section 3)

- One hook per `(kind, "asset_version")`, all implemented in `apps.assets` (the only writer of
  `AssetVersion`), registered in `AssetsConfig.ready()`. `apps.audio` and `apps.npcs` only read.
- Same rules as the model hook: lock asset then version, `identity_mismatch` first, write only
  to a non-published version, `DatabaseError` propagates, any other mismatch is a logged no-op.
- Each card writes **one namespaced key** in `AssetVersion.metadata`
  (`metadata["audio_analysis"]`, `metadata["animation_inspection"]`, `metadata["optimization"]`,
  `metadata["image_derivatives"]`), a normalized summary built by a helper in
  `apps.assets.processing` (like `model_validation_summary`). Findings append to
  `validation_report` with `"source": "processing"` only when the card changes the version's
  verdict (008 phase 2 only; see below). For published versions the hook returns
  `result_recorded` and the Admin reads the job.
- Only 006's model hook moves `DRAFT -> VALIDATED/REJECTED`. A Wave 4 kind gates a status only
  if the owner extends `ASYNC_FORMATS` (008 phase 2) and the principal changes the gate.
- Durable derived files (a transcode, an optimized GLB, a thumbnail) need an owner decision:
  promote by a Django copy into `assets/...` as a new unpublished `AssetVersion` (staff then
  publish explicitly, ADR-045), or a new derived-object record. Until then they stay
  `JobArtifact`s, reviewable in Admin, never delivered to React.

### 3.4 Worker image and runtime

| Option | Effect | Approval |
|---|---|---|
| A. Extend `processing/Dockerfile.lambda`: a multi-stage build that copies pinned, SHA-256-verified static arm64 binaries into `/opt/lai-tools` | One image, one function; every job pays the larger image's cold start; one sizing for all kinds | Owner: native binaries in the worker image |
| B. A second image (or build target) and a second function and work queue for heavy kinds (010 benchmarks, 013 GLB render) | Light kinds keep a small image; needs outbox routing by kind (`JobQueue` gains a value, `relay_outbox` per queue), new settings, CDK for a second function | Owner + principal (infra, settings, routing) |
| C. ECS Fargate task for runs over 15 minutes or over Lambda limits (ADR-061 item 9) | Same contracts and adapters; defined by 010, not built | Owner (new runtime, cost) |

Recommendation: A for 008 and 013 image conversion; decide B only from 010/013 benchmark data;
C stays a written design. In every option: build arm64 only, off EC2, in GitHub Actions; keep
the CI `trivy` scan (`.github/workflows/ci.yml`, CRITICAL fails) and extend the smoke step to run
each tool's `-version`; deploy by digest (`DIGEST_PATTERN`); record image size and cold start in
the benchmark; tool downloads in CI are pinned by URL and SHA-256 (no `latest`).

### 3.5 Security baseline for native processing

| Threat | Control |
|---|---|
| Hostile media (decoder bugs, polyglots) | Inputs are already-validated asset versions (checksum verified by the engine), sniffed format passed explicitly to the tool (never auto-probe from a name), the stdlib pre-check runs first, tool runs in a subprocess with rlimits |
| Decompression bombs | Header checks before decoding: images `MAX_IMAGE_SIDE` 4096 and `MAX_IMAGE_PIXELS` 16,000,000 (`validation_media.py`); audio `MAX_AUDIO_SECONDS` 900, sample rate 8,000 to 96,000 Hz, 1 or 2 channels; GLB `COMPLEXITY_DEFAULTS`; expressed as profile `complexity` limits so `effective_limits` clamps them |
| Runaway time or disk | Tool timeout below the job deadline; `RLIMIT_FSIZE` and workspace accounting against `max_temp_bytes`; outputs through `write_artifact` only (count and byte limits) |
| Network | The function has egress (no VPC, `SECURITY.md` section 5): FFmpeg built with `--disable-network` and run with `-protocol_whitelist file`; no tool may fetch URLs; libvips with untrusted loaders blocked |
| Shell and argument injection | argv lists, `shell=False`, no user text in argv (keys and names come from the engine), file paths only inside the workspace |
| Data | Assets are staff content; never child photos (ADR-042), child audio or child text in this pipeline |

### 3.6 Licensing (record every tool in a third-party notice, e.g. `processing/THIRD_PARTY_NOTICES.md`)

| Component | Licence | Note |
|---|---|---|
| FFmpeg / ffprobe | LGPL-2.1+ by default; **GPL** if built with `--enable-gpl` or GPL libraries (common prebuilt static builds are GPL) | Build our own LGPL static arm64 binary with only the needed demuxers, decoders, encoders and filters; ship source offer and configure line. Codec patents: MP3, Vorbis and Opus carry no known licensing need today; do not enable AAC or H.264 |
| libmp3lame, libvorbis, libopus | LGPL / BSD-style / BSD | Only if 008 transcodes |
| KTX-Software (`toktx`), Basis Universal | Apache-2.0 | 010 |
| meshoptimizer / gltfpack | MIT | 010 |
| glTF-Transform (Node) | MIT | Needs a Node runtime in the image; prefer gltfpack unless the benchmark says otherwise |
| Pillow | HPND (MIT-CMU) | Runtime adapter only |
| libvips | LGPL-2.1+ | Dynamic linking; record version |
| Mesa (llvmpipe/OSMesa) | MIT | Only if 013 picks software GL |
| Blender | GPL | Fargate only, separate decision |

Asset licences (Kenney, KayKit, Poly Pizza and others) are unchanged by processing: derived files
inherit the source asset's licence.

## 4. LAI-LAMBDA-008: Sound Manager audio validation and transcoding

| Item | Content |
|---|---|
| Prerequisites | Cards 003, 005, 006 merged (with Waves 1 to 3); section 3.1 migration and 3.2 port frozen; owner approval to add FFmpeg to the image; ADR-050 accepted or confirmed sufficient by the owner |
| Job type and profiles | `asset.process_audio`. `audio-inspect` v1 (options `write_report` bool): stream facts and loudness. `audio-normalize` v1 (phase 2, after the benchmark and an owner decision on target format and loudness): options `target_lufs` int (for example -23 to -14), `output_format` str choices (`ogg`, `mp3`) |
| Processor | `processing/lai_processing/processors/audio/` (`AudioProcessor`, proposed id `asset.audio_processor` 1.0.0); a stdlib header check ported from `validate_audio` runs first, then `ffprobe` (codec, sample rate, channels, duration, bit rate) and `ffmpeg -af ebur128` (integrated LUFS, loudness range, true peak), plus silence and clipping counts |
| Native | Static LGPL arm64 `ffmpeg` and `ffprobe` (section 3.6); `--disable-network --disable-autodetect`, demuxers mp3/wav/ogg, decoders mp3/pcm/vorbis/opus, filters `ebur128`, `aresample`, `silencedetect`, `volumedetect`; encoders only for phase 2 |
| Metadata | `metadata["audio_analysis"]`: `codec`, `sample_rate`, `channels`, `duration_seconds`, `bit_rate`, `integrated_lufs`, `loudness_range_lu`, `true_peak_dbtp`, `leading_silence_seconds`, `trailing_silence_seconds`, `clipped_samples`, tool versions. Warnings (not errors) for loud, quiet or clipped audio in phase 1 |
| Artifacts | Phase 1: optional `audio-report` (`report.audio_analysis`). Phase 2: `audio-normalized` (`audio.normalized`), staying a `JobArtifact` until the section 3.3 promotion decision |
| Django | `apps.assets` hook and summary helper; "Analyse audio in background" action on audio versions; read-only loudness panel on the version page and on `SoundCueAdmin` for the cue's pinned or default version; `SoundLibraryReport` may add loudness warnings (read-only, `reporting.py` stays write-free) |
| Security limits | Input at most `LAI_ASSET_MAX_AUDIO_BYTES` (20 MB default), 900 s, 8 to 96 kHz, 1 to 2 channels, re-checked before FFmpeg; decoded PCM never written to disk beyond `max_temp_bytes`; FFmpeg timeout well under 300 s |
| Tests | Tiny synthetic WAV/Ogg/MP3 fixtures generated in tests or checked in under 50 KB (git has no audio today); golden metadata with tolerances for LUFS; hostile fixtures (truncated, wrong sample rate, header lies, polyglot); parity test with `apps.assets.validation_media.validate_audio` for the shared header facts (model: `lai/apps/assets/tests/test_glb_processing_parity.py`); `FakeToolRunner` unit tests; one image-level test running real `ffprobe` in CI |
| Benchmark | Real Sound Library and Treasure Rush cue files (from the dev Asset Library) at 1024, 2048 and 3008 MB: duration, peak memory, cold start; phase 2 adds output size and listening check |
| Owns | `processors/audio/`, its tests under `tests/processing/`, the hook and summary in `apps/assets` (coordinate with 006's `completion.py`), audio admin panels in `lai/apps/audio/admin.py`, the FFmpeg build recipe |
| Not in scope | Polly live verification (separate gate), `speech.synthesize`, child audio, making audio async-gated (`ASYNC_FORMATS`) without an owner decision |

## 5. LAI-LAMBDA-009: NPC Manager animation inspection and mapping assistance

| Item | Content |
|---|---|
| Prerequisites | Cards 002 and 007 merged; section 3.1 migration. **No native dependency** and no image change |
| Starting point | `asset.validate_model` already emits per-clip `name`, `duration_seconds`, `channel_count`, `sampler_count`, `skins` (`joint_count`, `name`) and `clip_vocabulary_matches`, and warns on `GENERIC_TAKE_NAME` (Mixamo `mixamo.com`, `|Layer0`, `Action`, `Take 1`). 009 must not bump the GLB validator: a new processor version would make every version `processor_outdated` at the Wave 3 gate |
| Job type and profile | `asset.analyze_animation`, profile `npc-animation` v1 (options `write_report` bool) |
| Processor | `processing/lai_processing/processors/animation/`, stdlib, reusing `processors/gltf` container and document parsing. Facts per clip: animated node indices and target paths (translation, rotation, scale, weights), which skin's joints it drives, keyframe count and time range, zero-length or duplicate names, root translation present; per skin: joint names, skeleton root; structural compatibility of clips with each skin |
| Semantics | **No guessing.** The processor reports facts and exact names only. Django computes suggestions by exact, case-insensitive equality of a clip name with a state in `apps.npcs.vocabulary.ANIMATION_STATES` (the processor cannot import Django); ambiguous or generic names are warnings; nothing writes `NpcModelVariant.animation_map` |
| Metadata | `metadata["animation_inspection"]` for unpublished versions; for published versions the Admin reads the job result |
| Django | Read-only "Animation inspection" panel on the `NpcModelVariant` change page (`lai/apps/npcs/admin_characters.py`, beside `model_clips`) for the resolved version, with suggestions shown as text the staff member copies; `validation/assets.clip_problems` stays the release authority |
| Security limits | GLB limits and `COMPLEXITY_DEFAULTS` from the GLB profile; caps on listed clips and joints as in `metadata._cap` |
| Tests | Synthetic GLBs from `tests/processing/glb_builder.py` (skinned and unskinned, Mixamo names, duplicates, morph weights); golden metadata; parity of clip names with `AssetVersion.clips` from Django validation; a manual NPC upload QA pass with `content/models/npc-pip-pirate.glb` |
| Owns | `processors/animation/`, its tests, NPC admin panel and suggestion helper in `apps/npcs`, the hook branch in `apps/assets` |
| Not in scope | FBX conversion (needs Blender or similar, section 3.4 C, after scope and benchmark) |

## 6. LAI-LAMBDA-010: texture compression and GLB optimization benchmarking

| Item | Content |
|---|---|
| Prerequisites | Card 007 merged; section 3.1 migration and 3.2 port; owner approval for the tools in an image (option A or B). Optional P2: not a blocker for baseline processing |
| Scope | KTX2 texture compression and mesh/GLB optimization as reproducible jobs, **benchmarking first**. **Thumbnails, resizing and image format conversion belong to 013**; where 010 needs to resize or re-encode a texture it calls 013's image tooling (same `ToolRunner` tool and helper module), never a second copy |
| Job type and profiles | `asset.optimize`: `glb-meshopt` v1 (geometry: quantization, simplification off by default), `glb-ktx2` v1 (textures: ETC1S or UASTC as an option, max dimension), possibly `glb-draco` v1 if the benchmark asks |
| Processor | `processing/lai_processing/processors/optimize/`; runs `gltfpack` and/or `toktx`/`basisu`, then re-parses the output with the stdlib GLB parser to compare counts, bounds, material names and exact clip names against the input (fidelity report) |
| Native | `gltfpack` (MIT), KTX-Software `toktx` and Basis Universal (Apache-2.0), static arm64; glTF-Transform only if justified (adds Node) |
| Metadata | `metadata["optimization"]` per profile: input and output bytes, texture bytes before and after, counts before and after, extensions added, fidelity deltas, tool versions, duration |
| Artifacts | `glb-optimized` (`model.optimized_glb`) and `optimization-report`; benchmark-only; the original is never touched |
| Hard blocker to use outputs | The game and both validators refuse `EXT_meshopt_compression`, `KHR_draco_mesh_compression` and `KHR_texture_basisu` (section 2, fact 6). Shipping optimized GLBs needs a Three.js loader change (ADR-020 engine work), a validator change in both validators with parity, and an owner decision. 010 does not make those changes |
| Benchmark (required before enabling) | Real Treasure Rush (`treasure-chest`, Pip, Kenney/KayKit kit pieces) and Storykeeper Castle assets from the dev Asset Library; Lambda 1024, 2048, 4096 and 10240 MB; record duration, peak memory, `/tmp` use, output size, fidelity deltas, browser load time with a prototype loader (local only), and cost per job; results in a new `docs/processing/BENCHMARKS.md` |
| Fargate fallback | Written design only: the same image (or a sibling) as an ECS task, triggered by the same contracts, for runs over 840 s or over 10 GB; Blender/FBX lives there. No CDK until the owner approves |
| Owns | `processors/optimize/`, its tests, `BENCHMARKS.md` (shared section with 013), the Fargate design note |
| Tests | Tiny synthetic GLBs with PNG textures; golden fidelity reports; hostile fixtures (oversized textures, huge accessor counts); `FakeToolRunner` units; real-tool tests only in the image job |

## 7. LAI-LAMBDA-013: asset thumbnail generation and image conversion

**Card text discrepancy.** The card says "a media-queue job kind (`lai/apps/jobs` +
`lambda/jobs_worker`)", i.e. a legacy schema-1 envelope kind on the ADR-055 zip worker. ADR-062
says contract kinds run on the processing queues and the ECR worker, and that the ADR-055 zip
workers are unchanged; legacy kinds have no outbox, attempts, idempotency key, artifacts or
completion hook, and `lambda/build.py` vendors no native libraries (a zip would need layers).
**Recommendation:** implement 013 as contract kinds on the processing worker, and ask the owner to
correct the card. Only an ADR could justify the media queue.

| Item | Content |
|---|---|
| Prerequisites | Cards 004, 005 and 007 merged; section 3.1 migration (013's kinds declared in `job_types.py` with `owner_task="LAI-LAMBDA-013"`); owner approval for the image library; a separate runtime decision before GLB thumbnails |
| Job types and profiles | Two kinds, so the light and heavy work can later route to different functions: `asset.convert_image` (profile `image-derivatives` v1: options `max_side` int, `output_format` str choices `png`, `jpeg`, `webp`, `quality` int) and `asset.render_thumbnail` (profile `glb-thumbnail` v1: `size` int, `background` str choices) |
| Processor | `processing/lai_processing/processors/imaging/` (shared helper module that 010 reuses) and `processors/thumbnail/` |
| Native | Image conversion: libvips CLI (`vips`, `vipsthumbnail`; LGPL) preferred, untrusted loaders blocked; Pillow (HPND) acceptable inside the runtime adapter. GLB thumbnail: **Lambda has no GPU**. Options: software GL (Mesa llvmpipe/OSMesa with a glTF renderer), headless Chromium plus three.js with a software rasterizer (large image), a small CPU rasterizer of our own (low fidelity, code to maintain), or a separate runtime. Spike, measure, then the owner decides |
| Metadata | `metadata["image_derivatives"]`: per output `format`, `width`, `height`, `bytes`, `sha256`, artifact logical id; thumbnails add camera framing used |
| Artifacts | `thumbnail-<size>` (`image.thumbnail`), `image-<format>-<side>` (`image.derivative`); private, under the attempt prefix; never public |
| Django | Version page shows derived images through the existing staff-only media route pattern (`ASSET_LIBRARY.md` 21.5: checksum-verified, staff session, no presigned URL); action "Generate derivatives"; nothing published automatically. Image versions already show the original scaled in the browser, so the GLB thumbnail is the main new value |
| Security limits | `MAX_IMAGE_SIDE` 4096 and `MAX_IMAGE_PIXELS` 16,000,000 checked from headers before decoding; output side capped; formats only `png`, `jpeg`, `webp` (`formats.FORMATS`); GLB textures stay PNG/JPEG (WebP refused in GLB); renderer timeout and memory rlimit |
| Tests | Tiny synthetic PNG/JPEG/WebP (including the `validation_media.py` hostile cases: dimension lies, trailing bytes, bombs); golden dimensions and hashes where the encoder is deterministic; parity of input facts with `validate_image`; thumbnail tests on the synthetic GLBs |
| Benchmark | Real texture and sprite assets plus Treasure Rush and castle GLBs; memory tiers as in 010; renderer cold start and image size; recorded in `BENCHMARKS.md` before enabling |
| Owns | `processors/imaging/`, `processors/thumbnail/`, their tests, the derivative panel in `apps/assets/admin.py` (after 007 merges, coordinated with its owner) |

## 8. Ownership and shared-file hot spots

| File or area | Who edits | Rule |
|---|---|---|
| `contracts/job_types.py`, `lai/apps/jobs/models.py` (`CONTRACT_KINDS`, `JobKind`), `lai/apps/jobs/migrations/0004_*` | Principal | One migration for all Wave 4 kinds |
| `core/registry.py` `default_registry()` | Principal merges one line per processor | Agents add a test that registers their processor in a private registry |
| `ports/tools.py`, `core/processor.py` (`ProcessingContext.tools`), `core/execution.py`, `lai_processing_runtime/tools.py`, `lambda_handler.py`, `local_worker.py` | Principal | Frozen in a `WAVE4_INTERFACES.md` before agents start |
| `processing/Dockerfile.lambda`, `runtime-requirements.txt`, CI image job | Principal (one tools stage; agents propose their binary, version, URL and SHA-256) | Pins in `runtime-requirements.txt` stay equal to `requirements.txt` (a test enforces it) |
| `infra/lib/processingStack.ts` sizing, any second function or queue | Principal, owner approval | From benchmark data only |
| `apps/assets/processing.py`, `apps/assets/completion.py`, `AssetsConfig.ready()` | Principal adds helper and registration stubs; each agent fills its own summary function and hook branch | Lock order and identity rules of `WAVE3_INTERFACES.md` section 4 |
| `apps/assets/admin.py` | One agent at a time, after 007 | Read-only panels, escaped with `format_html` |
| `docs/processing/BENCHMARKS.md`, `THIRD_PARTY_NOTICES.md` | 010 and 013 share sections; principal merges | |

## 9. Dependencies and workstream plan

| Step | Depends on | Parallel with | Serial point |
|---|---|---|---|
| W0 Merges: PR #40, PR #41, Wave 3 PR | owner | | Owner presses Merge |
| W1 Foundation: all Wave 4 kinds, migration `0004`, `ToolRunner` port and adapter, hook and summary stubs, `WAVE4_INTERFACES.md`, tracker row for 013, docs drift fixes | W0 (code can be drafted on the Wave 3 branch) | | Principal |
| W2a 009 animation inspection (stdlib) | W1, 007 merged | W2b, W2c, W2d | none (no image change) |
| W2b 008 phase 1 inspect (FFmpeg) | W1, 006 merged, owner approval for FFmpeg | W2a, W2c, W2d | Image tools stage (principal) |
| W2c 013 image conversion (libvips or Pillow) | W1, 007 merged, owner approval | W2a, W2b, W2d | Image tools stage; shared imaging module |
| W2d 010 optimization prototype and benchmark harness | W1, 007 merged, owner approval | W2a, W2b, W2c | Reuses W2c imaging module |
| W3 013 GLB thumbnail spike, then runtime decision | W2c | W2d | Owner decision (renderer, option B or C) |
| W4 Benchmarks recorded; sizing or second function proposal | W2b, W2c, W2d | | Principal + owner (`processingStack.ts`) |
| W5 008 phase 2 transcode/normalize; 010 enablement | W4, owner decisions (format, loader and validator change, promotion) | | Owner |
| W6 Live verification | LAI-LAMBDA-011 | | Owner deploy approvals |

Four agents can run W2a to W2d at once. 009 is the safest first: no native code, no image change.

## 10. Approvals the owner must give

| # | Decision | Blocks |
|---|---|---|
| W4-1 | Add native binaries (FFmpeg/ffprobe, libvips or Pillow, gltfpack, toktx/basisu) to the processing image, LGPL FFmpeg build | 008, 010, 013 |
| W4-2 | Second image or function and queue for heavy kinds (option B) | 010/013 at scale, GLB thumbnails |
| W4-3 | ECS Fargate fallback for runs over 15 minutes, Blender/FBX | 009 FBX, 010 heavy |
| W4-4 | GLB thumbnail renderer and runtime | 013 thumbnails |
| W4-5 | Durable derived files: promotion into the Asset Library as new unpublished versions, or a derived-object model | 008 phase 2, 010, 013 |
| W4-6 | Loudness target and output format for normalized audio; whether audio joins `ASYNC_FORMATS` | 008 phase 2 |
| W4-7 | Game loader and validator support for meshopt, Draco or KTX2 (ADR-020 engine work) | Using 010 outputs |
| W4-8 | Any thumbnail or derivative delivered outside Django Admin (React, CloudFront, public URLs) | 013 beyond Admin |
| W4-9 | Correct card 013 to contract kinds on the processing worker (section 7) | 013 start |
| W4-10 | Every deployment and sizing change (A9, ADR-019 G7) | All live use |
