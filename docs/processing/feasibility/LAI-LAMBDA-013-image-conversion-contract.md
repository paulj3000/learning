# LAI-LAMBDA-013 image conversion: contract, profiles, security and Admin design

Part of the LAI-LAMBDA-013 feasibility study (`LAI-LAMBDA-013-image-and-thumbnails.md`). A design
for owner review, except section 7, which describes code that exists on this branch. The
conversion processor, the job type and the worker are **not implemented**. GLB thumbnail rendering
is a separate proposal (`ADR-PROPOSED-glb-thumbnail-rendering.md`). Stored derived files follow
the shared design in `../proposals/ADR-PROPOSED-derived-artifacts.md` (candidate Option C); this
page lists only what images need from it (section 6) and designs no storage of its own.

## 1. Job type

| Field | Value |
|---|---|
| `job_type` | `asset.convert_image` (declared in `contracts/job_types.py` only after the owner accepts the ADR) |
| Category, subject | `asset`, `asset_version` (requires an `AssetContext` and an input object) |
| Owner task | LAI-LAMBDA-013 |
| Eligible input | Image versions (`png`, `jpeg`, `webp`) in `VALIDATED`, `PUBLISHED` or `RETIRED`; never child photos (ADR-042, ADR-061 item 7), audio, models |
| Processor | `asset.image_converter` in `processing/lai_processing/processors/image/` (pure planning and checks) plus one native adapter outside `lai_processing` |

`asset.optimize` (LAI-LAMBDA-010) is a separate, reserved type. Texture resize and re-encode for
010 call this module; they do not add an imaging path.

## 2. Request and result shape

The request is the existing `ProcessingJobRequest` (asset context with version id, key, size and
SHA-256; input object; profile reference) with profile options below. Nothing new is added to the
envelope.

Profile options (`OptionSpec` types are only `bool`, `int` and `str`; unknown options are refused):

| Option | Type | Default | Bounds | Meaning |
|---|---|---|---|---|
| `outputs` | str | `thumbnail` | `thumbnail` or `convert` | Thumbnail set or one conversion |
| `target_format` | str | `webp` | `png`, `jpeg`, `webp` | Convert only |
| `webp_lossless` | bool | `false` | | Convert to WebP only |
| `quality` | int | 85 | 60 to 95 | Lossy JPEG or WebP |
| `max_side` | int | 4096 | 16 to 4096, never above the source | Longest side; downscale only |
| `power_of_two` | bool | `false` | | Round each side down to a power of two |
| `colour` | str | `to_srgb` | `to_srgb`, `preserve_values` | Colour policy (decision D-8) |
| `flatten_background` | str | empty | `#rrggbb` or empty | Needed for JPEG output of an image with alpha |

Metadata removal is not an option: every output is metadata-free, always.

Result (`ProcessingJobResult`): `status`, `verdict` (`pass` when every output was produced and
checked, `fail` otherwise; neither publishes anything), `findings` in the Asset Library shape,
`artifacts` as existing `ArtifactReference` records (`artifact_type` `image.thumbnail` or
`image.conversion`, `logical_id` such as `thumb-256` or `converted`, content type, size, SHA-256;
keys under the attempt prefix `processing/artifacts/...` as `contracts/identifiers.artifact_key`
defines), and `metadata`:

```json
{
  "source": {"format": "jpeg", "width": 4000, "height": 3000, "orientation": 6,
             "alpha": false, "colourProfile": "display-p3", "animated": false,
             "exifPresent": true, "gpsPresent": true, "xmpPresent": false,
             "iccPresent": true, "iptcPresent": false, "textPresent": false},
  "plan": {"orientationApplied": 6, "colourAction": "converted_to_srgb", "alphaAction": "none",
           "resampling": "lanczos"},
  "outputs": [{"logicalId": "converted", "format": "webp", "width": 3000, "height": 4000,
               "sizeBytes": 812345, "metadataFree": true}]
}
```

Values never appear: only booleans, the orientation number 1 to 8, a profile class
(`srgb`, `display-p3`, `adobe-rgb`, `other`, `none`) and sizes. Coordinates, device names and
timestamps are never copied to a result, log or the database. Error codes: `unsupported_input`,
`image_too_large`, `animated_not_supported`, `colour_profile_invalid`, `alpha_not_supported`,
`upscale_not_allowed`, `output_too_large`, `output_check_failed`, plus the existing job-level
codes (`checksum_mismatch`, `resource_limit_exceeded`, `processing_timeout`, `input_missing`).

## 3. Profiles

Profiles are immutable and versioned; a behaviour change is a new version.

