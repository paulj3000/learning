# GLB optimization: Meshopt, then KTX2 (LAI-LAMBDA-010, ADR-070)

Status (2026-11-18, branch `feature/lambda-meshopt-ktx2`): loader support, validation modules,
native optimizer, worker skeleton, pinned tooling and workstation benchmarks are implemented.
**Nothing is enabled**: `LAI_GLB_MESHOPT` and `LAI_GLB_KTX2` default to `off`, the validators'
policy rows are wired by the principal at integration, and device and browser acceptance is
pending. No AWS call, deployment, layer or image was made.

Labels used for every number: **workstation** (x86_64, Intel Core i7-12700K, 4 vCPUs visible,
7.9 GB RAM, Python 3.12.3, measured), **calculated** (formula), **extrapolated** (arithmetic on
workstation numbers, not a measurement). There is no ARM64, Lambda, device or browser evidence.

## 1. What is where

| Piece | Path |
|---|---|
| Compression support policy (`compression_support`, controls) | `processing/lai_processing/processors/gltf/compression/policy.py` |
| `EXT_meshopt_compression` validation (stdlib) | `processing/lai_processing/processors/gltf/compression/meshopt.py` |
| `KHR_texture_basisu` / KTX2 validation (stdlib) | `processing/lai_processing/processors/gltf/compression/ktx2.py` (KTX2 phase) |
| Loader decoders | `react/src/features/island-map/three/assets/gltfDecoders.ts`, used by `assetLoader.ts` and `features/assets/preview/previewModelSource.ts` |
| Optimizer (native tools) | `processing/lai_native/optimize/` (`profiles`, `signature`, `meshopt`, `textures`, `runner` + temporary `_tool` shim) |
| Worker skeleton | `lambda/optimize_worker/` (`task.run_optimize`, `handler.handle`) |
| Pinned tools, fetch script, benchmark | `native/gltf/` (`tools.lock`, `fetch-tools.sh`, `bench.py`, `README.md`) |
| Tests | `tests/processing/test_processing_gltf_meshopt.py`, `tests/processing/meshopt_builder.py`, `tests/native/`, `react/src/features/island-map/three/assets/gltfDecoders.test.ts`, `react/src/test/compressedGltfFixtures.ts` |

## 2. Integration with the validators (principal, after Workstream B)

Workstream B's `processing/lai_processing/processors/gltf/extension_policy.py` (branch
`feature/lambda-security-hardening`, `POLICY_VERSION = 2`) is the one table both validators
import. Today it lists `EXT_meshopt_compression`, `KHR_meshopt_compression`,
`KHR_draco_mesh_compression` and `KHR_texture_basisu` as `Support.DECODER` (error
`needs_decoder`). The enablement is a row change there, not a second table:

1. Add a status and a control map, and make classification depend on the enabled controls
   (which Django reads from settings and passes in the validation profile; the processor never
   reads the environment):

   ```python
   class Support(StrEnum):
       SUPPORTED = "supported"
       WHEN_ENABLED = "supported_when_enabled"   # new: gated by a control, default off
       DECODER = "decoder"
       REJECTED = "rejected"

   POLICY_VERSION: Final = 3                      # verdicts change when a control is on
   CONTROLS: Final = {"EXT_meshopt_compression": "LAI_GLB_MESHOPT",
                      "KHR_texture_basisu": "LAI_GLB_KTX2"}
   # rows: EXT_meshopt_compression and KHR_texture_basisu move from _DECODER to WHEN_ENABLED;
   # KHR_meshopt_compression and KHR_draco_mesh_compression stay DECODER (rejected).

   def error_code(name: str, enabled: frozenset[str] = frozenset()) -> str | None:
       status = TABLE.get(name)
       if status is Support.SUPPORTED:
           return None
       if status is Support.WHEN_ENABLED:
           return None if CONTROLS[name] in enabled else "needs_decoder"
       return "needs_decoder" if status is Support.DECODER else "unsupported_extension"
   ```

   `compression.policy.compression_support(name)` returns the same statuses and can be used to
   generate or test those rows (`tests/processing/test_processing_gltf_meshopt.py` pins them).
