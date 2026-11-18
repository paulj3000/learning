# ADR-070: GLB optimization, Meshopt then KTX2, and the compression support policy

**Status: Accepted (owner, 2026-11-18)** for exactly the items in "Decision" below. Everything in
"Open decisions" is not accepted and must not be treated as decided. The principal adds the
`docs/DECISIONS.md` row at integration (`docs/processing/COMPLETION_INTEGRATION.md` section 2).

Task: LAI-LAMBDA-010. Branch: `feature/lambda-meshopt-ktx2` (Workstream F). Evidence:
`docs/processing/GLB_OPTIMIZATION.md` (measurements, gate checklist) and the earlier feasibility
study on `feature/lambda-glb-optimization-design`
(`docs/processing/feasibility/LAI-LAMBDA-010-glb-optimization.md`). Builds on ADR-020 (Three.js
only), ADR-055, ADR-061, ADR-064 (one canonical processing path, zip Lambda workers) and ADR-066
(derived artifacts, Option C).

## Context

- The game's models are glTF 2.0 loaded by three.js `GLTFLoader` (three 0.185.1). Until this
  change no decoder was configured, and both GLB validators refused every compression extension.
- Measured on the repository models (workstation, `GLB_OPTIMIZATION.md`): Meshopt geometry
  compression takes the one skinned NPC from 3,307,456 to 941,508 bytes (28.5%) while preserving
  hierarchy, names, materials, skin and animation clips; the small kit pieces shrink to 48% to
  74%. KTX2 does not shrink these files but cuts calculated GPU texture memory by 4x (for
  example 21.33 to 5.33 MiB for the NPC's 2048x2048 texture).
- The owner approved on 2026-11-18: OPTIMIZATION (Meshopt first, then KTX2) and VALIDATION
  (reject unsupported compression extensions).

## Decision (accepted)

1. **Order.** Meshopt (`EXT_meshopt_compression`) first; KTX2 (`KHR_texture_basisu`, Basis
   Universal in a KTX2 container) second. Each is enabled separately.
2. **Compression support policy.** One table decides how every compression extension is
   treated, used by both validators (Workstream B's `extension_policy.py`; this ADR's statuses in
   `lai_processing/processors/gltf/compression/policy.py`):

   | Extension | Status | Control (default) |
   |---|---|---|
   | `KHR_mesh_quantization` | supported (no decoder) | none |
   | `EXT_meshopt_compression` | supported when enabled | `LAI_GLB_MESHOPT` (`off`) |
   | `KHR_texture_basisu` | supported when enabled | `LAI_GLB_KTX2` (`off`) |
   | `KHR_meshopt_compression` | rejected | none |
   | `KHR_draco_mesh_compression` | rejected | none |
   | `EXT_texture_webp`, `EXT_texture_avif` | rejected | none |

   With a control `off` its extension is rejected exactly as today. Rejection applies whether
   the extension is used or required. Enabling a row changes validator verdicts, so it bumps the
   policy version and the GLB processor version in the same change.

   Implemented as `Support.WHEN_ENABLED` rows in the one validator table
   (`extension_policy.py`, policy version 3; GLB processor `asset.glb_validator` 1.2.0). Django
   reads the controls; the asynchronous validator receives them as the `glb-default` options
   `allow_meshopt` / `allow_ktx2`, so the worker never reads Django settings. Consequence of the
   processor bump: background-validation evidence recorded by an older processor no longer
   satisfies the publication gate, so unpublished drafts and validated versions are validated
   again before publication; published versions are untouched.
3. **Validation of enabled formats is structural and explicit.** `EXT_meshopt_compression`:
   extension fields, per-mode and per-filter rules, parent view consistency, fallback buffer
   rules, `extensionsRequired` semantics, a decoded-size budget, and header-level stream checks
   (no payload decoding; reports say so). `KHR_texture_basisu`: texture source to an
   `image/ktx2` image, KTX2 header and level index checks, Basis supercompression rules, colour
   space consistency with material usage, dimension bounds and a calculated GPU memory estimate.
4. **Loader.** Every `GLTFLoader` the app builds registers three's bundled `MeshoptDecoder` (WASM
   inline, no CDN, no extra request). KTX2 uses `KTX2Loader` with the Basis transcoder files
   bundled from `three/examples/jsm/libs/basis/` by Vite (hashed, same origin, no CDN),
   `detectSupport(renderer)` on the live renderer, and disposal with the engine. Uncompressed
   models are unaffected. Loader support ships before any validator row is enabled (the
   compatibility-gated release, ADR-071).
