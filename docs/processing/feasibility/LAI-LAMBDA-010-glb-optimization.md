# LAI-LAMBDA-010: GLB and texture optimization feasibility

Status: **feasibility study, documentation, benchmark harness and policy-pinning tests only**
(2026-11-17, branch `feature/w4-optimization-feasibility`; updated by Workstream D on
`feature/lambda-glb-optimization-design` with measurements, the exact Three.js change list
(4.7), the backend plan (4.8) and the heavy-workload fallback (7.1)). Nothing here is approved scope. No tool was added to any
requirements file, `processing/lai_processing`, the Lambda worker zip or `package.json`; no
compressed format is enabled in a loader or a validator; nothing was deployed or sent to AWS.

Read with: ADR-020, ADR-055, ADR-061, ADR-062 and ADR-064 (`docs/DECISIONS.md`);
`docs/processing/CANONICAL_PATH.md`, `GLB_VALIDATION.md`, `WAVE4_HANDOFF.md`;
`docs/ASSET_LIBRARY.md`. Proposed decision: `docs/processing/proposals/ADR-PROPOSED-glb-optimization.md`.
Harness: `scripts/processing/bench/` (`optimization_bench.md`).

**Coordination with LAI-LAMBDA-013.** 013 owns image conversion, thumbnails and the texture
resize pipeline ("013 owns image resize"), and the derived-artifact write path it designs
(Wave 4 owner decision W4-4). This study does not design a second image pipeline: every texture
resize or re-encode in 010 calls 013's imaging module, and 010's outputs use 013's
derived-artifact design.

## 1. Summary

| Question | Answer (evidence in the sections below) |
|---|---|
| Can the game load meshopt, Draco or KTX2 output today? | **No.** Neither `GLTFLoader` construction site configures a decoder (section 4.1), and both validators refuse all three extensions with `needs_decoder` (section 4.3) |
| Are decoder assets shipped? | **No.** They exist only in `node_modules/three/examples/jsm/libs/` (three 0.185.1); nothing imports them, and `react/public/` has no decoder files (section 4.2) |
| What do the repository's models weigh? | 6 GLBs, 23 KB to 3.3 MB; one skinned NPC (3.3 MB) is 66% vertex data. 116 self-contained `.gltf` files total 2.73 MB (section 2) |
| Are models compressed in transit today? | **Probably not, for either delivery path.** CloudFront's compressible list does not include `model/gltf-binary` or `model/gltf+json`, and the `/api/*` behavior does not enable compression; no gzip setting was found in the nginx template or Django (section 4.4). Measured gzip estimates: GLBs 37% to 57% smaller, `.gltf` files 76% smaller |
| Is any optimization tool installed here? | Not in the repository or on the PATH. Workstream D installed `gltfpack` 1.3 (npm, WASM build), `gltf-transform` 4.5.1 and `toktx` 4.4.2 into a throwaway directory outside the repository and **measured 8 repository models** (section 6.2). Native `gltfpack` (the one that can emit KTX2), `basisu`, `draco_encoder` and Blender were not measured |
| Recommended runtime | None yet. First measure on a workstation; then optimize **at authoring time** (staff tool, output uploaded as a new version) before any server-side `asset.optimize` kind. If server-side is approved later: a separate arm64 Lambda function with a native `gltfpack` built from source, packaging decided by the native-tool ADR (section 7) |

## 2. Baseline (measured)

Measured with `scripts/processing/bench/glb_baseline.py` (the existing validator
`asset.glb_validator` 1.0.0, profile `glb-default` defaults) at commit
`2333d9edf2f1f73cf26149e91bc2005e34fc7687`, 2026-11-17, Python 3.12.3, Linux x86_64. `brotli` is
not installed in `/Coding/ENV`, so brotli columns are empty (skipped, not estimated).

Command: `/Coding/ENV/bin/python scripts/processing/bench/glb_baseline.py --format csv`

### 2.1 GLB files

| File | Verdict | Bytes | gzip -6 | gzip -9 | gzip -9 / file | Vertices | Triangles | Meshes / prims | Materials | Textures (images) | Image | Anims | Skins / joints | Extensions used | Generator |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---|---|---:|---|---|---|
| `content/models/npc-pip-pirate.glb` | pass | 3,307,456 | 2,089,466 | 2,086,790 | 63.1% | 41,957 | 73,642 | 1 / 1 | 1 | 1 (1) | 2048x2048 JPEG | 4 | 1 / 65 | `KHR_materials_ior`, `KHR_materials_specular` | glTF-Transform v4.1.1 |
| `react/public/models/kaykit-floor-tile-large.glb` | pass | 28,100 | 14,265 | 14,254 | 50.7% | 311 | 188 | 1 / 1 | 1 | 1 (1) | 1024x1024 PNG | 0 | 0 / 0 | none | Khronos glTF Blender I/O v0.9.36 |
| `react/public/models/kaykit-floor-wood-large-dark.glb` | pass | 35,616 | 15,232 | 15,192 | 42.7% | 530 | 272 | 1 / 1 | 1 | 1 (1) | 1024x1024 PNG | 0 | 0 / 0 | none | Khronos glTF Blender I/O v0.9.36 |
| `react/public/models/kenney-rock-small.glb` | pass | 23,796 | 12,096 | 12,091 | 50.8% | 216 | 128 | 1 / 1 | 1 | 1 (1) | 512x512 PNG | 0 | 0 / 0 | `KHR_texture_transform` | UnityGLTF |
| `react/public/models/kenney-tree-large.glb` | pass | 28,784 | 13,327 | 13,316 | 46.3% | 377 | 229 | 1 / 1 | 1 | 1 (1) | 512x512 PNG | 0 | 0 / 0 | `KHR_texture_transform` | UnityGLTF |
| `react/public/models/kenney-tree-small.glb` | pass | 23,352 | 11,630 | 11,619 | 49.8% | 272 | 164 | 1 / 1 | 1 | 1 (1) | 512x512 PNG | 0 | 0 / 0 | `KHR_texture_transform` | UnityGLTF |

No file uses `extensionsRequired`; none uses a compression extension.

### 2.2 Byte breakdown by role (same run)

Image bytes are the image buffer views' `byteLength`; the other roles are `count x element size`
of the accessors they reference (a tightly packed estimate that ignores stride padding).

| File | JSON chunk | BIN chunk | Images | Vertex attributes | Indices | Animation | Skin IBMs | Image share of file |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `npc-pip-pirate.glb` | 176,892 | 3,130,536 | 230,737 | 2,181,764 | 441,852 | 267,144 | 4,160 | 7.0% |
| `kaykit-floor-tile-large.glb` | 1,196 | 26,876 | 15,794 | 9,952 | 1,128 | 0 | 0 | 56.2% |
| `kaykit-floor-wood-large-dark.glb` | 1,200 | 34,388 | 15,794 | 16,960 | 1,632 | 0 | 0 | 44.3% |
| `kenney-rock-small.glb` | 1,872 | 21,896 | 11,143 | 10,368 | 384 | 0 | 0 | 46.8% |
| `kenney-tree-large.glb` | 1,752 | 27,004 | 7,529 | 18,096 | 1,374 | 0 | 0 | 26.2% |
| `kenney-tree-small.glb` | 1,752 | 21,572 | 7,529 | 13,056 | 984 | 0 | 0 | 32.2% |

Observations (arithmetic on the measured numbers, not tool results):

- The NPC's weight is geometry: vertex attributes are 66.0% of the file (about 52 bytes per
  vertex, which matches float position, normal and UV plus joints and weights) and indices
  13.4%. This is the payload that quantization and `EXT_meshopt_compression` target; whether
  and how much they shrink it is **not measured** (no tool installed).