2. Bump the GLB processor version (B set `1.1.0`; this makes it `1.2.0`), so earlier
   validations become `processor_outdated` at the publication gate.
3. When `EXT_meshopt_compression` is allowed and present, call
   `validate_meshopt(document, report, buffer_lengths=..., read=..., check=...)` from both
   validators, and let the buffer check accept the buffers in `fallback_buffer_indices(document)`
   without data (today they fail as `missing_buffer`). Accessor range checks are unchanged: they
   use the parent view's decoded `byteLength`.
4. When `KHR_texture_basisu` is allowed, call the KTX2 module (KTX2 phase) and accept
   `image/ktx2` only for images it validated.
5. The publication gate re-checks the control at publish time (a compressed version is
   publishable only while its control is on).

`gltfpack` **can** emit `KHR_meshopt_compression` (`-ce khr`, and `-cz`; verified in the 1.3
source, `gltf/gltfpack.cpp`). The Khronos specification is a **Release Candidate**, not ratified
(read 2026-11-18), so it stays rejected; the optimizer pins `-ce ext`.

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

## 5. Optimizer (`lai_native.optimize`)

`optimize_meshopt(source, tools=ToolPaths(...), workdir=...)` with profile
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

Failure codes: `source_unreadable`, `source_already_compressed`, `tool_not_found`,
`tool_timeout`, `tool_failed`, `no_size_gain`, `output_invalid`, `output_unreadable`,
`preservation_failed`, `profile_mismatch`. The report (`lai.optimize_report/1`) records profile,
tool argv, sizes and SHA-256 of both files, geometry summaries, Meshopt facts, calculated texture
GPU memory, clip durations, processing time and the tool's wall time and peak RSS.

The tool runner is a temporary shim (`_tool.py`, replaced by Workstream C's
`lai_native.runtime` at integration; `runner.py` is the only importer). Its peak RSS comes from
`os.wait4` and can include the forked Python image before `exec`, so it is an upper bound; the
benchmark uses GNU `time` instead.

## 6. Worker skeleton (`lambda/optimize_worker`)

`task.run_optimize(payload, ports)` (payload `storage_key`, `format: "glb"`, `profile`,
optional `max_bytes`): refuses with `optimization_disabled` while the profile's control is off,
reads through the existing read-only asset ports (50 MiB ceiling), runs the optimizer in a
private `/tmp` directory (removed afterwards), and writes `model.optimized` and
`model.optimize_report` through a create-only `put_artifact` port. `handler.handle` mirrors
`jobs_worker.handler.process` (stored-result redelivery, `running`, final result, batch item
failures); the envelope module and runtime are injected because `asset.optimize` and its queue
are registered by Workstream A. `StubArtifactPort` is an in-memory stand-in for A's writer. No
packaging and no infrastructure (Workstream G, and open decision O1).

## 7. Benchmarks, Meshopt (workstation, 2026-11-18)

`python3 native/gltf/bench.py content/models/npc-pip-pirate.glb react/public/models/*.glb`,
gltfpack 1.3 native x86_64, profile `meshopt-conservative/v1`. Times and peak RSS are GNU `time`
for the gltfpack process alone; "Step" is the whole `optimize_meshopt` call (tool, validation,
inspection twice). GPU texture memory is **calculated** (RGBA8 with mips; Meshopt does not change
textures). The repository has 6 GLBs; the 116 `.gltf` files are not Asset Library inputs.