5. **Optimizer.** `processing/lai_native/optimize` runs pinned native tools (gltfpack 1.3,
   KTX-Software 4.4.2 `toktx`) under versioned profiles, always through the shared native runtime
   adapter (`lai_native.runtime`: fixed path, scrubbed environment, rlimits, bounded output,
   Lambda deadline). The Meshopt profile is conservative:
   `EXT_` only, no simplification, no animation resampling, names kept, float positions and UVs
   so no node or material changes, no texture changes. A job fails (and produces nothing) when
   the output is not smaller, is structurally invalid, or changes anything the game relies on
   (hierarchy, names, materials, skins, clip names and durations, image bytes for Meshopt).
   Outputs are derived artifacts (`model.optimized`, `texture.compressed`,
   `model.optimize_report`) written create-only under `processing/artifacts/` (ADR-066); the
   original is never overwritten and nothing is published automatically.
6. **Not adopted:** Draco, AWS Batch, Fargate, ECS, ECR for this workload, Blender, FBX
   conversion, server-side rendering. The heavy-workload runtime proposal from the feasibility
   branch stays **deferred** (not accepted, not numbered).

## Open decisions (not accepted)

| # | Decision | Notes |
|---|---|---|
| O1 | Production runtime for `asset.optimize` | Measurements fit the zip-Lambda pattern by a wide margin on this corpus (largest: 0.1 s and 18 MiB for gltfpack, a few seconds for UASTC; extrapolated, labelled, in `GLB_OPTIMIZATION.md`), but the binaries have no arm64 gltfpack build yet, the packaging (zip vs layer) and the native-tool import allowlist are Workstream C/G work, and no Lambda run exists. Decide after an arm64 build and one measured dev Lambda run |
| O2 | Turning `LAI_GLB_MESHOPT` / `LAI_GLB_KTX2` `on` in any environment | Requires the gate checklist in `GLB_OPTIMIZATION.md`, including device and browser acceptance (pending) |
| O3 | Publication of optimized derivatives | Promotion path is ADR-066's; publishing a compressed version also needs the control on (gate re-check at publish) |
| O4 | Lossy profiles (simplification, aggressive quantization, ETC1S at low quality) | Each needs per-asset visual sign-off; none is defined |
| O5 | `KHR_meshopt_compression` | Rejected while the Khronos status is Release Candidate; revisit when ratified and the validators cover the v1 bitstream and the `COLOR` filter |
| O6 | Heavy-workload runtime (Batch on Fargate) | Deferred; nothing measured needs it |
| O7 | Decoder delivery headers and any future CSP (`wasm-unsafe-eval`, `worker-src blob:`) | No CSP exists today |

## Implementation notes (2026-11-18, phase 2; within the accepted decision)

- Publication: a version using a gated extension is refused (`compression_disabled`, not
  rejected) while its control is off, at publish and republish; the latest-validation gate still
  applies. Promotion of a `model.optimized` artifact is refused while its control is off.
- Optimize jobs: staff Admin actions "Optimize (Meshopt)" / "Optimize (KTX2)" submit
  `asset.optimize` through `submit_derived_job`; the worker (`asset.glb_optimizer` 1.0.0) writes
  through the create-only artifact store; Django registers the processor version so older
  results are `processor_outdated`. KTX2 textures are prepared by Workstream D's
  `prepare_texture` (ADR-068).
- No runtime was chosen (O1 stays open); nothing was deployed.

## Consequences

- The default configuration behaves exactly as before for uploads: every compression extension
  is still refused.
- The client can already decode Meshopt models and, once a renderer is attached, KTX2 textures;
  a browser without WebAssembly gets a typed, readable error instead of a broken model.
- Optimizer jobs can only add derived artifacts. A staff action is still needed to promote one.
