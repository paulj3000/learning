# LAI-LAMBDA-010: GLB and texture optimization feasibility

Status: **feasibility study, documentation and benchmark scaffolding only** (2026-11-17, branch
`feature/w4-optimization-feasibility`). Nothing here is approved scope. No tool was added to any
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
| Is any optimization tool installed here? | **No.** `gltfpack`, `gltf-transform`, `toktx`, `basisu` and `draco_encoder` are absent, so **no optimization saving has been measured** (section 6) |
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

**Measured optimization results: none.** On 2026-11-17 at commit `2333d9e`,
`optimization_bench.py --list-tools` reported `gltfpack`, `gltf-transform`, `toktx`, `basisu`
and `draco_encoder` as not installed. A run on `react/public/models/kenney-tree-large.glb`
reported every variant as `skipped: tool not installed`. Nothing was installed for this study.

To produce results: a developer installs the tools on a workstation (outside the repository),
runs the commands in `optimization_bench.md` on the six GLBs, records tool versions, and adds the
CSV here with the commit and date.

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

## 10. Risks and open items

- No tool result exists; every saving in this field is unknown until R2.
- The Linux aarch64 availability of prebuilt `gltfpack`, Draco and `basisu` binaries is
  unverified; building from source is assumed.
- Whether three 0.185.1 loads `KHR_meshopt_compression` (as opposed to `EXT_`) is unverified.
- Whether Vite emits the `import.meta.url` decoder files correctly in this build is unverified.
- Live response headers for model delivery were not checked (no AWS calls).
- The validators do not decode vertex data today; compressed payloads widen what is not
  checked. Any enablement must state that limit in the report.