| Model | Source bytes (gzip -9) | Output bytes (gzip -9) | Output / source | gltfpack s | gltfpack peak RSS MiB | Step s | Preserved | GPU texture MiB (calc.) |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| `content/models/npc-pip-pirate.glb` (skinned, 65 joints, 4 clips) | 3,307,456 (2,086,790) | 941,508 (692,772) | 28.5% | 0.096 | 18.3 | 0.500 | yes | 21.33 |
| `react/public/models/kaykit-floor-tile-large.glb` | 28,100 (14,254) | 20,740 (13,621) | 73.8% | 0.004 | 4.9 | 0.036 | yes | 5.33 |
| `react/public/models/kaykit-floor-wood-large-dark.glb` | 35,616 (15,192) | 22,744 (14,280) | 63.9% | 0.008 | 4.9 | 0.015 | yes | 5.33 |
| `react/public/models/kenney-rock-small.glb` | 23,796 (12,091) | 16,016 (11,402) | 67.3% | 0.006 | 5.0 | 0.016 | yes | 1.33 |
| `react/public/models/kenney-tree-large.glb` | 28,784 (13,316) | 13,952 (11,159) | 48.5% | 0.009 | 4.9 | 0.088 | yes | 1.33 |
| `react/public/models/kenney-tree-small.glb` | 23,352 (11,619) | 12,960 (10,344) | 55.5% | 0.077 | 4.9 | 0.030 | yes | 1.33 |

Every output passed `validate_meshopt` with no error and the preservation check with no
difference (also asserted by `test_real_gltfpack_preserves_repository_models` when
`LAI_GLTFPACK` is set). Single runs; sub-0.1 s timings are noisy. Not measured: arm64, Lambda,
decode time in any browser or tablet.

## 8. Lambda fit (extrapolated, not measured)

Lambda limits: 900 s, 10,240 MB memory, 10,240 MB `/tmp`, 250 MB unzipped zip. Linear
extrapolation from the NPC (3.3 MB, 0.096 s, 18.3 MiB) to the 50 MiB GLB ceiling (about 16x):
about 1.5 s and about 300 MiB for gltfpack, plus about 3 copies of the file in `/tmp` (well under
512 MB). The gltfpack binary is 4.1 MB and KTX-Software's `toktx` plus `libktx` are a few MB more
(sizes of the x86_64 files on disk). On these numbers the workload fits the zip-Lambda pattern by
a wide margin; this is **extrapolation**, the arm64 binary does not exist yet, and the runtime
choice stays open (ADR-070 O1).

## 9. Meshopt acceptance gate (before `LAI_GLB_MESHOPT=on` anywhere)

| # | Gate | State |
|---|---|---|
| 1 | Structural validity: `validate_meshopt` unit tests (synthetic GLBs: every field, mode, filter, fallback and header rule) | Done (62 tests) |
| 2 | Both validators call `validate_meshopt` behind the policy row; parity corpus extended with Meshopt cases; fallback buffers accepted only when enabled and required | **Pending integration** (principal, after B) |
| 3 | Policy version 3 and GLB processor version bump; earlier validations `processor_outdated` | **Pending integration** |
| 4 | Loader: decoder registered on every `GLTFLoader`; real decode of a Meshopt GLB in Vitest; typed error without WebAssembly; preview fetches nothing | Done |
| 5 | Regressions: existing loader, cache, preview tests unchanged and passing | Done (targeted Vitest runs) |
| 6 | Animation and skin preservation on real models (hierarchy, joints, clip names and durations) | Done for the 6 repository GLBs (workstation) |
| 7 | Benchmarks recorded with labels | Done (section 7) |
| 8 | Publication gate re-checks the control at publish | **Pending** (B's gate, at integration) |
| 9 | Browser acceptance (desktop Chrome, Safari, Firefox): a Meshopt model renders and animates identically | **Pending, not done** |
| 10 | Device acceptance on the owner's tablets (Sprouts gate, LAI-2303): load time, frame rate, visual parity | **Pending, not done** |
| 11 | Production runtime decision (O1) for server-side jobs | **Open** |
