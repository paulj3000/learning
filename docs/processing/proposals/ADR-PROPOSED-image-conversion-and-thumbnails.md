# Proposed ADR: Asset image conversion and thumbnails (LAI-LAMBDA-013)

**Status: Proposed — not accepted; no ADR number assigned.** Drafted 2026-11-17 on branch
`feature/w4-image-feasibility` for owner review. It is not in the `docs/DECISIONS.md` registry and
changes nothing until the owner accepts it and a number is taken from the registry at that time.
Evidence: `docs/processing/feasibility/LAI-LAMBDA-013-image-and-thumbnails.md` and the pages it
links. Builds on ADR-035, ADR-045, ADR-055, ADR-061 and ADR-064.

## Context

- The Asset Library accepts PNG, JPEG and WebP images up to 10 MiB, 4096 pixels on a side and
  16,000,000 pixels (`lai/apps/assets/validation_media.py:26-27`, `:38-39`), validated by
  pure-Python header and structure walkers. No pixel is decoded anywhere on the server, and the
  project has no imaging dependency.
- Django Admin shows image versions by downloading the original into an `<img>` scaled by CSS;
  models have no thumbnail. Staff have asked for thumbnails and for format conversion
  (WAVE4_HANDOFF, LAI-LAMBDA-013, split out of LAI-LAMBDA-010 on 2026-11-16).
- Uploaded images keep their EXIF, XMP and ICC data, including GPS positions from phone photos,
  and published bytes are delivered unchanged to the game.
- ADR-064: one processing path (`apps.jobs`, the ADR-055 queues, zip-packaged arm64 Lambda
  workers, `jobs_consume_results`); zip first; containers only by a later ADR; workers read the
  asset bucket and write nothing there.
- Measured (2026-11-17): Pillow 13.0.0 for arm64 CPython 3.12 is 6.5 MB compressed and 21.6 MB
  unpacked; pyvips with libvips 8.18.7 is 8.5 MB and 20.1 MB. The worker zip is 351,023 bytes with
  a 2 MiB budget. Chrome headless shell is 273 MB unpacked (x86_64), over Lambda's 250 MB limit.
  Pillow's peak memory at the pixel limit was 208 to 271 MiB (x86). Software WebGL (SwiftShader)
  rendered a 512 x 512 thumbnail in 1.2 to 4.4 s per run, browser launch included (x86).

## Decision (proposed)

1. **Two phases.**
   - **Phase 1, no native code:** Admin thumbnails for model and image versions are captured in
     the staff member's browser by the existing Three.js preview (and a canvas for images) and
     posted to Django, which checks them with its pure-Python validators and stores them as
     staff-only derived objects. No worker, no new runtime, no worker write grant.
   - **Phase 2, image conversion:** a new contract kind `asset.convert_image` (owner task
     LAI-LAMBDA-013) produces converted images and server-side image thumbnails with **Pillow**,
     in a dedicated image worker (packaging P3 below).
2. **Derived artifacts (W4-4), Option C.** Thumbnails and conversion outputs are `DerivedObject`
   rows in `apps.assets` linked to their source `AssetVersion`, stored in the asset bucket outside
   `assets/` (never resolvable, never delivered to children). A conversion reaches the game only
   when a staff member promotes it: Django calls `services.upload_version` with its bytes, which
   re-validates it and creates a new unpublished `VALIDATED` version recording
   `metadata["derivedFrom"]`; publishing stays the explicit action. Originals and published
   versions are never modified.
3. **Pure and native code are separated.** Contracts, plans, metadata detection and output
   checks live in `processing/lai_processing` (standard library only, so the runtime-independence
   test stands). One adapter module outside it imports Pillow and implements an imaging port.
4. **No server-side GLB renderer now.** Headless Chromium, EGL/OSMesa, pyrender, Blender and
   Filament are not adopted. A server-side renderer (in Lambda, a container or Fargate) needs its
   own ADR with arm64 measurements from `scripts/processing/bench/thumbnail_bench.py`. A
   pure-Python untextured ("clay") renderer inside the existing zip may be spiked first if a
   server-side backfill is required.
5. **Shared with LAI-LAMBDA-010.** Texture resize and re-encode, and the derived-object record,
   are shared design owned by 013; 010 reuses them and adds no second imaging path or model.

## Runtime options for phase 2

| # | Option | Recommendation |
|---|---|---|
| P1 | Pillow inside the shared worker zip (budget raised to about 24 MiB) | Not preferred: speech, inspection and GLB validation share its cold start, process and role |
| P2 | Pillow as a Lambda layer on the media worker, imported lazily | Fallback if the owner wants no new queue |
| **P3** | **Dedicated `lai-<env>-jobs-image` function with its own zip (worker plus Pillow), queue, DLQ, alarm and role, in `LaiDevPlatform-dev`, consumed by `jobs_consume_results`** | **Recommended**: isolates native decoding, its memory (1024 MB) and its write grant |
| P4 | Container image | Not needed for Pillow; required only for a browser renderer, by its own ADR |
| P5 | Pillow on the Django instance | Rejected: untrusted decoding on the request path and on the small instance |

## Security requirements

1. Inputs are Asset Library image or model versions in `VALIDATED`, `PUBLISHED` or `RETIRED` only;
   never child photos (ADR-042), audio, text or any child-supplied data.
2. The worker verifies size and SHA-256 against the version before processing; the format is
   sniffed from the bytes and must equal the version's format.
