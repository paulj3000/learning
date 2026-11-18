# Proposed ADR: Asset image conversion and image thumbnails (LAI-LAMBDA-013)

**Status: Proposed — not accepted; no ADR number assigned.** First drafted 2026-11-17 on branch
`feature/w4-image-feasibility`; narrowed to image conversion on `feature/lambda-image-processing-design`
(base `48c98a1`). It is not in the `docs/DECISIONS.md` registry and changes nothing until the owner
accepts it and a number is taken from the registry then.

**Scope change.** This proposal now covers **image conversion and image thumbnails only**. GLB
thumbnail rendering (the staff-browser capture and any server-side renderer) moves to a separate
proposal, `ADR-PROPOSED-glb-thumbnail-rendering.md`, written in parallel. Stored derived files
(the `DerivedObject` model, storage, IAM, retention, promotion) follow the shared proposal
`ADR-PROPOSED-derived-artifacts.md` (candidate Option C); this page does not restate or decide
them. Evidence and details: `docs/processing/feasibility/LAI-LAMBDA-013-image-conversion-contract.md`
(contract, profiles, security, packaging, measurements, Admin design) and the other
`LAI-LAMBDA-013-*` pages. Builds on ADR-035, ADR-045, ADR-055, ADR-061, ADR-062 and ADR-064.

## Context

- The Asset Library accepts PNG, JPEG and WebP up to 10 MiB, 4096 pixels a side and 16,000,000
  pixels (`lai/apps/assets/validation_media.py:26-27`, `:38-39`), checked by pure-Python header and
  structure walkers. No pixel is decoded on the server and the project has no imaging dependency.
- Admin shows an image version by downloading the original into an `<img>` scaled by CSS. Staff
  asked for thumbnails and format conversion (LAI-LAMBDA-013, split from LAI-LAMBDA-010).
- **Privacy finding A1, verified in code:** nothing reads or strips EXIF, XMP, ICC or GPS. A phone
  photo uploaded as a texture keeps its location block in the stored object and, once published,
  in the bytes delivered to the game. The data is staff content, not child data, but it is
  avoidable disclosure. Finding A2: the EXIF orientation is ignored, so a texture can look right
  in Admin and rotated in the game.
- ADR-064: one processing path (`apps.jobs`, the ADR-055 queues, zip-packaged arm64 Lambda
  workers, `jobs_consume_results`); zip first; containers only by a later ADR.
- Measured 2026-11-17 (Pillow 13.0.0 arm64 wheel, directory read only): 6,519,309 B compressed,
  21,567,855 B unpacked. Worker zip today 480,706 B against a repository budget of 2 MiB (a
  repository policy; AWS allows 250 MB unzipped including layers and serves the worker from S3).
  Pillow at the pixel limit: peak RSS 345 to 416 MiB with the full conversion steps held at once
  (x86 workstation; not arm64).

## Decision (proposed)

1. **Image conversion in an isolated native worker.** A new contract job type
   `asset.convert_image` produces image thumbnails (WebP, 256 and 512) and staff-requested
   conversions (PNG, JPEG, WebP; downscale; orientation baked in; colour to untagged sRGB or values
   preserved; metadata removed) with **Pillow**, in a **dedicated image function** with its own
   zip, queue, DLQ, alarm and role in `LaiDevPlatform-dev` (packaging option C). The shared worker
   zip stays pure Python inside its 2 MiB budget; the image zip has its own budget (about 24 MiB
   stored). Contract, request and result shape, and profiles `image-thumbnail` and `image-convert`
   v1 are in the contract page.
2. **Pure and native code are separated.** Contracts, plans, metadata inspection and output
   post-conditions live in `processing/lai_processing` (standard library only; the
   runtime-independence test stands). One adapter module outside it imports Pillow behind an
   imaging port.
3. **Derived artifacts.** Outputs are stored and promoted as defined by the shared derived-artifact
   proposal. Image requirements on it: a record per output linked to the immutable source version
   (never altering `IMMUTABLE_FIELDS`), staff-only serving, promotion only as a new unpublished
   version through `upload_version`, idempotency on source hash plus profile and processor
   version. Published images are never rewritten.
4. **Metadata handling (already implemented as inspection, advisory only).** A bounded pure-Python
   scanner (`lai_processing/processors/image/metadata.py`) detects EXIF, GPS, XMP, ICC, IPTC, text
   and orientation, and Django validation adds the warnings `image_location_present` and
   `image_metadata_present` to new image uploads. Nothing is rejected, no stored bytes change, and
   no existing asset is touched. Every converted output is metadata-free, proved by an allow-list
   walk. Whether to go further (reject, or strip at upload) is decision D-9.
5. **Shared with LAI-LAMBDA-010.** Texture resize and re-encode use this module; 010 adds no second
   imaging path or model. Texture compression (KTX2, Basis) stays with 010.
6. **Colour policy.** `to_srgb` for `image` and `sprite`; `preserve_values` for `texture` (data
   maps such as normal or roughness must not be colour converted), unless staff choose otherwise.

## Packaging options for the native worker

Measured sizes above; see the contract page section 5.

| # | Option | Assessment |
|---|---|---|
| A | Raise the shared worker budget (about 24 MiB stored, 7 MiB deflated) | Every kind pays the 22 MB cold start; native decoders share a process and role with Polly and `speech/*` writes. Not recommended |
| B | Lambda layer on the shared function | Zip stays small, but process, role and cold start are still shared. Fallback if the owner wants no new queue |
| **C** | **Dedicated `lai-<env>-jobs-image` function: own zip (worker plus Pillow), queue, DLQ, alarm, role and 1024 MB memory** | **Recommended.** Isolates native decoding and its write grant; needs the owner to confirm a third `jobs-*` queue is within ADR-064's single queue family |
| D | Container image | Not needed for Pillow; ADR-064 requires a later ADR |
| E | Pillow on the Django instance | Rejected: untrusted decoding on the request path |

