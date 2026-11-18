# GLB optimization: Meshopt, then KTX2 (LAI-LAMBDA-010, ADR-070)

Status (2026-11-18, phase 2 wiring on `feature/lambda-meshopt-ktx2`): the loader decodes
Meshopt and KTX2; both validators accept each format only while its control is on (policy version
3, processor `asset.glb_validator` 1.2.0); the publication gate and promotion check the controls;
staff can submit `asset.optimize` jobs from Django Admin; the optimize worker writes through the
create-only artifact store. **Nothing is enabled**: `LAI_GLB_MESHOPT` and `LAI_GLB_KTX2` default
to `off`, and device and browser acceptance is pending. No AWS call, deployment, layer or image
was made.

Labels used for every number: **workstation** (x86_64, Intel Core i7-12700K, 4 vCPUs visible,
7.9 GB RAM, Python 3.12.3, measured), **calculated** (formula), **extrapolated** (arithmetic on
workstation numbers, not a measurement). There is no ARM64, Lambda, device or browser evidence.

## 1. What is where

| Piece | Path |
|---|---|
| Compression support policy (`compression_support`, controls) | `processing/lai_processing/processors/gltf/compression/policy.py` |
| `EXT_meshopt_compression` validation (stdlib) | `processing/lai_processing/processors/gltf/compression/meshopt.py` |
| `KHR_texture_basisu` / KTX2 validation (stdlib) | `processing/lai_processing/processors/gltf/compression/ktx2.py` |
| Loader decoders | `react/src/features/island-map/three/assets/gltfDecoders.ts`, used by `assetLoader.ts` and `features/assets/preview/previewModelSource.ts` |
| Optimizer (native tools) | `processing/lai_native/optimize/` (`profiles`, `signature`, `meshopt`, `ktx2`, `glbwrite`, `texture_prep`, `textures`); tools run through Workstream C's `processing/lai_native/runtime/` (copied verbatim from `feature/lambda-native-audio` 0705f583, deduplicated at integration) |
| Worker skeleton | `lambda/optimize_worker/` (`task.run_optimize`, `handler.handle`) |
| Pinned tools, fetch script, benchmark | `native/gltf/` (`tools.lock`, `fetch-tools.sh`, `bench.py`, `README.md`) |
| Tests | `tests/processing/test_processing_gltf_meshopt.py`, `tests/processing/meshopt_builder.py`, `tests/native/`, `react/src/features/island-map/three/assets/gltfDecoders.test.ts`, `react/src/test/compressedGltfFixtures.ts` |

## 2. Validators, controls and the publication gate (wired)

**One policy table** (`processing/lai_processing/processors/gltf/extension_policy.py`, policy
version 3): `EXT_meshopt_compression` and `KHR_texture_basisu` are `Support.WHEN_ENABLED`, keyed
to their controls in `CONTROLS`; `error_code(name, enabled)` returns `needs_decoder` unless the
control is in `enabled`. `KHR_meshopt_compression` (Release Candidate) and Draco stay `DECODER`
(always refused). `compression/policy.py` describes the same rows with `compression_support()` and
a test keeps the two in agreement.

**Where the enabled set comes from.** Django reads the settings in one place,
`apps.assets.validation.compression_controls()`. The synchronous validator
(`validate_model(..., compression=None)`) uses it directly. The asynchronous `asset.validate_model`
request carries it as two profile options of `glb-default` v1, `allow_meshopt` and `allow_ktx2`
(`processing.compression_options()`), resolved like every option and therefore part of the
idempotency key. The worker never reads Django settings. This is the smallest contract-consistent
change: no new field, no new profile version, and an older worker refuses the unknown options
(`invalid_processing_profile`) instead of guessing, which is why the worker must ship first (the
compatibility-gated release, ADR-071).

**When a control is on**, both validators (the same functions):

1. accept the extension in `extensionsUsed` / `extensionsRequired`;
2. Meshopt: accept a buffer without data when it is a marked fallback buffer
   (`fallback_buffer_indices`), then run `validate_meshopt` with the real container lengths and
   bounded reads of the GLB binary chunk (header-level stream checks);
3. KTX2: accept `image/ktx2` only for images reached through `KHR_texture_basisu`
   (`ktx2_image_indices`), then run `validate_basisu`, reading each KTX2 file whole (bounded,
   64 MiB) with the texture side limit of the processor default (8192).

The parity corpus has compressed cases with each control off and on; both validators agree.

