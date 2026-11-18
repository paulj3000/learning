# LAI-LAMBDA-013 GLB thumbnail rendering evaluation

Part of the LAI-LAMBDA-013 feasibility study (`LAI-LAMBDA-013-image-and-thumbnails.md`). Nothing
here is implemented in the product. No option is assumed to fit Lambda without measurement.

## 1. The need

Staff browse models in Django Admin as text: the version and content asset lists show a
"Preview" link, and a model is only seen by opening the interactive Three.js preview
(`docs/ASSET_LIBRARY.md` section 17). A small still image per model version (256 and 512 pixels)
in the lists and on the version page would make the library browsable. Thumbnails are staff-only
(W4-7 keeps any delivery outside the Admin a separate decision).

## 2. Constraints

- **Lambda has no GPU.** Any server-side render on Lambda is software rasterisation on the
  function's vCPUs (at most 6 vCPUs at 10,240 MB; about 1 vCPU per 1,769 MB).
- **Package limits.** 250 MB unzipped for the function plus layers; 10 GB for a container image.
  Dev has no ECR, and a container worker needs its own ADR (ADR-064 item 9).
- **No sandbox for browsers in Lambda.** Lambda gives no unprivileged user namespaces and no
  setuid helper, so Chromium in Lambda runs with `--no-sandbox` (and usually `--single-process`).
  A renderer bug reached through a crafted GLB would then execute in the worker with its role.
  This workstation showed the same constraint: Chromium refused to start ("No usable sandbox",
  Ubuntu's AppArmor user-namespace restriction) until `--no-sandbox` was given.
- **Fidelity.** The thumbnail should look like the game: Three.js 0.185, `GLTFLoader`, sRGB
  output, the framing in `react/src/features/assets/preview/modelPreviewViewer.ts`.
- **Inputs** are validated GLB versions (synchronous checks, and the background GLB validator when
  `LAI_ASSET_ASYNC_VALIDATION` is on), up to 50 MiB and 10,000,000 triangles
  (`docs/processing/GLB_VALIDATION.md`).

## 3. Options

| # | Option | Renderer | Packaging | Fits Lambda? | Security | Fidelity |
|---|---|---|---|---|---|---|
| T1 | **Staff browser capture in the Admin** with the existing Three.js viewer, uploading a PNG | The staff member's GPU, real WebGL 2 | None new: a "Save thumbnail" button in `asset-preview.js` and one Admin POST route | Not applicable (no server render) | The PNG is a staff upload: validated like any image (sniffed, `validate_image`, smaller limits), re-encoded, stored as a staff-only derived object; CSRF-protected, `assets.change_assetversion` | Identical to the Admin preview and the game |
| T2 | Headless Chromium plus SwiftShader plus three.js in Lambda | SwiftShader (software Vulkan through ANGLE) | Chrome headless shell measured at **273,378,828 B (260.7 MiB) unpacked on x86_64**, over the 250 MB limit; a compressed Lambda build of Chromium (decompressed into `/tmp` at cold start) is said to be about 60 to 70 MB (estimate, unverified), plus a Node.js runtime beside Python | Only through a compressed distribution or a container (ADR) | `--no-sandbox` is unavoidable; a second language runtime in the workers | Same three.js code |
| T3 | Mesa llvmpipe or OSMesa through EGL (for example `headless-gl` in Node, or a native GL program) | llvmpipe (software GL) | Mesa libraries (tens of MB, estimate) | Possibly, unmeasured | Native GL stack parsing scene data | `headless-gl` is WebGL 1 only and Three.js 0.185 needs WebGL 2, so not the game renderer |
| T4 | pyrender with OSMesa (Python) | OSMesa | pyrender, trimesh, PyOpenGL, Mesa | Possibly, unmeasured | Native libraries plus a different glTF importer | Different PBR shading and importer |
| T5 | Blender in background mode (`blender -b -P`) | Cycles on CPU, or EEVEE (needs a GL context) | Several hundred MB (estimate); seconds of start-up | Not on Lambda zip; container or Fargate only | Large native surface, Python scripting inside | Different look; best for offline art pipelines |
| T6 | Filament `gltf_viewer` headless | Filament on software Vulkan | Custom arm64 build | Unknown; high effort | Native | Different look |
| T7 | Fargate or EC2 batch running T2 (or T5) in a container | As T2 or T5 | Container image, ECR, task definition | Not Lambda | Sandbox possible on EC2; on Fargate the same no-namespace limits apply | As T2 or T5 |
| T8 | **Pure-Python "clay" render inside the existing zip** (positions and indices from the GLB parser already in `lai_processing`, a z-buffer rasteriser, flat or Lambert shading with each material's base colour factor, PNG written with `zlib`) | Standard library | Fits the zip and its 2 MiB budget; no new dependency | Yes, if its CPU time is acceptable (unmeasured) | Standard library only; the same parser already used for validation; no native code | Untextured silhouette: a recognisable shape, not the game look |

## 4. Local measurement (headless Chromium, SwiftShader, no GPU)

`scripts/processing/bench/thumbnail_bench.py --run --allow-no-sandbox --repeat 3 --chromium
<chrome-headless-shell>` on 2026-11-17 with Chrome for Testing 151.0.7922.34 headless shell
(Playwright's cache), x86_64, 4 cores, a busy shared workstation. A self-contained WebGL 2 page
drew a lit sphere of the given triangle count at 512 x 512 and read the pixels back. The renderer
string reported was `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader
driver)`; every run produced a non-blank image (about 132,000 of 262,144 pixels drawn).
**Measured on this host only** (not arm64, not Lambda):

| Triangles | Wall time per run, launch to exit (cold, warm, warm) | Draw plus read-back in page | Largest process RSS |
|---:|---|---|---:|
| 10,082 | 1.31 s, 1.22 s, 1.51 s | 102 to 129 ms | 98.9 MiB |
| 100,352 | 1.63 s, 1.99 s, 1.74 s | 419 to 532 ms | 99.3 MiB |
| 500,000 | 3.09 s, 4.39 s, 3.51 s | 1.54 to 1.84 s | 99.3 MiB |

Readings: software WebGL works without a GPU and costs about 1 to 4.5 s per thumbnail at these
sizes, dominated by browser start-up for small models and by rasterisation for large ones. The
RSS figure is the largest single process; Chromium runs several (browser, GPU, renderer), so the
total is higher and must be measured in the spike (`/usr/bin/time` per process tree or cgroup
accounting). Not yet measured: a real GLB through `GLTFLoader` with textures, arm64, Lambda cold
start with a compressed Chromium, and models at the 10,000,000-triangle ceiling.

## 5. Recommendation

1. **T1 first: staff capture in the Admin.** It needs no new runtime, no native dependency, no
   deployment and no write grant for any worker, renders with a real GPU exactly as the game does,
   and fits ADR-045 (Django Admin owns staff authoring). The viewer already frames the model
   (`fitModel`); capture renders one frame at 512 x 512 into a render target (or renders and calls
   `toBlob` in the same task, since `preserveDrawingBuffer` is off), scales it to 256 as well, and
   posts both (WebP where the browser can encode it, else PNG). Django checks them with the pure-
   Python code it already has, so **no imaging library is needed**: `validate_image` (format from
   the bytes, structure, no trailing data), the thumbnail limits (longest side at most 512, at most
   512 KiB) and the metadata allow-list of the conversion design (section 7); then it stores them
   as derived objects. A canvas export carries no EXIF or location data, and the allow-list proves
   it. Missing thumbnails show "No thumbnail". A staff page that walks the versions without a
   thumbnail and captures each in turn backfills existing models from one browser session. The
   same capture also covers image versions (draw the image into a canvas), so phase 1 can give
   every Admin list a thumbnail with no worker, no native dependency and no worker write grant.
2. **T8 as the batch spike if staff capture is not enough** (for example to backfill hundreds of
   existing models): measure a pure-Python clay render in the zip on the existing GLB parser.
   It keeps ADR-064's zip-first rule and adds no native code.
3. **T2 or T7 only after their own ADR and measurements on arm64**, if a textured server-side
   render is required: a container (or a compressed Chromium plus Node) and `--no-sandbox` are
   significant security and operations costs for a staff convenience.
4. Not recommended: T3 (cannot run Three.js 0.185), T4, T5, T6 (different renderers, large
   native surfaces).

## 6. Benchmark harness design

**Goal:** decide whether a server-side renderer is acceptable before any build or deployment.

| Item | Design |
|---|---|
| Fixtures | The shipped models in `react/public/models/` (Kenney and KayKit, 23 to 36 KB), Asset Library test GLBs (`lai/apps/assets/tests/helpers.py`), and synthetic GLBs at 10k, 100k, 500k, 1M and 5M triangles from `tests/processing/glb_builder.py`; one textured model at 2048 and one at 4096. Nothing downloaded |
| Renderers | Adapters with one interface: `render(glb_path, side) -> png_bytes, timings`. Implemented now: `chromium-swiftshader` (synthetic page). Next: `three-headless-chromium` (a local page bundling three 0.185 and `GLTFLoader`, framing copied from `modelPreviewViewer.ts`), `clay-python` (T8) |
| Metrics | Wall time cold and warm; in-page context, load, draw and read-back times; peak RSS of the whole process tree; output non-blank and deterministic (hash of two runs); install bytes; for Lambda, init duration and billed duration from the platform report |
| Environments | 1) this workstation (done, x86); 2) a Graviton instance or container on arm64, local, no AWS deploy; 3) Lambda only after an approved deployment (W4-8) |
| Pass thresholds (proposed) | p95 under 10 s per 512 thumbnail up to 1M triangles; peak memory under 2 GB; package within Lambda's limits without a container, or a container ADR accepted; a non-blank, stable image for every fixture; no network access during a render |
| Safety while measuring | Fresh temporary profile, no extensions, host resolver mapped to nothing, the page and model served from a temporary directory, sandbox on unless the host cannot provide one (explicit `--allow-no-sandbox`), temporary files removed |
| Output | JSON on stdout; numbers copied into this page with the host named |

Script: `scripts/processing/bench/thumbnail_bench.py` (plan by default; `--run --chromium <path>`
measures). It never deploys, publishes or calls AWS.