- The NPC's single 2048x2048 JPEG is small on the wire (231 KB) but large on the GPU: as
  uncompressed RGBA8 with a full mip chain it occupies about 22.4 MB (2048 x 2048 x 4 x 4/3).
  A block-compressed GPU format at 8 bits per pixel (ASTC 4x4, BC7, ETC2 RGBA) would be about
  5.6 MB, and at 4 bpp (ETC1/ETC2 RGB, BC1) about 2.8 MB. These are format-defined bit rates,
  not measurements, and depend on what the device can transcode to (section 4.5).
- The five small kit pieces are 23 KB to 36 KB; there is little to gain per file. Their
  textures are 512 to 1024 px, again larger on the GPU (1024x1024 RGBA8 with mips is about
  5.6 MB) than on the wire.

### 2.3 Self-contained `.gltf` files (sizes only)

`glb_baseline.py --include-gltf` lists 116 `.gltf` files in `react/public/models/` totalling
2,734,212 bytes (655,842 with gzip -9, 24.0%). The GLB validator validates GLB only
(`gltf_not_supported`), so these rows carry sizes only. The largest:

| File | Bytes | gzip -9 |
|---|---:|---:|
| `react/public/models/npc-professor-ticktock.gltf` | 1,190,838 | 284,600 |
| `react/public/models/npc-harbor-master.gltf` | 872,935 | 236,469 |
| `react/public/models/hearth-lit.gltf` | 20,893 | 1,947 |

The remaining 113 files are each under 19 KB. Embedded base64 buffers are about 4/3 of their
binary size, which is why gzip helps so much here.

## 3. Tool evaluation

