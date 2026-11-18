# ADR-PROPOSED: GLB thumbnail rendering (LAI-LAMBDA-013b)

Status: **Proposed** (no ADR number assigned; not accepted). Date: 2026-11-17.
Branch: `feature/lambda-thumbnail-rendering-design`, from Wave 4 head `48c98a1`.
Builds on: `../feasibility/LAI-LAMBDA-013-glb-thumbnails.md` (options T1 to T8 and the local
SwiftShader measurement) and `../feasibility/LAI-LAMBDA-013-image-and-thumbnails.md`. Presentation:
`../GLB_THUMBNAIL_SPEC.md`. Where derived files are stored: `ADR-PROPOSED-derived-artifacts.md`
(candidate Option C, staff-only preview records); this ADR does not design storage.

Nothing here is implemented. No renderer is added to the canonical ZIP worker, no ECR repository,
deployment or S3 write is authorised. ADR-064 requires a workload-specific ADR before any native
runtime is adopted; this document is that ADR's proposal for the GLB thumbnail workload only.

## 1. Context

Staff browse models in Django Admin as text and open an interactive Three.js preview. A still
thumbnail (256 and 512 pixels) in lists and on the version page would make the library browsable.
Thumbnails are staff-only. Inputs are validated GLBs (at most 50 MiB, 10,000,000 triangles).
Lambda has no GPU, so any server render is software rasterisation. The game's renderer is Three.js
0.185 on WebGL 2 (ADR-020), so fidelity means running that same code.

## 2. Why this is a separate subtask from image conversion

| | 013a image conversion | 013b GLB thumbnail |
|---|---|---|
| Runtime | Pillow (about 21 MB of wheels) in a zip-able Python function | A 3D renderer: a browser or Mesa stack, tens to hundreds of MB, usually a second language runtime |
| Input | One 2D raster, 10 MiB, 16 megapixels | A scene graph with meshes, skins, materials, many textures, up to 10 million triangles |
| Output | A converted file that staff may promote to a new version | A preview image that is never promoted and never reaches the game |
| Acceptance | Bomb protection, orientation, colour policy, metadata removal, byte-exact limits | Framing, lighting and fidelity against the Admin viewer, rest pose, no network, render determinism |
| Failure modes | Decoder bugs, memory at the pixel limit | GPU-less raster time, sandbox absence, driver and GL differences, shader compile failures |
| Packaging fit | Fits Lambda zip limits (not the 2 MiB repository budget) | Does not fit a zip; needs a container or a separate host |
| Dependencies | None on the other | Depends on the same derived-artifact record, nothing else |

Different runtime, different security surface and different acceptance criteria mean they cannot
share one worker, one budget or one ADR. Staff browser capture (T1) already gives phase 1
thumbnails for both without either runtime.

**Proposed card split.** LAI-LAMBDA-013a: image validation, conversion and Pillow image worker.
LAI-LAMBDA-013b: GLB thumbnails, with 013b-1 staff browser capture and 013b-2 an optional
server-side renderer under this ADR. Both depend on the derived-artifacts decision; 013b-2 also
depends on D-T1 below and on W4-8 (deployment approval).

## 3. Constraints applied to every option

ARM64 (Graviton Lambda is the cost default; x86_64 is acceptable for a non-Lambda service), no GPU,
native library size, duration, memory, `/tmp` (Lambda default 512 MB, configurable to 10,240 MB),
lighting and framing parity with the viewer (spec section 3 and 5), transparency (spec section 4),
animated models in rest pose, embedded textures only, and a hostile-input posture: GLB only,
no external URIs, network disabled, no credentials in the renderer's environment, one render per
fresh process.

## 4. Options