| Profile v1 | Outputs | Settings |
|---|---|---|
| `image-thumbnail` | WebP at longest side 256 and 512 (each at most 512 KiB), first frame of an animation | Lossy quality 80, `method` 4, Lanczos with `reducing_gap` 2, JPEG DCT draft scaling first, alpha kept, untagged sRGB, no metadata |
| `image-convert` | One of PNG, JPEG, WebP lossy or lossless, at most 4096 on a side | Options above; at most `LAI_ASSET_MAX_IMAGE_BYTES` per output so a promoted file always passes upload validation |

Common rules:

- **Resize:** downscale only, never upscale (`upscale_not_allowed`); at most 4 outputs and 16 MiB
  per job.
- **Orientation:** the EXIF orientation (read by the pure scanner) is baked into the pixels and no
  orientation tag is written; for orientations 5 to 8 the output width and height swap, which
  cannot cross the square limits. The result records `orientationApplied`.
- **Transparency:** alpha kept for PNG and WebP; palette with `tRNS` becomes RGBA; a fully opaque
  alpha channel is dropped; resizing is premultiplied (`RGBa`) to avoid dark fringes; JPEG output
  with any non-opaque pixel needs `flatten_background`, else `alpha_not_supported`.
- **ICC colour profile:** with `to_srgb`, a non-sRGB profile (Display P3, Adobe RGB, a camera
  profile) is converted with `ImageCms.profileToProfile` (perceptual) and then dropped; an sRGB or
  absent profile is dropped or assumed sRGB; CMYK JPEG is converted (`cmyk_converted` warning); an
  invalid or over-1-MiB profile is refused. With `preserve_values` the profile is only dropped
  (normal, roughness and mask maps are data, not colours). The per-kind default is decision D-8.
- **Quality:** table above; the same input, profile version and library versions give the same
  bytes (single-threaded encoders), so a library upgrade is a new processor version.
- **Metadata stripping:** the adapter encodes from a fresh image built from pixel data only, with
  empty `exif` and no `icc_profile`; the pure allow-list walk of the output proves it (section 4).

## 4. Security requirements

1. Header limits come first, in pure Python: sniff the format from bytes and require it equals the
   version's format; read width and height with the existing walkers; refuse above
   `MAX_IMAGE_SIDE` (4096) and `MAX_IMAGE_PIXELS` (16,000,000), imported from one place, before any
   decoder sees the bytes.
2. Size and SHA-256 are verified against the version by the engine before the processor runs.
3. The adapter opens with `Image.open(stream, formats=["PNG", "JPEG", "WEBP"])`, sets
   `Image.MAX_IMAGE_PIXELS` to the same limit with `DecompressionBombWarning` turned into an
   error, requires decoded size to equal header size, never sets `LOAD_TRUNCATED_IMAGES`, and
   lowers PNG text limits (`MAX_TEXT_CHUNK` 64 KiB, `MAX_TEXT_MEMORY` 256 KiB).
4. Bounded memory: one RGBA frame at the limit is 64 MiB. Measured peak RSS with the full
   conversion steps and **no intermediate release** was 345 to 416 MiB at the pixel limit
   (section 8), so the adapter must free each intermediate and the function needs 1024 MB; 512 MB
   is not enough with headroom. Animated inputs: thumbnails use the first frame, conversions
   refuse.
5. Time: 60 s job limit within a 120 s function timeout.
6. Outputs are checked by a pure post-condition: sniffed format, planned dimensions, an
   allow-list walk (PNG `IHDR`, `PLTE`, `tRNS`, `IDAT`, `IEND`; JPEG SOI, JFIF APP0, DQT, SOF0 or
   SOF2, DHT, DRI, SOS, RST, EOI; WebP `VP8 `, `VP8L`, `ALPH`, `VP8X` without EXIF, XMP, ICC
   flags), `validate_image` passes, and the metadata scanner of section 7 reports nothing.
7. The worker has no database, no Bedrock, no Polly; it reads the input object and, if the derived
   design allows, writes only its attempt prefix create-only.
8. Pillow is pinned by hash; bundled decoders (libwebp, libjpeg-turbo, libpng, zlib, lcms2) are
   tracked for advisories (for example CVE-2023-4863) and upgrades ship as new processor versions.
9. Logs and results carry presence flags only, never metadata values or child data.

## 5. Packaging evaluation (measured sizes)