3. Header limits (`MAX_IMAGE_SIDE`, `MAX_IMAGE_PIXELS`, imported from one place) are checked by
   pure Python before any decoder runs; Pillow's own guard is set to the same pixel limit with its
   warning raised as an error; only the PNG, JPEG and WebP plugins may open the bytes; decoded
   size must equal header size; PNG text-chunk limits lowered; truncated images refused.
4. Outputs carry no EXIF, GPS, XMP, IPTC, ICC, text chunks or comments, and this is proved by a
   pure-Python allow-list walk of every output, which must also pass `validate_image`. Results
   and logs carry metadata presence flags only, never values (no coordinates, devices or times).
5. Orientation is baked into pixels; colour is converted to untagged sRGB unless the profile
   preserves values (data textures).
6. Browser-captured thumbnails are staff uploads: CSRF-protected Admin POST, the
   `assets.change_assetversion` permission, the same validators, longest side at most 512 and at
   most 512 KiB, stored under a key made by code.
7. Derived objects are served only through a staff Admin route with `nosniff`,
   `Content-Security-Policy: default-src 'none'; sandbox`, checksum verification and
   `assets.view_assetversion`. The resolver and the child app never see them (W4-7 for any change).
8. The image worker role may read `assets/images/*` and `assets/models/*` and write only its
   derived prefix, create-only; it has no database access, no Bedrock, no Polly.
9. Pillow is pinned by hash; its bundled decoders are tracked for security advisories and
   upgraded as a new processor version.
10. Bounded resources: input 10 MiB; at most 4 outputs and 16 MiB per job; 60 s job limit within a
    120 s function timeout; 1024 MB memory; reserved concurrency as for the media worker.

## Cost assumptions (estimates; list prices to verify for us-west-1)

| Item | Assumption | Monthly estimate |
|---|---|---|
| Phase 1 thumbnails | Staff browser; S3 storage about 125 KB per version | Under $0.01 per 1,000 versions |
| Phase 2 conversions | 1024 MB for up to 5 s per job (measured x86 timings suggest 0.1 to 3 s); arm64 Lambda about $0.0000133 per GB-second plus $0.20 per million requests | About $0.07 per 1,000 jobs |
| SQS | Within the free tier at this volume | $0 |
| DLQ alarm (P3) | One more CloudWatch alarm | About $0.10 |
| Logs | A few KB per job | Negligible |
| A future container renderer (not proposed) | ECR storage about $0.10 per GB-month plus Fargate or Lambda time | Decided in its own ADR |

Cost is not the deciding factor; operational surface and security isolation are.

## Owner decisions required

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Accept this proposal and assign an ADR number from the registry | Accept |
| D-2 | Phase 2 packaging: P3 (a third `jobs-*` queue and function, which the owner confirms is within ADR-064's single queue family) or P2 (layer) | P3 |
| D-3 | A separate zip budget for the image worker (about 24 MiB stored), leaving the shared worker's 2 MiB budget unchanged | Yes |
| D-4 | IAM: instance policy `Get`, `Put` (create-only) and `Delete` on `derived/*` (phase 1); image worker `GetObject` on `assets/images/*` and `assets/models/*`, `PutObject` on its derived prefix, scoped `ListBucket` (phase 2); Django `Get` and `Delete` on that prefix | Approve per phase |
| D-5 | The `DerivedObject` model and migration in `apps.assets`, and the "Promote to new version" Admin action (permission: the upload permission) | Approve |
| D-6 | Derived storage location (asset bucket, outside `assets/`) and retention (keep while the source exists; prune superseded after 30 days) | Approve |
| D-7 | GLB thumbnails by staff browser capture (W4-2 for phase 1); any server-side renderer only by a later ADR (W4-2, W4-3) | Approve |
| D-8 | Colour policy per kind: `to_srgb` for `image` and `sprite`; `preserve_values` for `texture` unless staff choose otherwise | Approve or amend |
| D-9 | Whether to add pure-Python upload warnings for EXIF and GPS presence to the synchronous validator, and whether published photographic textures must be metadata-free | Add the warning; no hard rule yet |
| D-10 | Licences: Pillow (MIT-CMU) and its bundled libraries recorded in the dependency register; libvips (LGPL-3.0-or-later) not adopted | Approve |
| D-11 | Image worker memory 1024 MB, timeout 120 s, concurrency as the media worker | Approve after the arm64 spike |
| D-12 | Every deployment and sizing change (W4-8); thumbnails stay staff-only (W4-7) | Unchanged |

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Option A: every derived file a new `AssetVersion` | Thumbnails would need extra catalog definitions and publishing lifecycles; workers would need write access to the live prefix |
| Option B alone: derived objects only | No reviewed way for a conversion to reach the game without a second delivery path (ADR-033) |
| libvips | Similar size, LGPL obligations and a larger loader surface; its memory advantage is not needed at 16 megapixels |
| Headless Chromium in Lambda | Over the unzipped limit without a compressed build or container, needs `--no-sandbox` and a Node runtime; software rendering 1 to 4.5 s per thumbnail measured on x86 |
| Blender, pyrender, Filament, EGL/OSMesa | Different renderers from the game, large native surfaces, or no WebGL 2 |
| Pillow on Django | Untrusted decoding on the request path and the small instance |

## Consequences

Phase 1 gives every Admin list a thumbnail without native code or new AWS resources beyond one
IAM scope change. Phase 2 adds one function, queue, DLQ, alarm and role, a hash-pinned native
dependency with a security update duty, and one Django model. Originals and published versions
stay immutable; the game sees converted images only after review and explicit publication.