**Processor version 1.2.0 and draft evidence.** The bump makes every earlier `pass` (`1.1.0`,
`1.0.0`) `processor_outdated` at the publication gate. An unpublished `VALIDATED` or `DRAFT` GLB
whose background validation ran before this release needs Validate in background again before it
can be published (the action submits a new job by itself, since the processor version and options
are in the idempotency key). Published versions, rollback and delivery are not touched. With both
controls off the verdicts equal `1.1.0`'s.

**Extensions three renders natively** (review fix): `KHR_materials_anisotropy`,
`KHR_materials_dispersion` and `EXT_materials_bump` are `SUPPORTED` (three 0.185.1 `GLTFLoader`
implements all three; checked against its `EXTENSIONS` table). Every other name three lists is
either already supported, a gated compression row, or deliberately rejected (`EXT_texture_webp`,
`EXT_texture_avif`, `EXT_mesh_gpu_instancing`, `KHR_draco_mesh_compression`,
`KHR_meshopt_compression`). These additions ship inside policy version 3 / processor 1.2.0, which
are not released yet, so they need no further bump.

**Policy changes never reject a file.** `publish_version` re-validates the stored bytes; when the
only errors are policy codes (`needs_decoder`, `unsupported_extension`:
`extension_policy.POLICY_ERROR_CODES`) the publication is refused with `policy_refused` and the
version stays `VALIDATED`; changed bytes or structural errors still reject it. Republishing or
rolling back to a retired, previously published version (`republish_version`) requires intact
bytes and every structural check, but tolerates policy-only errors, because those same bytes were
valid and live under the policy recorded when they were published. This is the conservative
choice: integrity and structure are re-proven; only a later tightening of the extension table is
not applied retroactively to a rollback target, and gated compression is still refused while its
control is off (below).

**Publication gate** (`apps.assets.services`): `compression_refusal(version)` runs inside
`publish_refusal` (before the stored bytes are re-read) and in `republish_version`: a version
whose recorded `extensionsUsed` contains a gated extension is refused with
`compression_disabled` while that control is off, and left unchanged (not rejected). B's
latest-validation gate (`_has_passing_validation`) still applies on top when asynchronous
validation is on; it was not rewritten. Published content is never changed.

## 3. `EXT_meshopt_compression` validation (`compression/meshopt.py`)

Source: the ratified Khronos specification (Vendor/EXT_meshopt_compression, read 2026-11-18).
Findings are code-authored and never quote file content. Error codes:

| Code | Rule |
|---|---|
| `meshopt_invalid` | Missing or invalid `byteOffset`, `byteLength` (>= 1), `byteStride` (>= 1), `count` (>= 1), or a malformed extension or fallback marker |
| `meshopt_invalid_buffer` | `buffer` is not a valid buffer index |
| `meshopt_fallback_source` | compressed data read from a fallback buffer |
| `meshopt_bounds` | `byteOffset + byteLength` past the buffer (the smaller of declared `byteLength` and the real container length) |
| `meshopt_mode`, `meshopt_filter` | mode not `ATTRIBUTES`/`TRIANGLES`/`INDICES`; filter not `NONE`/`OCTAHEDRAL`/`QUATERNION`/`EXPONENTIAL`, or a filter on an index stream (`COLOR` is KHR-only, refused) |
| `meshopt_stride`, `meshopt_count` | ATTRIBUTES stride divisible by 4 and <= 256; index streams stride 2 or 4; TRIANGLES count divisible by 3; OCTAHEDRAL 4 or 8; QUATERNION 8; EXPONENTIAL divisible by 4 |
| `meshopt_stride_mismatch`, `meshopt_length_mismatch` | parent `byteStride` differs; parent `byteLength` is not `count * byteStride` |
| `meshopt_decoded_too_large` | a view, or the sum, decodes past the budget (default 256 MiB, ceiling 1 GiB) |
| `meshopt_stream_truncated` | shorter than the smallest well-formed stream for its count and stride |
| `meshopt_stream_header` | first byte is not `0xa0` / `0xe1` / `0xd1` (so a KHR v1 stream is refused) |
| `meshopt_stream_tail` | TRIANGLES tail table: last two bytes not zero, or a `0xf` nibble |
| `meshopt_not_declared`, `extension_required_not_used` | used but not in `extensionsUsed`; required but not used |
| `meshopt_fallback_reference` | an uncompressed view reads a fallback buffer |
| `meshopt_fallback_index` | buffer 0 (the GLB binary chunk) marked as fallback |
| `meshopt_fallback_requires_extension` | a fallback (or data-less) parent buffer while the extension is not in `extensionsRequired` |