Sources: the meshoptimizer repository and its `gltf/README.md`
(https://github.com/zeux/meshoptimizer, read 2026-11-17), the meshoptimizer releases page, the
KTX-Software releases page (https://github.com/KhronosGroup/KTX-Software/releases, read
2026-11-17), the Draco repository (https://github.com/google/draco), the Basis Universal
repository (https://github.com/BinomialLLC/basis_universal), and the AWS Lambda quotas page
(https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html, read 2026-11-17).
Licences repeat `WAVE4_HANDOFF.md` section 4 and the projects' licence files; **anything marked
"unverified" was not confirmed from a primary source in this study.**

Lambda limits used below (AWS quotas page, 2026-11-17): memory 128 to 10,240 MB (one vCPU
equivalent at 1,769 MB); timeout 900 s; `/tmp` 512 to 10,240 MB; zip 50 MB zipped (direct
upload) and 250 MB unzipped including layers; container image 10 GB uncompressed; 5 layers.

| Tool | Supported formats | Native dependencies | Licence | ARM64 availability | Lambda feasibility | Memory | Disk (`/tmp`) | Runtime | Potential package size |
|---|---|---|---|---|---|---|---|---|---|
| **gltfpack** (part of meshoptimizer) | In: glTF/GLB, OBJ (and `.ply` splats). Out: GLB/glTF with `KHR_mesh_quantization`, `KHR_texture_transform`, `EXT_meshopt_compression` (`-c`, `-cc`), `KHR_meshopt_compression` (`-ce khr`), `KHR_texture_basisu` (`-tc`, `-tu`), `EXT_texture_webp` (`-tw`), `EXT_mesh_gpu_instancing` (`-mi`); simplification `-si` | Self-contained C++ binary; texture compression is built into the native build per the README (the README says native binaries, not the npm build, "support texture compression") | MIT (repository `LICENSE.md`) | Releases ship prebuilt binaries; macOS builds are AArch64 only (v1.3 notes). **Linux aarch64 prebuilt: unverified**; building from source with CMake on arm64 is the safe assumption | Separate function. A single static binary could fit a zip or a layer, but rule 2 of `WAVE4_HANDOFF.md` forbids `subprocess` in `lai_processing`, and ADR-064 requires an ADR for any native tool, so packaging is the ADR's decision | **Unverified**; to be measured by the harness (`child_max_rss_kib`). Whole-file in memory | Input + output copies; well under 512 MB for the 50 MiB input ceiling | **Unmeasured** (not installed) | Binary size **unverified** (expected a few MB) |
| **meshoptimizer** (library) | Mesh-level: vertex cache, overdraw, fetch optimization, simplification, the meshopt codec | C/C++ library; JavaScript and WASM builds on npm (`meshoptimizer` package, MIT) | MIT | Builds anywhere C++ builds | Through `gltfpack`; there is no Python binding in this repository and none is proposed | n/a | n/a | n/a | n/a |
| **Draco** (`draco_encoder`, `draco_transcoder`) | Encodes meshes to `KHR_draco_mesh_compression` (glTF transcoder in recent releases) | C++ library and tools | Apache-2.0 | Builds from source on arm64 (**prebuilt Linux arm64: unverified**) | Same as gltfpack; the glTF-Transform CLI is the more common way to emit Draco glTF and needs Node.js | **Unverified** | Small | **Unmeasured** | **Unverified** |
| **Basis Universal** (`basisu`) | PNG/JPEG (and others) to `.basis` / `.ktx2` (ETC1S or UASTC) | C++ encoder, optional OpenCL | Apache-2.0 | Builds from source on arm64 (**prebuilt: unverified**) | Texture-only; would run on images that 013 extracts and resizes | **Unverified**; UASTC RDO encoding is known to be CPU-heavy (**unverified for these textures**) | Small | **Unmeasured** | **Unverified** |
| **KTX-Software** (`toktx`, `ktx create`, `libktx`) | Images to KTX2 with Basis (ETC1S/UASTC) and Zstandard supercompression; validation (`ktx validate`) | C/C++; bundles the Basis encoder | Apache-2.0 (plus third-party notices in the package) | **Yes**: v4.4.2 ships `KTX-Software-4.4.2-Linux-arm64.deb` and `.rpm` (releases page, 2026-11-17) | Texture-only; container or a layer built from the RPM; ADR needed | **Unverified** | Small | **Unmeasured** | **Unverified** (tens of MB expected for the package, not measured) |
| **Texture resizing** | Downscale to a target side (for example 1024) before or instead of GPU compression | Pillow or libvips (013's decision) | Pillow HPND, libvips LGPL-2.1 | Wheels exist for both on aarch64 (**013 verifies**) | **Owned by LAI-LAMBDA-013.** 010 calls 013's module; it does not add its own | 013 | 013 | 013 | 013 (zip if wheels fit) |
| **Mesh simplification** | Triangle reduction (`gltfpack -si`, meshoptimizer `simplify`) | As gltfpack | MIT | As gltfpack | As gltfpack | As gltfpack | Small | **Unmeasured** | As gltfpack |

What the table does **not** support: any statement that one tool saves N%. That requires the
harness run in section 6 with the tools installed.

## 4. Three.js compatibility audit (actual code)

### 4.1 GLTFLoader configuration

There is no top-level `game/` directory in this checkout; the Three.js asset code is in
`react/src/features/island-map/three/assets/`. `three` is `^0.185.1` (root and
`react/package.json`; installed 0.185.1). The only two places that construct a `GLTFLoader` in
non-test code:

| Site | Code | Decoders |
|---|---|---|
| `react/src/features/island-map/three/assets/assetLoader.ts:80` | `const loader = new GLTFLoader();` in `createGltfFetcher()` (game and NPC models, through the asset resolver; `npcModelLoader.ts` reuses it via `loadAsset`) | none: no `setDRACOLoader`, `setKTX2Loader` or `setMeshoptDecoder` |
| `react/src/features/assets/preview/previewModelSource.ts:168` | `const loader = new GLTFLoader(manager);` in `parsePreviewModel()` (Django Admin preview), with a `LoadingManager` URL modifier (`:162-167`) that blanks every non-`data:`/`blob:` URL and then fails the preview | none |

A search of `react/src` for `DRACOLoader`, `KTX2Loader`, `MeshoptDecoder`, `setDRACOLoader`,
`setKTX2Loader` and `setMeshoptDecoder` finds no use. Consequence in three 0.185.1
(`node_modules/three/examples/jsm/loaders/GLTFLoader.js`): a primitive with
`KHR_draco_mesh_compression` throws `No DRACOLoader instance provided` (`:1918`); a required
`EXT_meshopt_compression` throws `setMeshoptDecoder must be called before loading compressed
files` (`:1621`); a required `KHR_texture_basisu` throws `setKTX2Loader must be called before
loading KTX2 textures` (`:1478`). Tests already guard against silent extension drops
(`kenneyImports.test.ts:264`, `castleKit.test.ts:368`).

### 4.2 Decoder assets

Not shipped. `react/public/` contains `favicon.svg`, `fonts/` and `models/` only, and no source
imports a decoder. The decoders exist in the installed `three` package (sizes measured
2026-11-17; gzip -9 by Python's `gzip`):

| File (`node_modules/three/examples/jsm/libs/`) | Bytes | gzip -9 | Notes |
|---|---:|---:|---|
| `meshopt_decoder.module.js` | 29,256 | 7,707 | WASM embedded in the module (base and SIMD builds); no separate fetch |
| `draco/draco_decoder.wasm` + `draco_wasm_wrapper.js` | 285,747 + 58,763 | 88,100 + 11,765 | `DRACOLoader`'s default (`import.meta.url`-relative, `DRACOLoader.js:17-19`) |
| `draco/gltf/draco_decoder.wasm` + `draco_wasm_wrapper.js` | 192,420 + 58,456 | 63,164 + 11,612 | glTF-only decoder build, smaller |
| `basis/basis_transcoder.wasm` + `.js` | 527,333 + 57,529 | 244,553 + 15,063 | `KTX2Loader`'s default (`import.meta.url`-relative, `KTX2Loader.js:106-107`) |

Because the Draco and KTX2 defaults use `new URL(..., import.meta.url)`, a Vite build would
probably emit them as hashed files under `dist/assets/` once imported. **Unverified**: no build
was run for this study.

The `meshoptimizer` npm package found in the shared `node_modules` is extraneous (`npm ls`
reports it as not declared by any `package.json`) and is unused; do not rely on it.

### 4.3 Asset Library and processor validation: all three extensions are refused

| Validator | Where | Behaviour |
|---|---|---|
| Django (`lai/apps/assets/validation.py`) | `:47` comment "Extensions three.js's GLTFLoader handles with no extra decoder (the app configures none)"; `:48-64` `SUPPORTED_EXTENSIONS` (includes `KHR_mesh_quantization` `:61` and `KHR_texture_transform`); `:65-67` `NEEDS_DECODER = frozenset({"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"})`; `:370-375` in `_check_extensions`: `if name in NEEDS_DECODER: result.error("needs_decoder", f"{name} needs a decoder the game does not load. Export without compression.", "extensionsUsed")` | **Refused** (error, version `REJECTED`) whether the extension is used or required |
| Django image types | `:69` `IMAGE_TYPES` PNG and JPEG only; `:516-517` `image_type` "Textures must be PNG or JPEG." | A KTX2 image (`image/ktx2`) is also refused |
| Processor (`processing/lai_processing/processors/gltf/document.py`) | `:59-74` `SUPPORTED_EXTENSIONS` (same set); `:76-78` `NEEDS_DECODER` (same set); `:518-524` `if name in NEEDS_DECODER: ... self.error("needs_decoder", "The model uses a compression extension that needs a decoder the game does not load. Export without compression.", "extensionsUsed")`; `:540` `self.quantized = "KHR_mesh_quantization" in used \| required` | **Refused** (verdict `fail`) |
| Processor image types | `:81` `ALLOWED_IMAGE_TYPES = frozenset({PNG, JPEG})`; `:819` and `:884` `image_type` | KTX2 refused |
| Drift guard | `test_processing_glb_parity.py` reads `SUPPORTED_EXTENSIONS` and `NEEDS_DECODER` from `validation.py` with `ast` and requires equality (`GLB_VALIDATION.md` section 7) | A change must land in both files together |

`KHR_mesh_quantization` and `KHR_texture_transform` are already accepted by both validators and
need no decoder, so a quantization-only output (for example `gltfpack` without `-c` and without
`-tc`) **may** pass validation and load today. That is a hypothesis for the benchmark, not a
result: the processor checks quantized `POSITION` types only when the extension is declared, and
no such file has been produced here.

Documentation drift found: `docs/ASSET_LIBRARY.md:89-90` lists Draco and meshopt as not accepted
but omits `KHR_texture_basisu`, which the code also refuses. Not changed by this study (one-line
fix for the Asset Library owner).

### 4.4 Asset delivery and content types

| Path | Content type | Compression in transit |
|---|---|---|
| Asset Library models (production: `LAI_ASSET_STORAGE=s3`, `LAI_ASSET_DELIVERY=django`, `lai/config/settings/base.py:215-225`, `production.py:70-72`) | `model/gltf-binary` / `model/gltf+json` from `lai/apps/assets/formats.py:31-32`, stored with the object (`storage.py:242-252`) and sent by `FileResponse(stream, content_type=version.content_type)` (`views.py:93`) under `/api/v1/asset-files/...` (`urls.py:13`, `lai/config/urls.py:34`) | The CloudFront `/api/*` behavior (`infra/lib/frontendStack.ts:176-190`) sets no `compress` (only the default behavior has `compress: true`, `:170`); no gzip directive was found in `deploy/native/nginx.conf.template` or Django settings. **Likely uncompressed; verify with a live response header** |
| Asset Library, `LAI_ASSET_DELIVERY=s3` (not the production choice) | Presigned S3 URL with `ResponseContentType` (`storage.py:310-322`) | S3 does not compress |
| Bundled `react/public/models/*` (site bucket through CloudFront) | Set by `aws s3 sync` in `scripts/aws/publish-site.sh:58` from the file extension. Python's `mimetypes` maps `.glb` to `model/gltf-binary`, `.gltf` to `model/gltf+json`, `.wasm` to `application/wasm` and `.ktx2` to `image/ktx2` (checked with Python 3.12.3; the AWS CLI's own table is **unverified**) | CloudFront compresses only listed types between 1,000 and 10,000,000 bytes. The list includes `application/wasm` but **not** `model/gltf-binary`, `model/gltf+json` or `image/ktx2` (AWS "Serve compressed files", read 2026-11-17). Models are therefore served uncompressed |

Implication: before any optimizer, the measured gzip estimates (GLBs 37% to 57% smaller; the
`.gltf` set 76% smaller) show transfer compression is the cheapest available win. It is a
delivery change (nginx `gzip_types`, or pre-compressed objects with `Content-Encoding`, or a
CloudFront function), separate from 010 and from 013, and needs its own small card and owner
approval. Decoder files, if shipped, would be compressed by CloudFront as `application/wasm` or
JavaScript.

### 4.5 Browser and mobile constraints (tablet-first)

- **Decoder cost.** Meshopt adds about 7.7 KB gzip and decodes on the main thread or in its own
  workers; Draco adds about 75 KB to 100 KB gzip and runs in workers; the Basis transcoder adds
  about 260 KB gzip and runs in workers (sizes from 4.2). The one-time download competes with
  the first island load on tablet networks; decode time on a mid-range tablet is **unmeasured**.
- **Workers and WASM.** `DRACOLoader` and `KTX2Loader` build workers from `Blob` URLs
  (`DRACOLoader.js:426,440`, `KTX2Loader.js:329,334`); the meshopt decoder can also create
  workers. No Content-Security-Policy was found in the repository; if one is added, it needs
  `worker-src blob:` and `script-src 'wasm-unsafe-eval'` for these decoders.
- **KTX2 needs the renderer.** `KTX2Loader.detectSupport(renderer)` chooses the GPU target
  (ASTC on iPad and most Android tablets, ETC2 on older Android, BC on desktop). `createGltfFetcher()`
  has no renderer today, so enabling KTX2 needs plumbing from the scene's `WebGLRenderer` to the
  loader. If no compressed target is supported, the transcoder falls back to uncompressed RGBA
  and the GPU memory benefit disappears.
- **Memory.** On tablets the binding constraint is usually GPU memory, not download size. The
  NPC's 2048x2048 texture (about 22.4 MB uncompressed with mips) is the clearest candidate, and
  a resize to 1024 (013's pipeline) cuts it by 4 before any compression, with no loader change.
- **Sprouts.** ADR-020's performance targets (tablet 30+ FPS) are planning targets, not
  measured; any lossy variant must pass a visual check on a real tablet.

### 4.6 Exact loader and validation changes to enable each format (requirements only)

None of these is made by this study. Each is gated by owner decision W4-6.

**Common to all three**

1. One shared, lazily created decoder instance per page, configured in `assetLoader.ts`
   `createGltfFetcher()` and in `previewModelSource.ts` `parsePreviewModel()`; both sites
   behind one feature flag, default off, so an unflagged build keeps today's behaviour.
2. Decoder files self-hosted from the app origin (the build or `react/public/`), never a CDN
   (`www.gstatic.com` and similar are out); pinned to the installed `three` version.
3. The Admin preview's URL modifier (`previewModelSource.ts:162-167`) must keep refusing
   external model resources while allowing the decoder's own fetches. Requirement: prove with a
   test that decoders fetch through their own loader, not through `manager`, or allow-list only
   the self-hosted decoder URLs.
4. Both validators change together (the parity test enforces it): move the extension from
   `NEEDS_DECODER` to `SUPPORTED_EXTENSIONS` in `validation.py:48-67` and `document.py:59-78`,
   update `GLB_VALIDATION.md`, `docs/ASSET_LIBRARY.md` section 4, the parity corpus, and bump the
   processor version (`processor.py`, `asset.glb_validator` 1.0.0), which makes earlier
   validations `processor_outdated` at the publication gate. That bump is a deliberate owner
   decision, not a side effect.
5. Delivery checks: decoder files served with `application/wasm` / `text/javascript` and long
   cache headers; CSP rules if a CSP is introduced (4.5).
6. Tests: a real `GLTFLoader.load()` round trip of a small compressed fixture per format (the
   pattern of `assetLoader.test.ts`), a test that an unflagged loader still refuses it, and
   Playwright or manual tablet verification.
7. ADR-020: the engine must not import React or AWS; if the asset loader moves into `game/`,
   the decoder is injected by the host, not imported by the engine.

**`EXT_meshopt_compression`**

- Loader: `loader.setMeshoptDecoder(MeshoptDecoder)` with `MeshoptDecoder` from
  `three/examples/jsm/libs/meshopt_decoder.module.js` (no separate asset; the WASM is embedded).
- Validators: allow `EXT_meshopt_compression`; keep `KHR_mesh_quantization`. Decide whether
  `KHR_meshopt_compression` (the newer Khronos version that gltfpack emits with `-ce khr`) is
  also allowed; three 0.185.1's loader support for it is **unverified**.
- The validators cannot see inside compressed buffer views. Bounds, vertex counts and accessor
  ranges remain checkable from accessors, but the decoded data is only checked by decoding.
  Requirement: the validator report must say so (a warning such as `compressed_payload`).

**`KHR_draco_mesh_compression`**

- Loader: a `DRACOLoader` with `setDecoderPath()` pointing to the self-hosted glTF decoder
  build (`draco/gltf/`), `loader.setDRACOLoader(draco)`, and disposal when the page unloads.
- Validators: allow the extension; a Draco primitive's accessors may have no `bufferView`, so
  the buffer-view and accessor-range checks must accept accessors whose data lives in the Draco
  extension. Same "not decoded" warning.
- Lowest priority: larger decoder than meshopt (4.2), and only one of the two mesh codecs is
  needed.

**`KHR_texture_basisu`**

- Loader: a `KTX2Loader` with `setTranscoderPath()` to the self-hosted `basis/` files and
  `detectSupport(renderer)` on the live renderer, then `loader.setKTX2Loader(ktx2)`.
- Validators: allow the extension and the `image/ktx2` media type (`validation.py:69,516`;
  `document.py:81,819,884`); read KTX2 header dimensions (identifier `«KTX 20»`, `pixelWidth`,
  `pixelHeight`) so `texture_too_large` still applies; keep a PNG/JPEG fallback image only if
  the owner wants it (the extension allows a fallback `source`).
- Texture resizing before compression is 013's module.

### 4.7 Exact Three.js compatibility change list (Workstream D, requirements only)

Nothing below is implemented. Every item is gated by owner decision W4-6 and by the native-tool
ADR for any server-side tool. "Today" cites the code as of Wave 4 head `48c98a1`; three is
0.185.1. Findings that close earlier "unverified" items are marked **verified**.

**A. Loader construction sites (all of them)**

| # | File and line today | Change when a format is approved |
|---|---|---|
| L1 | `react/src/features/island-map/three/assets/assetLoader.ts:79-80` (`createGltfFetcher()`, `new GLTFLoader()`; the default argument at `:156` is the only caller) | Build the loader from one shared factory (new `createConfiguredGltfLoader(options)` in the same folder). It calls `setMeshoptDecoder(MeshoptDecoder)` (meshopt), `setDRACOLoader(draco)` (Draco) and `setKTX2Loader(ktx2)` (KTX2), each only when its flag is on. The fetcher gets the loader through a parameter, so `loadAsset(..., fetchGltf)` tests keep injecting a fake |
| L2 | `react/src/features/assets/preview/previewModelSource.ts:168` (`parsePreviewModel`, `new GLTFLoader(manager)`) and its URL modifier `:162-167` | Same factory. The preview must still refuse every external resource: the decoders fetch through their own `FileLoader`, not through `manager` (**to prove with a test**, 4.6 item 3). The preview has no renderer (`modelPreviewViewer.ts:148` creates one later), so for KTX2 it needs `detectSupport` on that renderer, or the preview may show a compressed texture as unsupported |
| L3 | Renderer creation, where `detectSupport(renderer)` must run: `react/src/features/island-map/three/runtime/createLocationEngine.ts:157` (`createRenderer`, used at `:342`), `sceneKit.ts:88`, `sandboxScene.ts:77`, `modelPreviewViewer.ts:148` | `KTX2Loader.detectSupport(renderer)` needs the live `WebGLRenderer` (reads `renderer.extensions`, `KTX2Loader.js:230-262`). The engine must not import the asset code (ADR-020, "the engine ... emits typed events"), so the host passes the renderer or a ready `KTX2Loader` into the asset loader once, before the first model load. Do not call `detectSupportAsync` (deprecated since r181, `KTX2Loader.js:213-219`) |

**B. Loader setup, per format (three 0.185.1, imports from `three/examples/jsm/...`)**

| Format | Import and setup | Notes |
|---|---|---|
| `EXT_meshopt_compression` and `KHR_meshopt_compression` | `import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'; loader.setMeshoptDecoder(MeshoptDecoder);` | **Verified:** `GLTFLoader.js:237` and `:243` handle both names, so the "is `KHR_` loadable" question is closed. The decoder is one 29 KB module with embedded WASM: no hosting, no path, no CSP beyond `wasm-unsafe-eval`. `setMeshoptDecoder` must be called before load (`:1621`) |
| `KHR_draco_mesh_compression` | `const draco = new DRACOLoader(); draco.setDecoderPath('/vendor/three-0.185.1/draco/gltf/'); draco.setDecoderConfig({ type: 'wasm' }); draco.preload(); loader.setDRACOLoader(draco);` and `draco.dispose()` on engine teardown | Needs `draco_decoder.wasm`, `draco_wasm_wrapper.js` (glTF build, 192 KB + 58 KB). Blob workers (`DRACOLoader.js:426,440`). Lowest priority |
| `KHR_texture_basisu` | `const ktx2 = new KTX2Loader(); ktx2.setTranscoderPath('/vendor/three-0.185.1/basis/'); ktx2.setWorkerLimit(2); ktx2.detectSupport(renderer); loader.setKTX2Loader(ktx2);` and `ktx2.dispose()` on teardown | Needs `basis_transcoder.js` + `.wasm` (57 KB + 527 KB). `setWorkerLimit(1 or 2)` bounds worker memory on tablets (`KTX2Loader.js:196`). `ktx-parse` and `zstddec` are imported as modules and bundled by Vite (no hosting) |
| `EXT_texture_webp`, `EXT_mesh_gpu_instancing` | none (handled by the stock loader, `GLTFLoader.js:647,651`) | **Not compression, not required by this study.** Listed because the validators do not refuse them (see 4.8, gap G1) |

**C. Hosting the decoder and transcoder files**

- Both defaults resolve with `import.meta.url` (`DRACOLoader.js:17-19`, `KTX2Loader.js:106-107`),
  but each loader loads fixed file names from one directory, so Vite's hashed output names do
  not work. Serve a **versioned directory** from the site origin instead:
  `/vendor/three-0.185.1/{draco/gltf,basis}/`. Never a CDN (CSP, privacy, availability).
- Do **not** commit the binaries. A build step copies them from `node_modules/three/examples/jsm/libs/`
  into `react/dist/vendor/three-<version>/` (a small `scripts/` node script or a Vite
  `closeBundle` hook; the exact mechanism is a decision for the frontend owner). A unit test
  reads `three`'s installed version and fails if the directory name and the version differ.
- `scripts/aws/publish-site.sh:52-53` syncs `assets/` with the immutable cache header and
  `:58-59` syncs everything else with `public, max-age=3600`. A versioned vendor directory
  should be excluded from the stable sync and synced with the immutable header (one more
  `--exclude 'vendor/*'` plus a second `s3 sync`), because its path changes whenever three does.
- Content types: `.wasm` must be `application/wasm` and `.js` a JavaScript type. `aws s3 sync`
  guesses from the extension (Python `mimetypes` agrees; the AWS CLI's own table was not
  verified). Both loaders fall back to `ArrayBuffer` instantiation when streaming fails, so a
  wrong type degrades rather than breaks, but test with `curl -I` after any deploy.
- CloudFront compresses `application/wasm` and JavaScript (4.4), so the measured gzip sizes in
  4.2 are what travels.
- The Django Admin preview is a separate bundle (`react/vite.admin-preview.config.ts`) served by Django. It needs the same decoder directory
  reachable from its origin: same site origin through the `/` CloudFront behavior if the preview
  page is on the site, or Django static files if not. Decide with the Asset Library owner.
- `deploy-site.yml` builds with `npm run build` (`react/package.json`: `tsc -b && vite build`);
  the copy step belongs in that build so the published `dist/` is complete and the rollback
  releases (`_releases/<sha>/`) stay consistent.

**D. CSP and security headers**

There is no Content-Security-Policy today: the CloudFront `SecurityHeaders` policy
(`infra/lib/frontendStack.ts:124-139`) sets HSTS, nosniff, frame options and referrer policy
only, and `infra/lib/frontendStack.test.ts:153` pins that shape. Nothing changes until a CSP is
introduced. When one is, the decoders need: `script-src 'self' 'wasm-unsafe-eval'` (WASM
compile), `worker-src 'self' blob:` (Draco and KTX2 workers are created from Blob URLs),
`connect-src 'self'` (main-thread fetch of the decoder files and `/api/v1/asset-files/...`).
Meshopt needs only `wasm-unsafe-eval`. A CSP must be tested against a real tablet browser, not
jsdom.

**E. Mobile and tablet GPU compressed formats (KTX2 only)**

`KTX2Loader.detectSupport` selects the transcode target from what the WebGL context exposes
(`WEBGL_compressed_texture_astc`, `_etc`, `_s3tc`, `EXT_texture_compression_bptc`;
`KTX2Loader.js:245-262`). Expected, from the format definitions and **not measured on any
device here**:

| Target | Typical hardware | Bits per pixel (RGBA) |
|---|---|---|
| ASTC 4x4 | Apple GPUs (iPad), most current Android tablets | 8 |
| ETC2 RGBA | OpenGL ES 3.0 Android devices without ASTC | 8 |
| BC7 (BPTC) / BC3 | Desktop browsers | 8 |
| RGBA8 fallback (no block format exposed) | Old or emulated GPUs, some WebViews | 32 |

If no block format is exposed, the transcoder produces uncompressed RGBA and the memory saving
disappears, with a transcode cost on top. Required before enablement: a device matrix test on
the tablets the owner names (Sprouts gate, LAI-2303), and a rule that a KTX2 asset ships with a
PNG/JPEG fallback image only if the owner accepts the extra bytes.

**F. Memory implications (computed, formula-based)**

- Meshopt and Draco reduce **download** size; decoded geometry in memory is the same as for an
  uncompressed model (quantized attributes can stay quantized on the GPU, which does reduce
  vertex memory).
- GPU texture memory is what matters on tablets. Measured sources, computed formula: the NPC's
  one 2048x2048 JPEG is 21.33 MiB as RGBA8 with mips; as an 8 bpp block format 5.33 MiB; after a
  resize to 1024 and RGBA8, 5.33 MiB; both together 1.33 MiB (section 6.2). The cheapest win
  needs no loader change: a texture resize.
- Workers add memory: each Draco or Basis worker holds its own WASM instance (one to a few MB
  each, unmeasured). Cap with `setWorkerLimit` and `dispose()` loaders with the engine.
- Decode and transcode time on a mid-range tablet is unmeasured and must be measured before the
  flag is turned on (Sprouts: 30+ FPS planning target in ADR-020).

### 4.8 Backend change plan (compressed formats stay refused until approval)

Today (unchanged by this study, pinned by new tests): both validators refuse
`KHR_draco_mesh_compression`, `EXT_meshopt_compression` and `KHR_texture_basisu` with
`needs_decoder`, in `extensionsUsed` or `extensionsRequired`
(`tests/processing/test_processing_glb_compression_policy.py`,
`lai/apps/assets/tests/test_compression_policy.py`). A rejected version is `REJECTED`
(`lai/apps/assets/models.py:72-75`) and cannot be published (`publish_refusal`,
`lai/apps/assets/services.py:296`).

**Gap G1 (found by Workstream D, pinned, not fixed).** `KHR_meshopt_compression`,
`EXT_texture_webp` and `EXT_mesh_gpu_instancing` are not in `NEEDS_DECODER`
(`validation.py:65-67`, `document.py:76-78`). Declared in `extensionsUsed` only, they pass with
the warning `unknown_extension`; in `extensionsRequired` they fail as `unsupported_extension`.
`gltfpack -ce khr` writes the first; gltfpack's `-tw` and `-mi` write the others. Because three
0.185.1 supports all three, a published file might even load once a decoder exists, but today
no decoder is configured, so a used-only file would pass the gate and fail in the browser.
Recommendation (owner decision D9): add all three to `NEEDS_DECODER` in both validators in one
commit (the parity test requires both), which is a stricter policy and bumps the processor
version (D4). Until then, staff must not upload gltfpack output made with `-ce khr`, `-tw` or
`-mi`.

**Plan, in the order it would land (all behind W4-6; none is done):**

| Step | Change | Files | Notes |
|---|---|---|---|
| B1 | Close gap G1 (above) | `lai/apps/assets/validation.py`, `processing/lai_processing/processors/gltf/document.py`, the two new test files, `docs/processing/GLB_VALIDATION.md`, `docs/ASSET_LIBRARY.md:89-90` (also add `KHR_texture_basisu`, found missing) | Processor version bump; earlier validations become `processor_outdated` at the gate (`processing.py:353-356`) |
| B2 | Per-format enablement setting `LAI_ASSET_COMPRESSION_FORMATS` (empty default, subset of `meshopt`, `draco`, `ktx2`), read by Django and passed in the job payload's validation profile (`glb-default` profile settings), never read by the processor from the environment | `lai/config/settings/base.py`, `lai/apps/assets/validation.py`, `processing/.../document.py` (`GlbSettings`), `processing/lai_processing/contracts` profile | Parity test extended to compare the setting's effect. Empty default keeps today's behaviour exactly |
| B3 | When a format is enabled the extension moves from "refused" to "allowed with warning `compressed_payload`" (the validator cannot see inside compressed views): accessors whose data is in the extension are accepted without `bufferView`; Draco primitives checked for the extension's `attributes` map; KTX2 header parsed (`pixelWidth`, `pixelHeight`, `levelCount`, `supercompressionScheme`) so `texture_too_large` still applies and `image/ktx2` is an allowed texture type | same files; `IMAGE_TYPES` at `validation.py:70` and `ALLOWED_IMAGE_TYPES` at `document.py:81` | Decoded vertex data is still unchecked; the report says so. A KTX2 fixture builder is needed in `tests/processing/glb_builder.py` and `lai/apps/assets/tests/helpers.py` |
| B4 | Model metadata fields (new keys inside the existing `AssetVersion.metadata` JSON, so **no schema migration**; `models.py:105`): `compression` (list of `meshopt`, `draco`, `ktx2`), `quantized` (bool, already computed at `document.py:540`), `texture_gpu_estimate_bytes` (RGBA8 with mips, or 8 bpp for KTX2), `decoder_required` (bool), `optimizer` (tool, version, options, source version id and sha256: placement per the derived-artifact design, `ADR-PROPOSED-derived-artifacts.md`, not designed here) | `processing/lai_processing/processors/gltf/metadata.py`, `lai/apps/assets/validation.py` metadata builder | `metadata_version` bump (currently 1). Django Admin shows them read-only. Coordinate with the lead before any model-field promotion, which would be a migration |
| B5 | Publication gate: a version whose metadata says `decoder_required` is publishable only while its format is in `LAI_ASSET_COMPRESSION_FORMATS`, checked in `publish_refusal` (`services.py:296`) and re-checked in `publish_version` (`services.py:235`); a new refusal code `format_not_enabled` | `lai/apps/assets/services.py`, `lai/apps/assets/admin.py:773` notice text | Keeps the flag, the validator and the game in step: disabling the setting makes new compressed versions unpublishable, it does not unpublish existing ones (rollback is "make the original default", section 5) |
| B6 | Delivery: asset file responses stay `model/gltf-binary`; nothing in `views.py:93` changes. `Content-Encoding` is not used for compressed formats (already compressed) | none | Transfer compression for uncompressed GLBs is card R1 |
| B7 | Frontend flag: `VITE_LAI_COMPRESSED_ASSETS` (default off, a comma list), read in the loader factory L1 and nowhere else; mismatch with Django's setting is an operator error caught by a startup check that the decoders for each enabled format are in the build | `react/src/...assetLoader.ts`, build copy step (4.7 C) | Both flags must be on for a compressed model to be published and played |

Out of scope and not proposed: any change to the published-asset path, any new storage, any
worker change. Derived output storage is the derived-artifact design.

## 5. Derived artifact requirements

Consistent with 013's derived-artifact design; **depends on owner decision W4-4 and 013's
design, which is not yet written.** Until W4-4 is decided, no worker writes an optimized file
(the worker's storage port is read-only, `CANONICAL_PATH.md`).

1. An optimized model is a **new unpublished `AssetVersion`** of the same asset (status `DRAFT`,
   then validated by the existing path), never a rewrite of the source version
   (`AssetVersion.IMMUTABLE_FIELDS`, ADR-045, `WAVE4_HANDOFF.md` rule 4). Publication and
   "make default" stay explicit staff actions.
2. Provenance is recorded on the new version: source version id and SHA-256, tool name and
   exact version, the full option list, the `asset.optimize` processor version, and the
   measured sizes before and after. Exact field placement follows 013's design.
3. The new version must pass the same validator as any upload; with compression enabled, only
   after section 4.6 has landed.
4. The original stays available and can be made default again at once (rollback).
5. Outputs are deterministic for the same input, tool version and options, so a duplicate job
   is idempotent under the existing `apps.jobs` key.
6. Staff content only: never child photos, audio or text (ADR-042).

## 6. Benchmark harness and measured optimization results

Harness: `scripts/processing/bench/optimization_bench.py` and `optimization_bench.md`. It runs
only tools found with `shutil.which`, on copies in a temporary directory, never in CI (exit 3
when `CI` or `GITHUB_ACTIONS` is set), never downloads, and records size, gzip size, wall time,
child peak RSS and the validator verdict of each output.

**Earlier state (2026-11-17, commit `2333d9e`):** no tool was installed and no result existed.
Workstream D then measured the tools and corpus listed below; the harness still never downloads,
and the tools were installed by hand outside the repository.

### 6.2 Measured optimization results (Workstream D, 2026-11-17)

**Conditions.** Commit base `48c98a1` plus the harness changes in this branch. Machine: Intel
Core i7-12700K, 4 vCPUs visible, 7.9 GB RAM, Linux x86_64, Node 22.21.0, Python 3.12.3. Tools,
installed **only into a throwaway directory outside the repository** (`/tmp/claude-1001/wsd-tools`,
nothing committed, nothing added to any `package.json` or requirements file):

| Tool | Version | Source | Caveat |
|---|---|---|---|
| `gltfpack` | 1.3 | npm package `gltfpack` (WASM build, run by Node) | The npm build **has no texture compression**: `-tc` exits 1 on every GLB with textures (rows marked failed in the CSV). Native `gltfpack` was not installed, so its KTX2 output, speed and memory are **not measured** |
| `gltf-transform` | 4.5.1 | npm `@gltf-transform/cli` | Draco, meshopt (with default quantization), `resize` (sharp), `etc1s` and `uastc` (call `toktx`) |
| `toktx` | 4.4.2 | KTX-Software release `Linux-x86_64` tarball | x86_64 only; the arm64 build was **not measured** |

Command (harness `scripts/processing/bench/optimization_bench.py`, extended in this branch with
resize, ETC1S and UASTC variants, a per-command peak RSS from GNU `time -f %M`, clip names, and
estimated GPU texture memory):

```sh
PATH=<throwaway>/node_modules/.bin:<throwaway>/ktx/KTX-Software-4.4.2-Linux-x86_64/bin:$PATH \
  /Coding/learning-worktrees/storybook/.venv/bin/python scripts/processing/bench/optimization_bench.py \
  --format csv content/models/npc-pip-pirate.glb react/public/models/{kaykit-floor-tile-large.glb,kenney-tree-large.glb,kenney-rock-small.glb,npc-professor-ticktock.gltf,npc-harbor-master.gltf,treasure-chest.gltf,hearth-lit.gltf}
```

Corpus: the repository has no Treasure Rush or Storykeeper Castle GLB. The nearest real
content was used and labelled as such: the one skinned NPC GLB, three textured kit GLBs, the two
large NPC `.gltf` files (no textures), one Storykeeper Castle prop and the one animated
Treasure Rush prop (`treasure-chest.gltf`). Self-contained `.gltf` inputs are converted to GLB
by the tools; the baseline row is the file as found. Two kit GLBs from the baseline corpus
(`kaykit-floor-wood-large-dark`, `kenney-tree-small`) were not re-run; they are the same kits.

**Size.** Percentage is output / original file bytes. `*` means the existing validator rejects the
output (`needs_decoder`); all other outputs **pass the existing validator and load in today's
loader** (loading in a browser was not tested; validator pass is the evidence).

| File | Original bytes (gzip -9) | `gltfpack` default (loads today) | `gltfpack -si 0.5` (loads today) | `gltfpack -cc` meshopt | glTF-Transform draco | glTF-Transform meshopt |
|---|---:|---:|---:|---:|---:|---:|
| `npc-pip-pirate.glb (skinned, 4 clips)` | 3,307,456 (2,086,790) | 1,864,136 (56%) | 1,175,048 (36%) | 822,380 (25%) * | 1,073,096 (32%) * | 1,016,852 (31%) * |
| `npc-professor-ticktock.gltf (NPC, 3 clips)` | 1,190,838 (284,600) | 420,692 (35%) | 410,644 (34%) | 177,928 (15%) * | 197,876 (17%) * | 271,004 (23%) * |
| `npc-harbor-master.gltf (NPC, 3 clips)` | 872,935 (236,469) | 314,128 (36%) | 313,220 (36%) | 152,344 (17%) * | 189,680 (22%) * | 232,248 (27%) * |
| `kaykit-floor-tile-large.glb (textured kit)` | 28,100 (14,254) | 22,900 (81%) | 22,900 (81%) | 20,832 (74%) * | 18,536 (66%) * | 21,448 (76%) * |
| `kenney-tree-large.glb (textured kit)` | 28,784 (13,316) | 14,692 (51%) | 14,140 (49%) | 12,212 (42%) * | 11,628 (40%) * | 14,804 (51%) * |
| `kenney-rock-small.glb (textured kit)` | 23,796 (12,091) | 16,424 (69%) | 16,424 (69%) | 15,076 (63%) * | 14,068 (59%) * | 16,380 (69%) * |
| `hearth-lit.gltf (Storykeeper Castle prop)` | 20,893 (1,947) | 6,144 (29%) | 6,144 (29%) | 5,688 (27%) * | 9,936 (48%) * | 8,880 (42%) * |
| `treasure-chest.gltf (animated, 1 clip)` | 4,936 (1,071) | 3,416 (69%) | 3,416 (69%) | 3,764 (76%) * | 2,584 (52%) * | 3,924 (80%) * |

Animation preservation: every output of every variant kept the same animation count and clip
names as its source (`Idle Walk Wave Point`, `Idle Walk Wave`, `Open`); triangle counts were
unchanged except `-si 0.5` on the NPC (73,642 to 36,820, which is the point of the option) and
`hearth-lit` (see the findings). **Playback correctness and visual parity were not checked** (no
browser or tablet).

**Textures.** GPU memory is a formula (4.7 F), not a measurement: RGBA8 with a full mip chain
for PNG and JPEG; 8 bits per pixel with mips for KTX2 (what ASTC 4x4, ETC2 RGBA and BC7 would
use). The `.gltf` inputs have no textures and are omitted.

| File | Original: file bytes, GPU MiB | resize 1024 (loads today) | ETC1S KTX2 | UASTC KTX2 |
|---|---|---|---|---|
| `npc-pip-pirate.glb (skinned, 4 clips)` | 3,307,456 B, 21.33 MiB | 3,178,856 B, 5.33 MiB | 3,446,488 B, 5.33 MiB | 5,658,160 B, 5.33 MiB |
| `kaykit-floor-tile-large.glb (textured kit)` | 28,100 B, 5.33 MiB | 57,576 B, 5.33 MiB | 33,932 B, 1.33 MiB | 106,740 B, 1.33 MiB |
| `kenney-tree-large.glb (textured kit)` | 28,784 B, 1.33 MiB | 32,112 B, 1.33 MiB | 32,600 B, 0.33 MiB | 59,352 B, 0.33 MiB |
| `kenney-rock-small.glb (textured kit)` | 23,796 B, 1.33 MiB | 28,364 B, 1.33 MiB | 23,412 B, 0.33 MiB | 59,524 B, 0.33 MiB |

Findings from the numbers (arithmetic on the table, not extrapolation):

1. **Geometry compression is where the bytes are**: the NPC GLB goes 3.31 MB to 0.82 MB (25%)
   with `gltfpack -cc` and 1.86 MB (56%) with the default quantization that the loader and both
   validators already accept; the two NPC `.gltf` files go to 15% to 17% (meshopt) or 35% to 36%
   (default). The small kit pieces save little in absolute terms (a few KB).
2. **The default `gltfpack` output passes the existing validator and needs no decoder** in all 8
   cases, so authoring-time quantization (R4) needs no loader change. Its effect after gzip is
   smaller than it looks in raw bytes (NPC: 1,136,908 gzip -9 bytes against 2,086,790 for the
   original).
3. **After gzip, meshopt's advantage narrows** (NPC `-cc`: 666,799 gzip -9 bytes against 1,136,908
   for the default). Transfer compression (R1) plus quantization captures a large share of the
   gain with no decoder.
4. **Texture compression does not shrink the files here**: ETC1S output is 104% of the NPC and
   98% to 121% of the kit originals; UASTC is 171% to 380% of them. The gain is **GPU
   memory** (computed: 21.33 to 5.33 MiB for the NPC), and the cheaper route to the same number
   for the NPC is a resize to 1024 (also 5.33 MiB, no loader change).
5. **A resize that does nothing still re-encodes**: `resize` on a texture already at or under
   1024 grew the files (kit pieces +12% to +105%). A policy must skip images already within the
   cap. 013 owns the module; the point is recorded for its design.
6. **`gltfpack` by default merges meshes and drops node names** (`hearth-lit.gltf`: the nodes
   `Surround`, `Opening`, `Mantel` and `Flame` lose their names; `-kn` keeps all names). The
   game finds objects by name (`getObjectByName`, for example `'Pip'` at `sandboxScene.ts:158` and `'valve-wheel'` at `areaPuzzleScene.ts:180`),
   so any server or authoring pipeline must pass `-kn` (and be checked against animation target
   names). It also deduplicates identical meshes, which is why the validator's per-mesh
   triangle count for `hearth-lit` is 60 for `gltfpack` and 120 for the original and the
   `gltf-transform` outputs: instances, not geometry, were lost.
7. **Lossy variants need visual sign-off** (D8). Nothing in this table was looked at on a device.

**Processing time and peak memory (this workstation, not Lambda).** Seconds / peak RSS in MiB
from GNU `time`, for the command including its Node runtime. The npm `gltfpack` is a WASM build,
so its figures are not those of native `gltfpack`; `toktx` runs inside `gltf-transform`.

| File | gltfpack default s / peak RSS MiB | gltfpack -cc | gt draco | gt etc1s | gt uastc |
|---|---|---|---|---|---|
| `npc-pip-pirate.glb` | 0.152 s / 83 | 0.173 s / 82 | 0.749 s / 161 | 3.173 s / 246 | 6.703 s / 145 |
| `npc-professor-ticktock.gltf` | 0.155 s / 69 | 0.261 s / 70 | n/a (no textures) | n/a (no textures) | 0.673 s / 125 |
| `npc-harbor-master.gltf` | 0.136 s / 65 | 0.133 s / 69 | n/a (no textures) | n/a (no textures) | 0.494 s / 118 |
| `kaykit-floor-tile-large.glb` | 0.082 s / 50 | 0.066 s / 50 | 0.45 s / 114 | 1.256 s / 100 | 1.307 s / 108 |
| `kenney-tree-large.glb` | 0.06 s / 50 | 0.094 s / 50 | 0.455 s / 112 | 0.574 s / 108 | 0.841 s / 103 |
| `kenney-rock-small.glb` | 0.055 s / 50 | 0.048 s / 50 | 0.467 s / 107 | 0.638 s / 111 | 0.682 s / 114 |
| `hearth-lit.gltf` | 0.099 s / 59 | 0.107 s / 58 | n/a (no textures) | n/a (no textures) | 0.769 s / 112 |
| `treasure-chest.gltf` | 0.05 s / 53 | 0.051 s / 53 | n/a (no textures) | n/a (no textures) | 0.491 s / 106 |

Reading: for this corpus every geometry job finishes in under 1 s and under 170 MiB; the
slowest was ETC1S then UASTC on the 2048x2048 NPC texture (3.2 s and 6.7 s on a 12700K, 246 MiB
for ETC1S). Lambda arm64 timings are not derivable from these; they need a measured run after
the native-tool ADR. Nothing here approaches the 900 s or the 10 GB limits.

Not measured: native `gltfpack` (texture compression, speed, memory), `basisu`,
`draco_encoder` (only the glTF-Transform wrapper), Blender, arm64 anything, Lambda cold start,
any browser decode or transcode time, any GPU. `brotli` is still not installed.

## 7. Runtime recommendation and cost assumptions

**Recommendation, in order of preference:**

1. **Now: no runtime.** Measure on a workstation with the harness. The corpus is six GLBs and
   116 small `.gltf` files; server-side optimization has nothing to amortize yet.
2. **First production use: authoring-time optimization.** Staff (or a documented local script)
   run `gltfpack` on their machine and upload the result as a new version through the existing
   Asset Library and validator. No AWS change, no new runtime, no ADR-064 exception. Only the
   loader and validator changes of 4.6 are needed, and only for compressed variants; a
   quantization-only variant may need none (4.3, to be measured).
3. **If volume grows: `asset.optimize` as an `apps.jobs` kind** on the media queue, run by a
   **separate** arm64 Lambda function (the existing `jobs-worker` zip stays standard library
   only), with a native `gltfpack` built from source for aarch64. Zip or layer if the measured
   binary fits the 250 MB unzipped limit and the ADR allows a native binary in a zip; a
   container image only if the ADR approves ECR for this workload (ADR-064 decision 9). Needs
   W4-1, W4-4 and W4-6.
4. **Fargate or another runtime** only if measured runs exceed Lambda limits (W4-3). Nothing
   measured so far suggests that: the input ceiling is 50 MiB and `/tmp` can be 10 GB.

**Cost assumptions** (not measured; verify current pricing before any decision). As known to the
author, AWS Lambda arm64 on-demand pricing in us-east-1 has been about USD 0.0000133334 per
GB-second plus USD 0.20 per million requests, with a monthly free tier of 400,000 GB-seconds and
1 million requests; us-west-1 rates may differ. **Verify current pricing for us-west-1.**

| Scenario (assumed) | Compute | Approximate cost at the assumed rate |
|---|---|---|
| One optimization: 2,048 MB for 30 s (assumed duration, not measured) | 60 GB-s | about USD 0.0008 |
| 1,000 optimizations per month | 60,000 GB-s | about USD 0.80, inside the free tier if nothing else uses it |
| Container image in ECR (if approved) | Storage of one image | about USD 0.10 per GB-month (verify), plus the image pipeline and scanning ADR-064 avoided in dev |

The real cost driver is not compute but the operational surface: a second function, its role,
its packaging pipeline and, for a container, a registry in dev. That is why authoring-time
optimization comes first.

### 7.1 When Lambda is the wrong runtime for processing (heavy-workload fallback)

Lambda stays the default (ADR-064). It is unsuitable when a job needs more than 15 minutes
(900 s), more than 10,240 MB of memory or 10,240 MB of `/tmp`, a GPU, a licensed or very large
toolchain that does not fit the 250 MB zip or the 10 GB image, or sustained multi-core CPU for a
long time. In this product that means: large FBX or multi-gigabyte model conversion, Blender
based retargeting or baking, large texture sets (hundreds of images, UASTC with high effort), and
any batch that must run as one unit past 15 minutes. **No measurement in section 6.2 approaches
those limits** (largest job 6.7 s); this is a contingency, not a current need. The proposal is
in `docs/processing/proposals/ADR-PROPOSED-heavy-workload-runtime.md`: AWS Batch on Fargate (or
ECS RunTask on Fargate) as the single overflow runtime, behind the same `apps.jobs` kind and
result queue, never a second job system, and only after the native-tool ADR and an owner
approval for an image registry. Not implemented, not approved.

## 8. Recommended rollout sequence

| Step | What | Depends on | Approval |
|---|---|---|---|
| R0 | This study and harness | none | none (docs and scripts) |
| R1 | Transfer compression for models (`model/gltf-binary`, `model/gltf+json`) on the Django and site paths | Separate card; measured gzip estimates in section 2 | Owner (delivery change) |
| R2 | Workstation benchmark with installed tools; add measured results to section 6; tablet visual check of lossy variants | Tools installed locally | none |
| R3 | 013 lands imaging (resize) and the derived-artifact design | LAI-LAMBDA-013, W4-4 | Owner |
| R4 | If R2 shows quantization-only outputs pass and load: authoring-time quantization and texture resize (013) | R2, R3 | Owner (content process) |
| R5 | Meshopt: loader flag, decoder wiring, both validators, processor version bump, tests | R2 numbers, W4-6 | Owner |
| R6 | KTX2: renderer plumbing, transcoder hosting, validators, tablet GPU checks | R5 pattern, W4-6 | Owner |
| R7 | Draco only if a source cannot be re-exported (meshopt covers the same need) | W4-6 | Owner |
| R8 | Server-side `asset.optimize` kind, separate arm64 function | W4-1 (this proposal), W4-4, W1 jobs migration, LAI-LAMBDA-011 | Owner, and every deployment |

## 9. Owner decisions needed

| # | Decision | Blocks |
|---|---|---|
| D1 | Accept, amend or reject the proposed ADR (`ADR-PROPOSED-glb-optimization.md`): native `gltfpack`, separate arm64 function, packaging by measurement | R8 |
| D2 | Authoring-time optimization as the first production path (R4) | R4 |
| D3 | Which compressed formats the game supports, in what order (recommended: meshopt, then KTX2; Draco only on need) = W4-6 | R5 to R7 |
| D4 | Processor version bump when validators change (every earlier validation becomes `processor_outdated`) | R5 to R7 |
| D5 | Transfer compression for model content types (separate card) | R1 |
| D6 | Texture size policy for tablets (for example a 1024 px cap for NPC textures), implemented by 013 | R4 |
| D7 | W4-4 derived artifacts: new unpublished versions, as 013 designs | R4, R8 |
| D8 | Lossy variants (simplification, ETC1S) need visual sign-off per asset | R4 onward |
| D9 | Close gap G1: add `KHR_meshopt_compression`, `EXT_texture_webp` and `EXT_mesh_gpu_instancing` to `NEEDS_DECODER` in both validators (stricter; processor version bump) | R5, and any upload of `gltfpack -ce khr`, `-tw`, `-mi` output |
| D10 | Heavy-workload overflow runtime (`ADR-PROPOSED-heavy-workload-runtime.md`): AWS Batch on Fargate, a contingency only | Jobs over 15 min or 10 GB; none measured |
| D11 | Decoder hosting: build-time copy into a versioned `/vendor/three-<version>/` directory, immutable cache, plus the Admin preview origin | R5 to R7 |

## 10. Risks and open items

- Savings are measured only for the tools and builds named in 6.2 (npm WASM `gltfpack`, glTF-Transform, `toktx` x86_64). Native `gltfpack`, arm64 and Lambda timings are unmeasured.
- The Linux aarch64 availability of prebuilt `gltfpack`, Draco and `basisu` binaries is
  unverified; building from source is assumed.
- **Resolved:** three 0.185.1 `GLTFLoader` handles `KHR_meshopt_compression` (`GLTFLoader.js:243`). The validators do not refuse it when only used (gap G1, 4.8).
- Whether Vite emits the `import.meta.url` decoder files correctly in this build is unverified.
- Live response headers for model delivery were not checked (no AWS calls).
- The validators do not decode vertex data today; compressed payloads widen what is not
  checked. Any enablement must state that limit in the report.