Measured 2026-11-17 by `measure_native_wheels.py --download` into a scratch directory outside the
repository (Pillow 13.0.0, arm64, CPython 3.12, wheel directory only, never extracted; reproduced
the earlier figures): **6,519,309 B compressed, 21,567,855 B unpacked, 26 shared libraries**.
Current worker zip: **480,706 B** (`lambda/build.py` `zip_bytes()` on this branch), budget 2 MiB.
AWS limits: 250 MB unzipped for code plus layers, 50 MB zipped direct upload (the worker comes
from S3, so the second does not bind). The 2 MiB budget is a repository policy.

| Option | Size effect | Cold start and isolation | Operational cost | Verdict |
|---|---|---|---|---|
| **A. Raise the shared worker budget** (Pillow in the one zip, about 24 MiB stored or 7 MiB deflated) | Shared zip 21.9 MB stored | Every kind (speech, inspect, GLB validation, audio) loads 22 MB at cold start; native decoders share a process and role with Polly and `speech/*` writes | None extra | Not recommended |
| **B. Lambda layer** on the shared function | Zip stays pure Python; layer 21.6 MB unpacked | Same shared process, role, cold start; layers are per function | One more artifact and parameter | Fallback only |
| **C. Dedicated image function with its own zip, queue, DLQ, alarm and role** (native-worker runtime without a container) | Own budget (24 MiB stored; the 2 MiB shared budget unchanged) | Isolated decoding, memory (1024 MB) and write grant; others unaffected | One function and queue in the existing `jobs-*` family and consumer | **Recommended** |
| D. Container image | None needed | | ECR, and ADR-064 allows containers only by a later ADR | Not needed for Pillow |
| E. Pillow on Django | | Untrusted decoding on the request path | | Rejected |

**Recommendation: C.** Cold start and arm64 import time are not measured (no arm64 host or
deployment). On this x86 host `import PIL.Image` took 26 ms (warm cache); the Lambda figure comes
from the spike after approval.

## 6. Image requirements on the shared derived-artifact design

(To be reconciled with `ADR-PROPOSED-derived-artifacts.md`; no storage is designed here.)

- A record per output linking the source `AssetVersion` (never changing its `IMMUTABLE_FIELDS`,
  which include `metadata` and `validation_report`), the job, profile version and processor
  version, purpose (`thumbnail-256`, `thumbnail-512`, `converted`), format, width, height, size,
  SHA-256 and `metadataFree`.
- Staff-only, never resolvable, never delivered to children; served through a staff route with
  `nosniff`, a sandboxing CSP and checksum verification.
- Promotion to the game only as a new unpublished version through `services.upload_version`
  (re-validated, `metadata["derivedFrom"]`), published by the existing explicit action. Published
  images are never rewritten.
- Idempotency: source SHA-256 plus profile and processor version plus option hash; the same
  request returns the same outputs.
- Thumbnails of images are small (about 22 to 30 KB for 256 px WebP, measured); retention follows
  the shared design.

## 7. Metadata inspection (implemented, pure standard library)

Verified against the code (`validation_media.py`, `probe.py`): no module reads EXIF, XMP, ICC or
GPS; the walkers skip APP1 and APP2 segments, PNG `eXIf`, `iCCP` and text chunks, and WebP `EXIF`,
`XMP ` and `ICCP` chunks. `validate_image` stores only width and height. The privacy finding A1
of the audit is **confirmed**: a phone photo uploaded as a texture keeps its GPS block in the
stored object and, once published, in the bytes sent to the game.

Implemented on this branch:

- `processing/lai_processing/processors/image/metadata.py`: `scan_image_metadata(read, size)` and
  `scan_image_metadata_bytes`. Reads through bounded `read(offset, length)` calls; walks JPEG
  segments, PNG chunks and RIFF chunks with a 100,000 step limit; reads at most 1 MiB of EXIF and
  1 MiB of XMP; parses only IFD0 (orientation `0x0112`, GPS pointer `0x8825`) and the GPS IFD
  (latitude and longitude tags), at most 1024 entries each; searches uncompressed XMP for
  `GPSLatitude` and `GPSLongitude`; detects ICC (APP2, `iCCP`, `ICCP`), IPTC (APP13), PNG
  text and JPEG comments. It never raises, never decodes pixels and never returns a value:
  `ImageMetadataFacts.as_flags()` has booleans and the orientation number only. Unreadable EXIF
  counts as "location possible". Compressed text and XMP are not searched (limitation).
- `lai/apps/assets/validation_media.py`: after the existing checks, two **warnings** (never
  errors): `image_location_present` and `image_metadata_present`. A scanner failure is swallowed;
  `metadata` stays `{width, height}`; upload, validation, publication and existing assets are
  unchanged. Not applied to existing rows.