| # | Option | Fidelity to game | Size and runtime | No-GPU speed | Sandbox and isolation | Verdict |
|---|---|---|---|---|---|---|
| R1 | **Node + Three.js on headless-gl (OSMesa/llvmpipe)** | Low: headless-gl is WebGL 1 only; Three.js 0.185 needs WebGL 2 and dropped WebGL 1. Would need an old Three.js, so not the game's renderer | Node plus native module plus Mesa: tens of MB (estimate) | Fast start-up (no browser) | Native GL in the process; no browser sandbox | Rejected: cannot run current Three.js |
| R2 | **Headless Chromium (chrome-headless-shell) + SwiftShader WebGL 2 + the Admin viewer's Three.js code** | Highest: identical `GLTFLoader`, shaders, lighting | 273 MB unpacked on x86_64 (measured); a compressed Lambda build is about 60 to 70 MB (estimate, unverified); needs Node or Python driver. arm64: Chrome for Testing has not published a Linux arm64 headless shell to my knowledge (to verify in the spike); arm64 builds come from distribution or community packages | Measured on x86, 4 cores, busy host: 1.2 to 1.5 s (10k triangles), 1.6 to 2.0 s (100k), 3.1 to 4.4 s (500k), largest process 99 MiB (whole tree not measured) | `--no-sandbox` is required in Lambda and Fargate; mitigated by validated input, no network, fresh process, narrow role. A renderer exploit would run with that role | **Recommended renderer**, hosted as in section 5 |
| R3 | EGL/OSMesa software GL with a native program (for example a small C++ or Rust glTF renderer) | Medium: new code, different shading | Mesa libraries tens of MB (estimate) | Unknown | Native parser of untrusted data in-process | Rejected: we would own a renderer and a glTF importer |
| R4 | **Blender headless** (Workbench or Eevee needs GL; Cycles on CPU needs none) | Different look; Cycles is accurate but slow, Workbench is flat | Several hundred MB (estimate) | Cycles CPU: seconds to tens of seconds per image (not measured), start-up seconds | Large native surface; Python scripting inside Blender | Rejected for thumbnails; fine for offline art pipelines |
| R5 | pyrender on OSMesa (Python) | Different PBR shading and importer (trimesh) | pyrender, trimesh, PyOpenGL, Mesa; native | Moderate (not measured) | Native stack plus Python wheels, new dependencies | Rejected: different look, new dependencies |
| R6 | Filament `gltf_viewer` (software Vulkan or GL) | Different look | Custom arm64 build, high effort | Unknown | Native | Rejected: effort without fidelity |
| R7 | **Pure-Python software rasteriser** ("clay" render, z-buffer, Lambert, base colour factors, PNG via `zlib`) on the parser already in `lai_processing` | Low: untextured silhouette | Fits the zip; no new dependency | Pure Python is slow per pixel; unmeasured, likely seconds at 256 for small models and far slower for large ones | Standard library only, no native code | **Fallback spike** if a zip-only server render is wanted; not the game look |
| R8 | Staff browser capture in Admin (T1 in the feasibility report) | Identical, real GPU | None | Instant | Staff browser; Django validates the upload | Phase 1 default, no renderer to adopt |

## 5. Hosting: Lambda container versus a separate processing service

| | Lambda container image | Separate processing service (Fargate task or EC2 batch worker running the R2 container) |
|---|---|---|
| ADR-064 fit | Needs ECR and a container decision, which ADR-064 defers | Same: ECR or an AMI, and its own ADR |
| Size | 10 GB image limit; Chromium fits | No practical limit |
| Cold start | Seconds (large image pulled and unpacked) | Task start 20 to 60 s (Fargate), none if a long-lived EC2 worker |
| Sandbox | None (`--no-sandbox`) | EC2: user namespaces or a seccomp profile can enable the Chromium sandbox; Fargate: no extra capabilities, so `--no-sandbox` |
| Memory and `/tmp` | Up to 10,240 MB and 10,240 MB ephemeral | Any size, local disk |
| Duration | 15 minute cap | None |
| Fits the SQS jobs backbone | Yes, same consumer pattern | Needs a poller; a different shape from the zip workers |
| Operations | Same deploy path as workers once ECR exists | A second service to patch, scale and monitor |

**Recommendation.** Adopt **R2 hosted on Lambda from a container image, in its own function and
queue, never in the canonical ZIP worker**, only after the owner approves a container exception to
ADR-064. If the owner prefers no container path at all, keep R8 (staff capture) as the only
thumbnail path and run the R7 spike only if a bulk backfill proves necessary. A Fargate or EC2
service is the alternative if measured duration or memory exceed Lambda's practical range, or if
the Chromium sandbox is wanted. Reason: R2 is the only option that renders the game's own
Three.js code, so the thumbnail matches the model as staff and children see it; every other
server option is a different renderer with its own bugs and a new importer. The risk is the
`--no-sandbox` posture and arm64 availability, so the render must be isolated as in section 6.

