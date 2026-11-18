# ADR-068: Separate Pillow image function and image privacy

Status: **Accepted (owner, 2026-11-18)** for the decisions marked "Accepted" below. Everything in
"Open decisions" is a proposal and is not accepted. The principal adds the `docs/DECISIONS.md` row
at integration.

Builds on ADR-035, ADR-045, ADR-055, ADR-061, ADR-062, ADR-064 and the design branch
`feature/lambda-image-processing-design` (proposal D-1 to D-12, contract page, Pillow
measurements). Derived artifact storage, roles, create-only writes and retention belong to ADR-066.
Workload page: `docs/processing/IMAGE_CONVERSION.md`.

## Context

The Asset Library accepts PNG, JPEG and WebP up to 10 MiB, 4096 pixels a side and 16,000,000
pixels, checked by pure-Python walkers; nothing decodes a pixel or reads metadata (finding A1:
a phone photo keeps its GPS block, now and when published; A2: EXIF orientation is ignored).
Staff want thumbnails and format, size and orientation conversion. Imaging needs a native library.
ADR-064 keeps one processing path (`apps.jobs`, zip Lambda workers, `jobs_consume_results`) and the
shared worker inside 2 MiB of standard-library Python.

## Accepted decisions (owner, 2026-11-18)

1. **A separate Pillow function.** Image conversion runs in its own zip Lambda
   (`asset.convert_image`, queue `image`, its own DLQ, alarm and role), not in the shared jobs
   worker and not in Django. The shared worker zip stays pure Python inside 2 MiB; the image
   function has its own documented budget of 24 MiB stored. (Design D-1 to D-3, option C; one
   more queue in the existing `jobs-*` family and the one results consumer.)
2. **Pillow pinned by hash, for this function only.** Never in `requirements*.txt`, never imported
   by `lai_processing` (which stays standard-library only). Native code lives only under
   `processing/lai_native/image/`, behind its own import allowlist. libvips is not adopted.
3. **Privacy: strip sensitive metadata from new public-facing derivatives.** Every output of this
   function carries no EXIF, GPS, XMP, IPTC, comments, text chunks, embedded thumbnails, maker
   notes or device identifiers, proved by an allow-list walk of the output bytes before it is
   stored. The only colour data an output may carry is one standard sRGB profile, for artwork
   profiles that ask for it.
4. **Originals are preserved; no silent historical rewrite.** Conversion creates derived artifacts
   and never modifies, replaces or republishes an uploaded version. Published images are never
   rewritten. A derivative reaches the game only through the explicit promotion path of ADR-066.
5. **Colour policy by profile purpose** (design D-7): artwork profiles convert an embedded ICC
   profile to sRGB and tag sRGB; data profiles (normal, roughness, metallic, ORM, masks) apply no
   colour transform, no premultiplication and no lossy encoder, so channel values are preserved
   exactly when not resized.
6. **Bounded and safe decoding.** Format from bytes, formats restricted to PNG, JPEG and WebP,
   the upload limits enforced before decode, decompression bomb warnings raised as errors,
   truncated files refused, animated input refused (first frame for thumbnails), PNG text limits
   lowered.

## Decisions made by the implementation (not separately approved; reviewable)

- Libraries not reachable from PNG, JPEG and WebP input (AVIF, font rendering, Tk, Qt, screen
  grab) are removed from the zip; a build step fails if a kept library loses a dependency.
- Named, versioned profiles (`thumbnail-128|256|512`, `convert-webp`, `convert-webp-lossless`,
  `convert-png`, `convert-jpeg`, `texture-data-png`, `texture-data-webp`,
  `texture-colour-webp`). Options may only narrow a profile within bounds.
- The result and logs carry presence flags and sizes only, never metadata values.
- A reusable `prepare_texture(data, profile) -> PreparedImage` (resize, colour, alpha) so the
  KTX2 texture work (ADR-070) does not add a second imaging path.

## Open decisions (not accepted)

| # | Decision | Recommendation |
|---|---|---|
| O-1 | Memory and timeout of the function (1024 MB, 120 s proposed). Measured peak RSS on an x86 workstation is in `IMAGE_CONVERSION.md`; there is no arm64 or Lambda measurement | Confirm after an arm64 spike on deployment (ADR-071) |
| O-2 | 16-bit grayscale PNG and 16-bit RGB: reduced to 8 bit for artwork with a finding, refused for data textures. Is exact 16-bit preservation needed (height maps)? | Keep refusing until a real asset needs it |
| O-3 | Normal map handling when resized: filtered band by band, not renormalised | Accept; renormalisation is a later profile version |
| O-4 | Exposure of `quality`, `max_side` and `flatten_background` in the Admin form (ADR-066 owns the action) | Staff-only, bounded options as implemented |
| O-5 | Whether upload should also warn or strip (design D-9, D-10): this ADR changes derivatives only. The upload warnings and a read-only report of published images with GPS belong to the security branch | Warn at upload; report only; no rewriting |
| O-6 | Colour tag on thumbnails: untagged (browsers read it as sRGB; 588 bytes saved per file) | As implemented |
| O-7 | Zip budget headroom: measured 12.6 MiB stored against 24 MiB; keep the 24 MiB documented budget or lower it | Keep 24 MiB (room for KTX tooling decisions in ADR-070) |
| O-8 | Pillow release cadence and a continuous advisory scan (see `native/pillow/VULNERABILITIES.md`) | Review every release; automated scan is a separate owner decision |
| O-9 | Licence record: nothing copyleft is bundled (FriBiDi LGPL and libimagequant GPL-3.0 appear in the wheel SBOM as optional, absent system libraries) | Approve the notices as written |

## Consequences

Staff get reviewed, metadata-free derivatives and thumbnails; the privacy gap is closed for
everything this function produces, and nothing existing changes. The cost is one function, queue,
DLQ, alarm and role (infrastructure code is Workstream G's), a hash-pinned native dependency with a
security update duty, and a 12.6 MiB zip. Pillow runs on untrusted staff uploads, so the limits,
format restriction, role (no database, Bedrock or Polly; create-only artifact writes) and output
audit are part of the decision, not options.

## Alternatives considered

Pillow in the shared zip or a layer on the shared worker (shared cold start, process and role),
libvips (LGPL, larger loader surface), Pillow on Django (untrusted decoding on the request path),
a container image (needs its own ADR under ADR-064), a pure-Python stripper at upload (changes
stored bytes and checksums, and does not convert).
