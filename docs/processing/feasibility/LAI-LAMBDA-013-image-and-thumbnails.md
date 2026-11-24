# LAI-LAMBDA-013 feasibility report: image conversion and GLB thumbnails

Card: LAI-LAMBDA-013 (asset thumbnail generation and image conversion; split out of
LAI-LAMBDA-010 on 2026-11-16). Branch `feature/w4-image-feasibility`, based on the canonical
processing branch (`2333d9e`). Date: 2026-11-17.

**State: feasibility complete; nothing implemented, nothing deployed, no dependency added.**
The product still has no imaging library, no thumbnail and no conversion. Everything here waits
for owner decisions (section 7) and, for code, for W0 and W1 of `../WAVE4_HANDOFF.md`.

## 1. Documents

| Page | Contents |
|---|---|
| `LAI-LAMBDA-013-image-support-audit.md` | What exists: validation, limits, metadata, previews, probe, storage, packaging |
| `LAI-LAMBDA-013-packaging.md` | Measured Pillow and libvips wheel sizes, budgets, Lambda limits, packaging options P1 to P5, pure versus native split |
| `LAI-LAMBDA-013-image-conversion-design.md` | Conversion pipeline: bomb protection, orientation, colour, transparency, metadata removal, output limits, local measurements |
| `LAI-LAMBDA-013-glb-thumbnails.md` | Renderer options T1 to T8, local SwiftShader measurement, benchmark harness design |
| `LAI-LAMBDA-013-derived-artifacts.md` | Options A, B and C on the real `apps.assets` models; storage, IAM and retention |
| `../proposals/ADR-PROPOSED-image-conversion-and-thumbnails.md` | Proposed ADR (not accepted, no number) |
| `scripts/processing/bench/measure_native_wheels.py` | Wheel size measurement; downloads only with `--download <dir>` |
| `scripts/processing/bench/image_bench.py` | Offline Pillow benchmark; runs only with `--run` |
| `scripts/processing/bench/thumbnail_bench.py` | Offline renderer benchmark harness; runs only with `--run --chromium <path>` |

## 2. Key facts from the audit

- `MAX_IMAGE_SIDE = 4096` (`lai/apps/assets/validation_media.py:26`) and
  `MAX_IMAGE_PIXELS = 16_000_000` (`validation_media.py:27`), checked at `validation_media.py:101`
  from headers only; images are limited to 10 MiB (`validation_media.py:38-39`).
- No pixel is decoded on the server. Pillow is **not** in `requirements.txt` or
  `requirements-dev.txt`; nothing imports `PIL` or `pyvips`.
- EXIF, XMP, ICC and GPS data are neither read nor stripped: they are stored and, once published,
  delivered unchanged to the game (staff content, not child data; finding A1). EXIF orientation
  is ignored, so a rotated photo can look right in the Admin and wrong as a texture (finding A2).
- The Admin "thumbnail" is the original file (up to 10 MiB) scaled by CSS, re-hashed on every
  view; lists show no image; models have no thumbnail.
- `lai/apps/jobs/core/probe.py` already reads PNG, JPEG and WebP headers (first 256 KiB) for
  `asset.inspect`, without decoding.
- Workers can read the asset bucket and write nothing there; the contract storage port refuses
  writes. A published version's metadata can never be changed.

## 3. Measured and estimated numbers

| Figure | Value | Kind |
|---|---|---|
| Worker zip today (`lambda/build.py`, `ZIP_STORED`) | 351,023 bytes | Measured |
| Worker zip budget (`tests/lambda/test_jobs_worker_package.py:81`) | 2 MiB | Repository fact |
| Pillow 13.0.0, arm64, cp312 wheel | 6,519,309 B compressed; 21,567,855 B unpacked; 26 shared libraries, 20,269,631 B | Measured (wheel directory only, never extracted) |
| pyvips 2.1.0 + pyvips-binary 8.18.7 (libvips) + cffi 2.1.1 + pycparser 3.12 | 8,532,455 B compressed; 20,062,469 B unpacked; `libvips` alone 18,185,169 B | Measured |
| Worker zip with Pillow added, stored as today | about 21.9 MB | Estimated from the measurement |
| Lambda limits | 50 MB zipped (direct upload), 250 MB unpacked with layers, 10 GB container image, no GPU | AWS published quotas, not re-fetched |
| Chrome headless shell (Chrome for Testing 151), x86_64 | 273,378,828 B unpacked | Measured |
| Compressed Lambda Chromium distribution | about 60 to 70 MB | Estimate, unverified |
| Pillow peak RSS at the pixel limit (4096 x 3900, one pass) | JPEG 208 MiB, PNG RGBA 225 MiB, WebP RGBA 271 MiB | Measured, x86 workstation |
| Pillow 256-pixel WebP thumbnail at the pixel limit | about 0.04 to 1.6 s; about 22 KB output | Measured, x86, busy host |
| Pillow full-size WebP re-encode at the pixel limit | about 1.7 to 2.8 s | Measured, x86, busy host |
| SwiftShader WebGL 2, 512 x 512, launch to exit | 1.2 to 1.5 s (10k triangles), 1.6 to 2.0 s (100k), 3.1 to 4.4 s (500k); largest process about 99 MiB | Measured, x86, no GPU, `--no-sandbox` |
| Phase 2 conversion cost | about $0.07 per 1,000 jobs at 1024 MB for 5 s | Estimate (arm64 list price) |