## 6. Isolation requirements for the server renderer

- Input is the already-validated GLB, read from the asset bucket by the function, passed to the
  page as a local file. The page is repository code, served from the image, with no remote scripts.
- Network disabled: `--host-resolver-rules=MAP * ~NOTFOUND`, no VPC egress, and an IAM role with
  no permissions other than reading the input prefix and the result path decided by the derived
  artifacts ADR. No Django, database or credentials in the renderer.
- Fresh Chromium profile per job, process killed at the end, `/tmp` cleaned, a wall-clock timeout
  (proposed 60 s) and a memory ceiling; a render that exceeds either is a typed failure.
- Output re-validated by Django before it is shown (spec section 6).

## 7. Cost assumptions (estimates; list prices not re-fetched)

Basis: Lambda arm64 is about $0.0000133334 per GB-second (the feasibility report's
$0.07 per 1,000 image jobs at 1 GB for 5 s uses the same figure). Request charges are negligible.

| Case | Assumption | Cost |
|---|---|---|
| Typical model | 2,048 MB, 6 s including cold Chromium start | 12 GB-s, about $0.00016 each, $0.16 per 1,000 |
| Large model | 4,096 MB, 20 s | 80 GB-s, about $0.0011 each |
| Backfill of 2,000 models | 2,048 MB, 6 s | about $0.32 |
| ECR image storage | about 1 GB image at about $0.10 per GB-month | about $0.10 per month |
| Staff upload rate | Tens of models per day (an assumption, not measured) | Cents per month |

Even a generous 10x on every figure stays under a few dollars a month. Cost is not the deciding
factor; the container exception, `--no-sandbox` and operations load are. Fargate would add a
start-up minimum (about $0.0007 per task at 1 vCPU and 2 GB, assumed) and a service to run.

## 8. Thresholds for a spike (proposed, to be measured on arm64 before acceptance)

Peak total memory of the process tree under 2 GB; p95 under 10 s per 512 thumbnail up to 1M
triangles; a non-blank, stable image for every fixture; Chromium (or substitute) running on
arm64 Linux; cold-start init under 10 s; no network request during a render; golden-image
tolerance in spec section 8. Local tooling: `scripts/processing/bench/thumbnail_bench.py` (skips
cleanly when no renderer is installed; generates synthetic GLBs at run time; writes nothing to S3;
uses the spec camera from `scripts/processing/bench/thumbnail_framing.py`). **No new measurement was
taken for this proposal**; the only measurements are those in the feasibility report (x86_64
SwiftShader with a synthetic page).

## 9. Owner decisions

| ID | Decision | Recommendation | Alternatives and tradeoffs | Cost | Blocks |
|---|---|---|---|---|---|
| D-T1 | Allow a container exception to ADR-064 for one thumbnail renderer function (R2 on Lambda container, own queue) | Not yet: ship 013b-1 (staff capture) first; decide after staff say capture is not enough | (a) Never: only staff capture, no server render; no ops cost, no backfill automation. (b) Lambda container: reuses the SQS pattern, `--no-sandbox`. (c) Fargate or EC2 service: sandbox possible on EC2, a second service to run | Under a few dollars per month (section 7) plus ECR | 013b-2 |
| D-T2 | Renderer if D-T1 is yes | R2: Chromium + SwiftShader + the Admin viewer's Three.js | R7 clay render (zip, no native code, not the game look); R4 Blender (large, different look) | Small | 013b-2 design |
| D-T3 | Accept spec version 1 (45 degree FOV, 35/20 degree view, background `#eef1f4`, rest pose, 512 and 256) | Accept | Different angle or transparent default; trivial to change before any render exists | None | 013b-1 and 013b-2 |
| D-T4 | Opaque WebP default with a transparent PNG option | Accept | PNG only (larger files) | Storage cents | 013b |
| D-T5 | Run the arm64 spike on a Graviton instance or local container, no AWS deployment | Approve | Skip arm64 and use x86_64 Lambda (about 25 percent higher price per GB-second, assumed) | An hour of instance time | 013b-2 acceptance |
| D-T6 | Accept the 013a and 013b card split | Accept | Keep one card | None | Scheduling |

Out of scope: storage and retention (derived-artifacts ADR), any deployment (W4-8), thumbnail
delivery outside Django Admin (W4-7 keeps it staff-only).