Pillow over libvips: comparable size (19.1 MiB unpacked, 8.1 MiB compressed), permissive licence
versus LGPL-3.0-or-later, and enough memory headroom at 16 megapixels.

## Security requirements

1. Inputs are image versions in `VALIDATED`, `PUBLISHED` or `RETIRED` only; never child photos
   (ADR-042), audio, text or child-supplied data.
2. Size and SHA-256 verified against the version before processing; format sniffed from bytes must
   equal the version's format.
3. Pure-Python header limits (`MAX_IMAGE_SIDE`, `MAX_IMAGE_PIXELS`, imported, never copied) run
   before any decoder; Pillow opens only `PNG`, `JPEG`, `WEBP`, with `MAX_IMAGE_PIXELS` set to the
   same limit and the bomb warning raised as an error; decoded size must equal header size; PNG
   text limits lowered; truncated images refused; animated inputs refused for conversion.
4. Bounded memory and time: 1024 MB function, intermediates released, 60 s job limit within a
   120 s timeout, at most 4 outputs and 16 MiB per job, input at most 10 MiB.
5. Outputs carry no EXIF, GPS, XMP, IPTC, ICC, text chunks or comments, proved by a pure-Python
   allow-list walk that must also pass `validate_image`. Results and logs carry presence flags only,
   never values.
6. Orientation is baked into pixels; colour per the policy above.
7. Derived outputs are never resolvable or delivered to children; serving follows the shared
   derived-artifact design.
8. The image worker role has no database, Bedrock or Polly access; its S3 grants are those of the
   derived-artifact design.
9. Pillow is pinned by hash; bundled decoders tracked for advisories; each upgrade is a new
   processor version.

## Cost assumptions (estimates; list prices to verify for us-west-1)

| Item | Assumption | Monthly estimate |
|---|---|---|
| Conversions and thumbnails | 1024 MB for up to 5 s per job (x86 timings 0.1 to 1.7 s); arm64 about $0.0000133 per GB-second plus $0.20 per million requests | About $0.07 per 1,000 jobs |
| SQS | Within the free tier | $0 |
| DLQ alarm | One more CloudWatch alarm | About $0.10 |
| Logs | A few KB per job | Negligible |

Cost is not the deciding factor; isolation and operational surface are.

## Owner decisions required

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Accept this proposal and assign an ADR number | Accept |
| D-2 | Packaging: C (dedicated image function, queue, DLQ, alarm, role) versus B (layer on the media worker); confirm a third `jobs-*` queue is within ADR-064 | C |
| D-3 | A separate zip budget (about 24 MiB stored) for the image function; shared budget stays 2 MiB | Yes |
| D-4 | Native dependency: Pillow pinned by hash for the image function only, never in `requirements*.txt` or `lai_processing`; licence record (MIT-CMU plus bundled libraries); libvips not adopted | Approve |
| D-5 | Image function sizing: 1024 MB, 120 s timeout, concurrency as the media worker; confirm after an arm64 spike | Approve after spike |
| D-6 | Contract: declare `asset.convert_image`, profiles `image-thumbnail` v1 and `image-convert` v1, and the one jobs migration shared with the other Wave 4 kinds | Approve |
| D-7 | Colour policy per kind: `to_srgb` for `image` and `sprite`, `preserve_values` for `texture` | Approve or amend |
| D-8 | Admin: the "Create converted copy" and "Promote to new version" actions and whether `convert_assetversion` is a separate permission | Approve; separate permission |
| D-9 | EXIF and GPS policy for uploads: (a) warn only (implemented, recommended), (b) reject images with GPS data (blocks ordinary phone photos), (c) strip at upload with a pure-Python lossless stripper (changes stored bytes and checksums), (d) require published photographic textures to be metadata-free | (a) now; revisit (c) after seeing how often warnings appear |
| D-10 | A read-only report of existing published images that carry GPS data (no rewriting) | Approve a report only |
| D-11 | Derived storage, IAM and retention | Decided in the derived-artifact proposal |
| D-12 | Every deployment and sizing change (W4-8); thumbnails stay staff-only (W4-7) | Unchanged |

Blocked until accepted: the contract declaration and processor, the image function and its
queue, the adapter and its dependency, and the Admin actions. Not blocked: the advisory metadata
scanner and upload warnings already on this branch.

## Alternatives considered

| Alternative | Why not chosen |
|---|---|
| Pillow in the shared worker zip or layer | Shared cold start, process and role with speech and validation |
| libvips | Similar size, LGPL obligations, larger loader surface; memory advantage not needed at 16 megapixels |
| Pillow on Django | Untrusted decoding on the request path and the small instance |
| Container image | Not needed for Pillow; needs its own ADR |
| Reject GPS images at upload | Blocks ordinary phone photos without approval; kept as D-9 (b) |
| Pure-Python re-encoding | No deflate or WebP encoder in the standard library beyond zlib; a PNG-only path is possible but does not cover JPEG or WebP conversion |

## Consequences

Staff get image thumbnails and reviewed, metadata-free conversions; uploads of images with
location data are now warned about. The cost is one function, queue, DLQ, alarm and role, a
hash-pinned native dependency with a security-update duty, and the shared derived-artifact model.
Originals and published versions stay immutable; the game sees converted images only after
review and explicit publication.