No number above was measured on arm64 or on Lambda. The spike (packaging section 7) does that
after approval.

## 4. Feasibility answers

| Question | Answer |
|---|---|
| Do Pillow or libvips wheels fit the zip? | They fit **Lambda's** limits easily (about 21 MB of 250 MB). They do **not** fit the repository's 2 MiB worker budget (about 10 times over). A container is not needed for image conversion |
| Which library? | Pillow: comparable size, permissive licence, `ImageCms` and orientation helpers, a bomb guard, and enough memory headroom at 16 megapixels. libvips only if the pixel ceiling rises |
| Where does native code run? | In one adapter outside `lai_processing`, behind a port, in a dedicated image worker (P3); everything that decides or checks stays standard library in the zip |
| Can Lambda render GLB thumbnails? | Software WebGL works without a GPU (measured, x86), but a browser is over the unpacked limit without a compressed build or a container, needs `--no-sandbox` in Lambda, and adds a Node runtime. Not adopted without its own ADR and arm64 measurements |
| Is there a no-native path for thumbnails? | Yes: staff browser capture in the Admin with the existing Three.js viewer (and a canvas for images), validated by Django's existing pure-Python validators. Real GPU, the game's own renderer, no worker, no new runtime |
| Where do derived files live? | Option C: staff-only `DerivedObject` rows linked to the source version, stored outside `assets/`; a conversion reaches the game only through Promote (a new unpublished version via `upload_version`) and the existing Publish |

## 5. Recommendation

1. **Phase 1 (no native code): Admin thumbnails by staff browser capture** for models and images
   (GLB report T1), stored as staff-only derived objects (Option C). Needs: the `DerivedObject`
   model, a capture button and backfill page in the Admin preview bundle, a validated Admin POST,
   and an IAM scope for Django on `derived/*`. No worker, no new kind, no write grant for workers.
2. **Phase 2: image conversion with Pillow** as `asset.convert_image` in a dedicated image worker
   function and queue (P3), following the conversion design: header limits before decoding,
   Pillow's guard at the same limit, orientation baked in, sRGB or preserved values, premultiplied
   resizing, metadata-free outputs proved by an allow-list walk, outputs as derived objects,
   promotion by staff into new unpublished versions.
3. **No server-side GLB renderer now.** If a server-side backfill is ever needed, spike a
   pure-Python clay renderer in the existing zip (T8) first; a browser renderer in a container or
   on Fargate (T2, T7) only by its own ADR with arm64 measurements from `thumbnail_bench.py`.
4. **Separately, consider a pure-Python upload warning** for EXIF and GPS presence (finding A1);
   it needs no imaging library and can ship independently once approved.

## 6. Scope coordination with LAI-LAMBDA-010

- **013 owns** thumbnails, image conversion, texture resize and re-encode (including
  power-of-two sizing), the imaging port and its Pillow adapter, and the derived-object record.
- **010 owns** model optimisation (meshopt, Draco), texture compression (KTX2, Basis Universal)
  and its benchmark.
- **Texture resize overlap: shared design owned by 013.** 010 calls 013's imaging port for any
  resize or re-encode before compression, and stores its outputs as derived objects with its own
  purposes; it adds no second imaging library, port or derived-file model. W2d in the handoff
  order already depends on W2b (013's imaging module).

## 7. Owner decisions required

The full list with recommendations is in the proposed ADR (D-1 to D-12). In short:

| # | Decision | Recommended |
|---|---|---|
| D-1 | Accept the proposal and assign an ADR number | Accept |
| D-2 | Phase 2 packaging: dedicated image worker and queue (P3) or a layer on the media worker (P2) | P3 |
| D-3 | A separate zip budget (about 24 MiB) for the image worker; shared worker budget unchanged | Yes |
| D-4 | IAM scopes: Django on `derived/*` (phase 1); image worker read inputs and write its derived prefix only, create-only; Django read and delete there (phase 2) | Approve per phase |
| D-5 | `DerivedObject` model and the "Promote to new version" action | Approve |
| D-6 | Derived storage location and retention | Asset bucket outside `assets/`; prune superseded after 30 days |
| D-7 | GLB thumbnails by staff browser capture; server renderers only by a later ADR (W4-2, W4-3) | Approve |
| D-8 | Colour policy per kind (`to_srgb` or `preserve_values`) | `texture` preserves values |
| D-9 | Upload warning for EXIF and GPS; any metadata rule for published photos | Add the warning |
| D-10 | Licences (Pillow MIT-CMU and bundled libraries; libvips not adopted) | Approve |
| D-11 | Image worker memory, timeout, concurrency | 1024 MB, 120 s, as media; confirm after the spike |
| D-12 | Deployments (W4-8); thumbnails stay staff-only (W4-7) | Unchanged |

## 8. Risks and open items

- Timings were taken on a busy x86 workstation; arm64 Lambda numbers, cold start with a 21 MB
  package and `PIL` import time are not measured yet.
- The total memory of a Chromium process tree was not measured (only its largest process).
- The colour policy for data textures is a content decision; a wrong default would corrupt normal
  maps.
- A browser-captured thumbnail depends on the staff member's GPU and browser (WebP encoding is not
  available in every browser; PNG is the fallback).
- The jobs migration for new kinds (W1) is shared by all Wave 4 cards and must be one migration.
- Pillow's bundled decoders need security updates; each upgrade is a new processor version.
