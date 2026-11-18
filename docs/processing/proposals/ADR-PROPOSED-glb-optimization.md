# Proposed decision: GLB optimization uses a native gltfpack on a separate arm64 Lambda function, after authoring-time optimization and loader support are proven

**Status: Proposed — not accepted; no ADR number assigned.** Written 2026-11-17 for
LAI-LAMBDA-010 (Wave 4 owner decision W4-1 for this workload). It is not in the registry of
`docs/DECISIONS.md` and must not be cited as a decision. If the owner accepts it, it receives the
next free number at that time, through the registry check (`scripts/check-adrs.ts`).

Evidence: `docs/processing/feasibility/LAI-LAMBDA-010-glb-optimization.md`. Builds on ADR-020
(Three.js engine), ADR-045 (Django Admin owns asset lifecycle), ADR-055 (dev environment),
ADR-061 (runtime-independent processing) and ADR-064 (one canonical path; zip by default; a
container worker needs its own ADR). Coordinates with LAI-LAMBDA-013, which owns image
conversion, thumbnails, texture resizing and the derived-artifact design ("013 owns image
resize").

## Context

- The game's `GLTFLoader` sites configure no decoder
  (`react/src/features/island-map/three/assets/assetLoader.ts:80`,
  `react/src/features/assets/preview/previewModelSource.ts:168`), and both validators refuse
  `EXT_meshopt_compression`, `KHR_draco_mesh_compression` and `KHR_texture_basisu` with
  `needs_decoder` (`lai/apps/assets/validation.py:65-67,370-375`;
  `processing/lai_processing/processors/gltf/document.py:76-78,518-524`). Compressed outputs
  are therefore unusable today.
- The measured corpus is small: six GLBs (23 KB to 3.3 MB) and 116 `.gltf` files (2.73 MB
  total). The largest GLB, a skinned NPC, is 66% vertex data and carries a 2048x2048 texture.
- No optimization tool was installed when the study was written, so no saving has been measured.
- ADR-064 keeps the existing `jobs-worker` zip standard library only, and
  `tests/processing/test_processing_runtime_independence.py` forbids `subprocess` in
  `lai_processing`. A native tool cannot run inside the existing worker.
- Models do not appear to be compressed in transit (CloudFront does not compress the
  `model/gltf-*` content types; the `/api/*` behavior does not enable compression), which is a
  cheaper first win than any optimizer and is handled separately.

## Proposed decision

1. **Order.** (a) Measure with the local harness (`scripts/processing/bench/`). (b) Optimize at
   authoring time: staff run the tool locally and upload the output as a new version through
   the existing Asset Library and validator. (c) Only if volume justifies it, add the
   server-side `asset.optimize` kind (already reserved in
   `processing/lai_processing/contracts/job_types.py`).
2. **Tool.** `gltfpack` (meshoptimizer, MIT) is the single mesh optimizer. Texture resizing is
   LAI-LAMBDA-013's imaging module, never a second copy. KTX2 encoding uses gltfpack's built-in
   texture compression or KTX-Software (Apache-2.0), chosen by measurement. Draco is not adopted
   unless a source cannot be handled by meshopt.
3. **Runtime (step c only).** A separate arm64 Lambda function on the ADR-055 media path:
   `apps.jobs` kind `asset.optimize`, the same outbox, results queue and
   `jobs_consume_results` consumer, no database access, no second queue family, bucket, stack,
   consumer or job model (ADR-064 decision 1). The existing `jobs-worker` zip is unchanged.
4. **Packaging (step c only).** A `gltfpack` binary built from pinned source for aarch64 in
   GitHub Actions (OIDC, no stored keys). Zip or layer when the measured package fits Lambda's
   250 MB unzipped limit; a container image only if the owner approves a registry for this
   workload under ADR-064 decision 9. The build records the source commit, compiler and binary
   SHA-256.
5. **Execution rules.** argv lists, no shell, no network; the input is an already-validated
   asset version with a verified checksum; `/tmp` sized from measured runs (at most 10 GB);
   memory and timeout from measured runs, inside the media function's limits; the format is
   sniffed, never taken from a name.
6. **Outputs.** A new unpublished `AssetVersion` of the same asset with provenance (source
   version and checksum, tool version, options, processor version, sizes), validated like any
   upload, published only by staff. Never a rewrite of a published version. The write path
   follows 013's derived-artifact design (W4-4); until it exists, step (c) cannot start.
7. **Game support.** No compressed output is published until the loader and both validators
   support that format behind a flag (W4-6): meshopt first, then KTX2; requirements in the
   feasibility report, section 4.6. A validator change bumps the processor version, as an
   explicit owner decision.
8. **CI.** The benchmark harness never runs in CI and never downloads; CI tests of the future
   kind use fakes or a recorded tool fixture, never a downloaded binary.

## Update from Workstream D (2026-11-17, measured)

- Measured with throwaway tools outside the repository (feasibility 6.2): quantization-only
  `gltfpack` output passes both validators and needs no decoder (8 of 8 files), so authoring-time
  optimization (step b) needs no loader change; meshopt adds a further 2.3x on the NPC before gzip
  but only about 1.7x after gzip on the NPC. Texture compression did not shrink files; its value
  is GPU memory (computed, not measured on a device). The npm WASM `gltfpack` cannot compress
  textures: a native build is needed for `-tc`, which is the case for the native-tool ADR.
- Every pipeline step must pass `-kn` (keep node names): the game finds nodes by name and
  `gltfpack` otherwise merges and renames them.
- Found gap G1: the validators do not refuse used-only `KHR_meshopt_compression`,
  `EXT_texture_webp` or `EXT_mesh_gpu_instancing`; pinned by tests, owner decision D9 closes it.
- The exact loader, hosting, CSP and backend change lists are in feasibility 4.7 and 4.8. The
  fallback for jobs Lambda cannot run is `ADR-PROPOSED-heavy-workload-runtime.md`.
- The derived output write path is `ADR-PROPOSED-derived-artifacts.md` (not designed here).

## Alternatives considered

| Alternative | Why not proposed |
|---|---|
| Run `gltfpack` inside the existing `jobs-worker` zip | Breaks the standard-library rule of `lai_processing` and ADR-064's zip contract for that worker |
| Container image for the optimizer from the start | Adds a registry and image pipeline in dev (ADR-064 avoided ECR) before any measurement shows a need |
| Node.js glTF-Transform CLI on Lambda | Brings a Node runtime and an npm dependency tree into processing; gltfpack covers meshopt, quantization, simplification and KTX2 in one binary |
| Optimize on the Django EC2 instance | ADR-061 and card 012 forbid heavy work on the small instance |
| Fargate | Only if measured runs exceed Lambda limits (W4-3) |
| Do nothing | Viable today for the small kit pieces; the NPC model and its texture are the case for acting |

## Consequences

- Step (a) and (b) need no infrastructure. Step (c) adds one function, its role, its alarm and a
  build job, and needs W1 (the Wave 4 jobs migration), W4-4, W4-6, LAI-LAMBDA-011 and an owner
  approval for every deployment.
- Enabling a compressed format adds decoder downloads to the client (measured file sizes in the
  report, section 4.2) and widens what the validators cannot check without decoding.

## Approvals needed

| # | Item |
|---|---|
| P1 | Accept the order (measure, authoring time, then server side) |
| P2 | `gltfpack` as the mesh tool; KTX2 encoder by measurement; Draco not adopted by default |
| P3 | Separate arm64 function for `asset.optimize`; packaging (zip or layer versus container) after measurement |
| P4 | Loader and validator enablement per format (W4-6) and the processor version bump |
| P5 | Derived outputs as new unpublished versions, by 013's design (W4-4) |
| P6 | Every build pipeline addition and every deployment |