Warnings: `meshopt_payload_not_decoded` (always, when anything is compressed: the payload is
decoded only by the browser) and `meshopt_unused`. Facts for metadata:
`MeshoptFacts.as_metadata()` (view count, compressed and decoded bytes, modes, filters,
`payload_decoded: false`). Header checks read at most 17 bytes per view.

## 4. Loader (React)

`gltfDecoders.configureGltfLoader(loader)` registers three's `MeshoptDecoder`
(`three/examples/jsm/libs/meshopt_decoder.module.js`, 29 KB, WASM inline, bundled by Vite, no
CDN) on both loader construction sites: `createGltfFetcher()` in `assetLoader.ts` (game and NPC
models, cache unchanged) and `parsePreviewModel()` (Django Admin preview). Registration is
unconditional: an uncompressed GLB never touches the decoder, and the server-side controls
decide what can be published. A browser without WebAssembly gets `CompressedModelError`
(`meshopt_unsupported`) from the game loader and `compression_unsupported` in the preview, both
readable. Animation maps and the asset cache are untouched. The preview's URL refusal still holds:
the decoder fetches nothing (a test asserts no `fetch`).

KTX2: `createKtx2Loader(renderer)` builds a `KTX2Loader` with the Basis transcoder
(`basis_transcoder.js` and `.wasm` from the installed three 0.185.1) imported with Vite `?url`,
so the build emits them as hashed files under `assets/` on the site origin (immutable caching by
the existing publish script; no CDN, no copy step). A `LoadingManager` URL modifier maps the two
fixed file names `KTX2Loader` requests to those URLs, passes `blob:`/`data:` texture data, and
refuses every other URL. Two workers at most (`setWorkerLimit(2)`), GPU format from
`detectSupport(renderer)` (never the deprecated `detectSupportAsync`). The transcoder downloads
only when a KTX2 texture is first decoded.