- Tests: `tests/processing/test_processing_image_metadata.py` (synthetic bytes built in
  `tests/processing/image_builder.py`, fuzzed truncations and mutations, read bounds, step limit)
  and `lai/apps/assets/tests/test_image_metadata_warning.py`. The bench cross-checks the scanner
  against EXIF written by real Pillow.

**Handling recommendation (D-9):** warn at upload (done); always strip on conversion (design);
do not reject at upload now. Rejecting GPS-bearing images would block ordinary phone photos and is
an owner decision. A pure-Python lossless stripper for upload (drop EXIF except orientation, XMP,
IPTC, text and comments; keep ICC and pixels) is possible without native code but changes stored
bytes and checksums, so it needs approval and is not proposed here.

## 8. Measurements

`scripts/processing/bench/image_bench.py --run --repeat 1` on 2026-11-17: Pillow 13.0.0 in a
throwaway venv outside the repository, Python 3.12.3, **x86_64, 4 cores, a busy shared
workstation (load 3 to 5)**. Not arm64, not Lambda; timings are indicative. The cases now include
the steps of the proposed conversion (an RGB copy for an `ImageCms` transform, a premultiplied
half-size resize, a strip-and-re-encode from a fresh image, and the pure scanner on the output),
kept alive together, so peak RSS is an upper bound for a careless adapter.

| Case (source) | Peak RSS | Decode | 256 WebP thumb | ICC transform | Premult. half resize | Strip + WebP re-encode |
|---|---:|---:|---:|---:|---:|---:|
| 1024 PNG RGBA (0.7 MB) | 47.7 MiB | 17 ms | 33 ms | 15 ms | 41 ms | 118 ms |
| 2048 JPEG (0.9 MB) | 110.6 MiB | 38 ms | 34 ms | 42 ms | 83 ms | 450 ms |
| 2048 PNG RGBA (2.9 MB) | 112.1 MiB | 239 ms | 94 ms | 39 ms | 68 ms | 390 ms |
| 4096x3900 JPEG (3.3 MB) | 345.4 MiB | 88 ms | 83 ms | 167 ms | 280 ms | 1,315 ms |
| 4096x3900 PNG RGBA (11.1 MB, over upload limit) | 352.2 MiB | 302 ms | 163 ms | 149 ms | 263 ms | 1,162 ms |
| 4096x3900 WebP RGBA (2.1 MB) | 415.7 MiB | 262 ms | 45 ms | 159 ms | 286 ms | 1,153 ms |
| 2048 JPEG with EXIF orientation 6 and GPS | 110.7 MiB | 14 ms | 83 ms | 78 ms | 71 ms | 326 ms |

In every case the stripped WebP carried no metadata by the scanner, and for the EXIF case the
scanner reported EXIF, GPS and orientation 6 on the source (a cross-check against real Pillow
output). The ICC figure is an sRGB-to-sRGB transform with built-in profiles (no profile file is
committed), so it is the cost of one transform, not of a particular camera profile.

## 9. Staff Admin design

All in Django Admin (ADR-045); no React staff screen; permission-gated and staff-only.

- **Version page, "Image details" panel:** format, size, dimensions (width and height as stored),
  and, from the latest scan or inspect job, the value-free flags: EXIF, GPS, XMP, ICC, orientation
  (with a note that the stored size may be swapped). A warning banner when
  `image_location_present` is in the validation report: "This image may contain location data and
  is delivered unchanged."
- **Thumbnail:** list columns and the detail page show the 256 px derived thumbnail when one
  exists, else the current CSS-scaled original; one staff route with the controls of the derived
  design.
- **Action "Create converted copy" (permission `assets.change_assetversion` plus a new
  `assets.convert_assetversion` if the owner wants it separate):** a form with the profile
  options of section 2 and a plain-language summary ("WebP, longest side 2048, colours to sRGB,
  metadata removed"). It enqueues one job through `apps.jobs`; the page shows queued, running,
  succeeded or failed with the safe error message, and a retry for retryable failures.
- **Outputs table:** each output with dimensions, size, SHA-256 and a preview; staff compare
  against the original side by side.
- **Action "Promote to new version" (upload permission):** creates an unpublished `VALIDATED`
  version through `upload_version`, then the usual Publish action decides. Never overwrites,
  never publishes, writes an admin history entry naming the source version and profile.
- Empty, loading, failed and "no worker configured" states are shown; nothing here is visible to
  parents or children.

## 10. Owner decisions

See the proposed ADR (`ADR-PROPOSED-image-conversion-and-thumbnails.md`, D-1 to D-12).