**One app-wide KTX2 loader** (`assets/ktx2Support.ts`, review fix). There is exactly one shared
`KTX2Loader`, bound to the first attached renderer and reference counted. Every game fetcher
(`createGltfFetcher`: the bundled loader, every `createAssetLoader`, so region play's Django
published models and the NPC loader's single-use loaders too) sets the shared loader on its
`GLTFLoader` immediately before each load, so any game load decodes KTX2 while a renderer is
attached, and none does when no renderer is attached (`ktx2_unavailable`). The location engine
attaches through `LocationEngineAssets.attachRenderer` right after creating its renderer, before
any model loads (default deps and region play's `engineAssetsFrom` both provide it), and detaches
before `renderer.dispose()`; an attach failure is logged and the place runs without KTX2. The
shared loader is disposed only when the last renderer detaches **and** no parse is in flight
(each load is counted from start to settle), so a detach during a parse never strands it. A load
that never settles is failed after `DEFAULT_LOAD_TIMEOUT_MS` (120 s), which evicts it from the
cache; its parse stays counted until it really settles. Known limit: `GLTFLoader` reads its KTX2
loader when the download finishes, so a load that starts while attached and finishes after the
last detach decodes without KTX2 (it fails with the typed error, it does not hang). Tested at
configuration level (fake renderer and loader); no real transcode in jsdom. Missing KTX2 support
gives `CompressedModelError` (`ktx2_unavailable`). The Django Admin preview now creates its viewer (and
renderer) first, builds a `KTX2Loader` for that renderer, parses, then disposes the loader's
workers (`mountAssetPreview.ts`); without a usable renderer it refuses KTX2 models with
`compression_unsupported`. **The committed Django static bundle does not ship the Basis
transcoder** (its `.wasm` is a 527 kB binary build output, which is not committed):
`vite.admin-preview.config.ts` drops the emitted transcoder files and builds with
`VITE_LAI_ADMIN_KTX2=off`, so the deployed Admin preview shows `compression_unsupported` for a
KTX2 model until the transcoder is served from Django (ADR-070 O7). Meshopt previews work (the
decoder is inline). The thumbnail capture bundle (ADR-069) likewise drops the transcoder.

## 5. Optimizer (`lai_native.optimize`)

`optimize_meshopt(source, tools=ToolPaths(...), workspace=Workspace(...))` with profile
`meshopt-conservative/v1`:

```
gltfpack -i source.glb -o output.glb -cc -ce ext -si 1 -kn -km -ke -kv -af 0 -ac -vpf -vtf
```

Why each flag: `profiles.py`. Before this profile was fixed, two variants were measured on the
NPC (workstation): plain `-cc` (822,380 bytes) and `-cc -ce ext -kn -km -ke -af 0 -ac`
(921,196 bytes) both moved the skinned mesh under a new unnamed node with a dequantization
transform, and the second added `KHR_texture_transform`; the preservation check rejected both.
`-vpf -vtf` keeps the tree and the materials identical (941,508 bytes).

Preservation (`signature.compare_signatures`, read with the stdlib container reader, JSON
parser and the LAI-LAMBDA-009 animation inspector; nothing is decoded):

- node tree (paths by name), mesh/skin/camera attachments, local transforms (relative 1e-5);
- per primitive: mode, attribute semantics, indices, morph targets, material, index count;
  vertex count may only go **down** on indexed primitives (gltfpack welds vertices that are
  identical after normal quantization: kit pieces 311 to 272 vertices, same 564 indices);
- materials: names, alpha mode, double-sided, texture slots with UV set and effective
  `KHR_texture_transform` (an identity transform counts as none: the Kenney kit's
  `{"texCoord": 0}` is dropped by gltfpack and that is accepted);
- skins: joint paths in order, skeleton, inverse bind matrix count;
- animations: clip names in order, start and duration (1e-4 s), channel count, target
  properties and (node, property) pairs. Keyframe counts are reported, not compared (gltfpack
  collapses constant two-key tracks: NPC 16,963 to 16,079 keyframes, same 780 channels);
- textures: Meshopt profile requires identical image bytes (SHA-256).

Failure codes: `source_unreadable`, `source_already_compressed`, `tool_not_configured`, the
runtime's codes (`timeout`, `deadline_exceeded`, `tool_crashed`, `resource_limit`,
`output_too_large`, ...; retryable exactly as `lai_native.runtime.CODES` says), `tool_failed`, `no_size_gain`, `output_invalid`, `output_unreadable`,
`preservation_failed`, `profile_mismatch`. The report (`lai.optimize_report/1`) records profile,
tool argv, sizes and SHA-256 of both files, geometry summaries, Meshopt facts, calculated texture
GPU memory, clip durations, processing time and the tool's wall time and peak RSS.

Tools run through `lai_native.runtime.run_tool(ToolSpec, args, Workspace, ToolLimits,
deadline=..., cancelled=...)`: absolute executable path (optional SHA-256 pin from
`LAI_GLTFPACK_SHA256` / `LAI_TOKTX_SHA256`), scrubbed environment (`LD_LIBRARY_PATH` for toktx
via `ToolSpec.extra_env`), rlimits sized per profile (`OptimizeProfile.limits()`: 2 GiB address
space, 200 MiB per file, 600 MiB workspace, CPU seconds = timeout). The runtime's peak RSS comes
from `os.wait4` and can include the forked Python image before `exec`, so it is an upper bound;
the benchmark wraps the tool in GNU `time` instead.

## 6. Optimize jobs: worker, Django, Admin, promotion

**Worker** (`lambda/optimize_worker/handler.py`): reuses `jobs_worker.handler.process` (envelope,
redelivery, stored results, batch failures) and registers `run_optimize` for `asset.optimize` on
the `optimize` queue (Workstream A's registrations). `run_optimize` decodes the ADR-061 request and
runs the engine with one processor, `asset.glb_optimizer` 1.0.0
(`lai_native/optimize/engine.py`), whose storage is A's create-only store for the attempt
(`aws.Runtime.artifact_storage(namespace, job, attempt)`): inputs are read from the asset bucket,
artifacts are written only through `ProcessingContext.write_artifact` under
`processing/artifacts/<env>/<job>/<attempt>/` (`model.glb` as `model.optimized`, `report.json`
as `model.optimize_report`). Tools: `LAI_GLTFPACK_PATH` (default `/opt/bin/gltfpack`),
`LAI_TOKTX_PATH` (`/opt/bin/toktx`), `LAI_KTX_LIBRARY_PATH` (`/opt/lib`), optional SHA-256 pins
(`LAI_GLTFPACK_SHA256`, `LAI_TOKTX_SHA256`, 64 hex characters), all read by the one
`ToolPaths.from_environment` that the worker, the benchmark and the real-tool tests share. At
start-up the worker removes stale `lai-native-*` workspaces left in `/tmp` by killed invocations
(`lai_native.runtime.sweep_stale`). The runtime keeps the tail of stderr; the optimizer uses it
only as a bounded diagnostic (`tool_failed`), never parses it.
An optimization that is not safe or useful (no gain, preservation difference, invalid output) is
a `fail` verdict with a finding and no artifacts; runtime timeouts and crashes are retryable
contract errors. The result metadata carries `tool_versions` and up to 12 scalar
`artifact_facts` for the model (variant, sizes, ratio, GPU memory before and after, texture
formats, triangles, clips, preserved, required extensions), which Django keeps on the artifact
row. No packaging and no infrastructure (Workstream G; runtime decision ADR-070 O1).

**Not deployable yet, by design.** There is **no Linux arm64 gltfpack** (meshoptimizer publishes
none; the from-source build needs CMake and was not done) and **no optimize zip builder**
(`native/gltf/build.py`, which `build-workers.sh` would call with `python3 -I <builder> --out
DIR`, does not exist). A zip without arm64 tools would not run on the arm64 function, so the
builder is deferred to the runtime decision (O1). Until both exist, `LAI_GLB_MESHOPT` and
`LAI_GLB_KTX2` stay `off` in every environment; with them off nothing is submitted to the
optimize queue.

**Shared constants** (`compression/optimize_contract.py`, standard library): job type, processor
id and version, the two variants (`meshopt` -> `meshopt-conservative` v1 / `LAI_GLB_MESHOPT`,
`ktx2` -> `ktx2-basisu` v1 / `LAI_GLB_KTX2`) and one `ResourceLimits` budget (50 MiB input,
840 s, 600 MiB temporary). Django imports these, never native code.

**Django** (`lai/apps/assets/optimize.py`):

- `submit_optimization(version, variant, user)` refuses unless the variant's control is on
  (`optimization_disabled`), the asset is active, the version is a `VALIDATED` or `PUBLISHED`
  GLB and does not already use compression or quantization; then submits through
  `artifact_jobs.submit_derived_job(variant=...)` with the contract profile, processor version and
  limits. The source version is never changed.
- `register()` (from `AssetsConfig.ready`) sets
  `artifact_results.PROCESSOR_VERSION_RESOLVERS["asset.optimize"]`, so a result from an older
  optimizer build is `processor_outdated` and records nothing.
- Admin actions on asset versions: "Optimize (Meshopt)" and "Optimize (KTX2)"
  (`admin_optimize.OptimizeAdminMixin`, mixed into `AssetVersionAdmin` cooperatively like the
  image and capture mixins; staff who may upload and view versions), each refused with a clear
  message while its control is off.
- The derived-artifact page shows an "Optimization report" table for `model.optimized` rows:
  original and optimized size, ratio, texture formats, calculated GPU memory before and after,
  triangles, clips, preservation, required extensions. The full JSON report is the
  `model.optimize_report` artifact (download).
- Promotion stays A's `promote_artifact`; `promotion_refusal(artifact)` refuses a
  `model.optimized` artifact with `compression_disabled` while its variant's control is off,
  because the new version is uploaded through the normal path and must pass the validators,
  which accept the compression only then. A promoted version is unpublished (`VALIDATED`, or
  `DRAFT` with asynchronous validation) and is published only by the explicit action and its
  gates.

**Texture preparation for KTX2** is explicit configuration (review fix F13). The preparer is
named (`pillow` or `passthrough`, `texture_prep.resolve_preparer`), never chosen by a silent
fallback, and the KTX2 report records it (`textures.preparer`). `pillow` uses Workstream D's
`prepare_texture` with its glTF profiles `texture-colour-gltf` (base colour, emissive) and
`texture-data-gltf` (normal, occlusion, metallic-roughness), which ignore embedded ICC profiles
and EXIF orientation (glTF defines texture colour and orientation itself; a test shows the same
pixels with and without them), keep data channels exact and write lossless PNG; a side that is
not a multiple of 4 or exceeds 4096 is resized with D's power-of-two fit. When Pillow is missing,
`pillow` fails with `preparer_unavailable` (the KTX2 step stops; nothing is skipped).
`passthrough` (never resizes, never re-encodes) exists for tests and tooling only. The worker
accepts only `pillow` (`LAI_KTX2_TEXTURE_PREPARER`, default `pillow`; anything else stops the
function at start-up).

## 7. Benchmarks, Meshopt (workstation, 2026-11-18)

`python3 native/gltf/bench.py --profile meshopt-conservative content/models/npc-pip-pirate.glb
react/public/models/*.glb`, gltfpack 1.3 native x86_64, run through `lai_native.runtime`. "Tool
s" and peak RSS are GNU `time` for the gltfpack process alone; "Step s" is the whole
`optimize_meshopt` call (tool, validation, inspection twice). GPU texture memory is
**calculated** (RGBA8 with mips; Meshopt does not change textures). **The host was heavily shared
during these runs (load average 25 to 40 on 4 vCPUs)**, so times are pessimistic and noisy; an
earlier, quieter run of the same profile measured 0.096 s and 18.3 MiB for gltfpack on the NPC.
The repository has 6 GLBs; the 116 `.gltf` files are not Asset Library inputs.

| Model | Source bytes (gzip -9) | Output bytes (gzip -9) | Output / source | Tool s (sum) | Tool peak RSS MiB (max) | Step s | Result | GPU texture MiB before (calc.) | after (calc.) |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| `content/models/npc-pip-pirate.glb` | 3,307,456 (2,086,790) | 941,508 (692,772) | 28.5% | 0.376 | 18.1 | 0.616 | preserved | 21.33 | 21.33 |
| `react/public/models/kaykit-floor-tile-large.glb` | 28,100 (14,254) | 20,740 (13,621) | 73.8% | 0.063 | 5.0 | 0.080 | preserved | 5.33 | 5.33 |
| `react/public/models/kaykit-floor-wood-large-dark.glb` | 35,616 (15,192) | 22,744 (14,280) | 63.9% | 0.067 | 4.9 | 0.120 | preserved | 5.33 | 5.33 |
| `react/public/models/kenney-rock-small.glb` | 23,796 (12,091) | 16,016 (11,402) | 67.3% | 0.067 | 4.8 | 0.100 | preserved | 1.33 | 1.33 |
| `react/public/models/kenney-tree-large.glb` | 28,784 (13,316) | 13,952 (11,159) | 48.5% | 0.086 | 4.9 | 0.111 | preserved | 1.33 | 1.33 |
| `react/public/models/kenney-tree-small.glb` | 23,352 (11,619) | 12,960 (10,344) | 55.5% | 0.018 | 4.9 | 0.038 | preserved | 1.33 | 1.33 |

Every output passed `validate_meshopt` with no error and the preservation check with no
difference (also asserted by `test_real_gltfpack_preserves_repository_models` when
`LAI_GLTFPACK_PATH` is set). Single runs. Not measured: arm64, Lambda, decode time in any browser or
tablet.

## 8. Lambda fit (extrapolated, not measured)

Lambda limits: 900 s, 10,240 MB memory, 10,240 MB `/tmp`, 250 MB unzipped zip. Linear
extrapolation from the NPC (3.3 MB, 0.1 to 0.4 s, 18 MiB) to the 50 MiB GLB ceiling (about 16x):
under 10 s and about 300 MiB for gltfpack, plus about 3 copies of the file in `/tmp` (well under
512 MB). KTX2 scales with texture pixels, not file size: the worst measured texture (2048x2048
ETC1S, 27 s and 234 MiB on the loaded host; 12 s unloaded in an earlier probe) times a plausible
worst case of 8 such textures per model is about 100 to 220 s single-threaded and about 250 MiB
(textures are encoded one at a time) on x86; a 4096 px texture is 4x the pixels. Lambda arm64
vCPU speed is not known here. The gltfpack binary is 4.1 MB and KTX-Software's `toktx` plus `libktx` are a few MB more
(sizes of the x86_64 files on disk). On these numbers the workload fits the zip-Lambda pattern by
a wide margin; this is **extrapolation**, the arm64 binary does not exist yet, and the runtime
choice stays open (ADR-070 O1).

## 9. Meshopt acceptance gate (before `LAI_GLB_MESHOPT=on` anywhere)

| # | Gate | State |
|---|---|---|
| 1 | Structural validity: `validate_meshopt` unit tests (synthetic GLBs: every field, mode, filter, fallback and header rule) | Done (62 tests) |
| 2 | Both validators call `validate_meshopt` behind the policy row; parity corpus extended with Meshopt cases; fallback buffers accepted only when enabled | Done (phase 2) |
| 3 | Policy version 3 and GLB processor version bump; earlier validations `processor_outdated` | Done (processor 1.2.0) |
| 4 | Loader: decoder registered on every `GLTFLoader`; real decode of a Meshopt GLB in Vitest; typed error without WebAssembly; preview fetches nothing | Done |
| 5 | Regressions: existing loader, cache, preview tests unchanged and passing | Done (targeted Vitest runs) |
| 6 | Animation and skin preservation on real models (hierarchy, joints, clip names and durations) | Done for the 6 repository GLBs (workstation) |
| 7 | Benchmarks recorded with labels | Done (section 7) |
| 8 | Publication gate re-checks the control at publish; promotion refuses while it is off | Done (phase 2) |
| 9 | Browser acceptance (desktop Chrome, Safari, Firefox): a Meshopt model renders and animates identically | **Pending, not done** |
| 10 | Device acceptance on the owner's tablets (Sprouts gate, LAI-2303): load time, frame rate, visual parity | **Pending, not done** |
| 11 | Production runtime decision (O1) for server-side jobs | **Open** |

## 10. `KHR_texture_basisu` / KTX2 validation (`compression/ktx2.py`)

Sources (read 2026-11-18): KTX 2.0 specification, Khronos Data Format specification, the
`KHR_texture_basisu` extension. Nothing is transcoded; each KTX2 file is read once, bounded by
the caller's image size limit. Error codes:

| Code | Rule |
|---|---|
| `ktx2_invalid` | not a KTX 2.0 file (identifier) |
| `ktx2_format` | `vkFormat` is not 0 (Basis Universal requires `VK_FORMAT_UNDEFINED`) |
| `ktx2_dimensions`, `texture_too_large` | width or height not a positive multiple of 4; a side above the limit (default 4096) |
| `ktx2_shape` | `pixelDepth` not 0, `layerCount` not 0 or `faceCount` not 1 |
| `ktx2_supercompression` | scheme not none, BasisLZ or Zstandard; global data on a non-BasisLZ file |
| `ktx2_color_model` | BasisLZ without the ETC1S model (163), or none/Zstandard without UASTC (166) |
| `ktx2_transfer` | DFD transfer function neither linear (1) nor sRGB (2) |
| `ktx2_levels` | `levelCount` 0 or above the full pyramid; BasisLZ level with an uncompressed length; UASTC level whose (uncompressed) length is not 16 bytes per 4x4 block |
| `ktx2_truncated` | level index, a level, key/value data or BasisLZ global data outside the file or inside the header |
| `ktx2_dfd` | missing or out-of-range data format descriptor |
| `ktx2_orientation` | `KTXorientation` present and not `rd` (glTF is top-left first) |
| `ktx2_invalid_source`, `ktx2_image_type` | the extension's `source` is not a valid image, or not `image/ktx2` |
| `ktx2_requires_extension` | no PNG/JPEG fallback `source` while the extension is not required |
| `ktx2_without_extension` | an `image/ktx2` image used through a plain `source` |
| `ktx2_not_declared`, `extension_required_not_used` | declaration consistency |
| `ktx2_mixed_color_usage`, `ktx2_color_space` | one image used as colour and data; transfer function not sRGB for base colour or emissive, or not linear for normal, occlusion or metallic-roughness |

Warnings: `ktx2_payload_not_decoded`, `ktx2_partial_mips`, `ktx2_fallback_present`. Facts:
`Ktx2Facts.as_metadata()` with per-image width, height, levels, codec, supercompression, colour
space and **calculated** GPU bytes (8 bpp transcoded, and the 32 bpp RGBA8 fallback a device
without compressed formats gets). The parser was checked against real toktx 4.4.2 ETC1S and
UASTC/Zstandard files and against KTX-Software's own `ktx validate`, which passes on every
texture the optimizer produced from the repository models.

## 11. KTX2 optimizer (`lai_native.optimize.ktx2`)

`optimize_ktx2(source, tools=..., workspace=..., prepare=...)` with profile `ktx2-basisu/v1`
(`profiles.py`): colour textures (base colour, emissive) as ETC1S, `--assign_oetf srgb`; data
textures (normal, occlusion, metallic-roughness) as UASTC level 2 with Zstandard 18,
`--assign_oetf linear`; full mip chains; BT.709 primaries; no flip (`KTXorientation rd`);
`--threads 1`. A texture no core slot uses, or an image used both ways, fails the job instead of
guessing a colour space. Images go through Workstream D's `prepare_texture(data, profile)`
(`texture_prep.py` is the seam; the `passthrough` preparer, tests only, resizes nothing and refuses
sides that are not multiples of 4 with `texture_needs_resize`). The GLB is rewritten with
`glbwrite.repack` (Meshopt ranges are relocated intact, so Meshopt then KTX2 works and is
tested); images become `image/ktx2`, textures move `source` into
`extensions.KHR_texture_basisu.source` with no fallback, and the extension is required. The job
fails on any `validate_basisu` error, any preservation difference (textures rule `ktx2`), output
above 1.5x the source (`size_limit`), or no calculated GPU memory reduction (`no_gpu_gain`).
The worker accepts `profile: "ktx2-basisu"` only while `LAI_GLB_KTX2` is on.

## 12. Benchmarks, KTX2 (workstation, 2026-11-18)

`python3 native/gltf/bench.py --profile ktx2-basisu ...`, toktx 4.4.2 x86_64, same loaded host
as section 7 (times pessimistic). GPU memory columns are **calculated**: before, RGBA8 with mips
for PNG/JPEG; after, 8 bpp with mips for the transcoded format (ETC1S without alpha may use
4 bpp on ETC1/BC1 targets, so "after" is an upper bound unless the device has no compressed
format, in which case it is the 32 bpp fallback, equal to "before").

| Model | Source bytes (gzip -9) | Output bytes (gzip -9) | Output / source | Tool s (sum) | Tool peak RSS MiB (max) | Step s | Result | GPU texture MiB before (calc.) | after (calc.) |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| `content/models/npc-pip-pirate.glb` | 3,307,456 (2,086,790) | 3,445,632 (2,234,001) | 104.2% | 27.146 | 233.7 | 28.161 | preserved | 21.33 | 5.33 |
| `react/public/models/kaykit-floor-tile-large.glb` | 28,100 (14,254) | 32,964 (23,047) | 117.3% | 8.891 | 68.3 | 8.893 | preserved | 5.33 | 1.33 |
| `react/public/models/kaykit-floor-wood-large-dark.glb` | 35,616 (15,192) | 40,484 (24,037) | 113.7% | 4.670 | 68.2 | 4.672 | preserved | 5.33 | 1.33 |
| `react/public/models/kenney-rock-small.glb` | 23,796 (12,091) | 23,420 (13,374) | 98.4% | 0.607 | 21.4 | 0.617 | preserved | 1.33 | 0.33 |
| `react/public/models/kenney-tree-large.glb` | 28,784 (13,316) | 32,364 (16,834) | 112.4% | 0.845 | 21.0 | 0.858 | preserved | 1.33 | 0.33 |
| `react/public/models/kenney-tree-small.glb` | 23,352 (11,619) | 26,932 (15,125) | 115.3% | 1.396 | 21.2 | 1.406 | preserved | 1.33 | 0.33 |

Findings: KTX2 does not shrink these files (98% to 117% of the source) and makes gzip less
effective; the gain is calculated GPU texture memory, 4x lower on every model (NPC 21.33 to
5.33 MiB). Every output kept geometry, animation, materials and samplers (preservation check)
and every texture passed `ktx validate`. Visual quality of ETC1S at `--qlevel 128` was **not**
inspected on any screen.

## 13. KTX2 acceptance gate (before `LAI_GLB_KTX2=on` anywhere)

| # | Gate | State |
|---|---|---|
| 1 | Structural validity: `parse_ktx2` / `validate_basisu` unit tests (synthetic containers, every header, level, DFD, orientation and glTF rule) | Done (45 tests) |
| 2 | Both validators call `validate_basisu` behind the policy row; `image/ktx2` accepted only for basisu images; parity corpus extended | Done (phase 2) |
| 3 | Policy version and GLB processor version bump | Done (processor 1.2.0) |
| 4 | Loader: `KTX2Loader` with bundled transcoder, `detectSupport(renderer)`, worker limit, disposal with the engine, refused external URLs, typed error | Done (Vitest, configuration level; jsdom cannot run the transcoder workers) |
| 5 | Admin preview shows KTX2 models | Code done (renderer before parsing); **the deployed bundle has KTX2 off** until the transcoder is served from Django (O7) |
| 6 | Real transcode in a browser (desktop Chrome, Safari, Firefox): textures render with correct colour space and orientation | **Pending, not done** |
| 7 | Device acceptance on the owner's tablets: transcode target (ASTC/ETC2), load time, memory, visual parity of ETC1S colour textures | **Pending, not done** |
| 8 | Image preparation through Workstream D's module (resize to multiples of 4, size cap, metadata) | Done (`pillow_texture`; tested with Pillow 13.0.0 and real toktx on the workstation) |
| 9 | Benchmarks recorded with labels | Done (section 12) |
| 10 | Production runtime decision (ADR-070 O1) | **Open** |
