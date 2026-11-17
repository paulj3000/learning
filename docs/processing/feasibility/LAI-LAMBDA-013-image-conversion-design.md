# LAI-LAMBDA-013 image conversion design (not implemented)

Part of the LAI-LAMBDA-013 feasibility study (`LAI-LAMBDA-013-image-and-thumbnails.md`). This is a
design for review. No conversion code exists in the product, and none is added by this study.

## 1. Scope

- **Inputs:** Asset Library image versions only (PNG, JPEG, WebP; `formats.FORMATS`), which are
  staff content. Never child photos (ADR-042: they stay in the parent's browser and the photo
  bucket), audio, text or anything a child supplies.
- **Eligible versions:** `VALIDATED`, `PUBLISHED` or `RETIRED` (the statuses the Admin may
  preview, `preview.PREVIEWABLE`). `DRAFT` and `REJECTED` bytes are never processed.
- **Outputs:**
  - **Thumbnails** for the Django Admin (staff only): WebP, longest side 256 and 512.
  - **Conversions** a staff member asks for: change of format, downscale, metadata removal,
    orientation and colour normalisation, for example a 4096 PNG photo turned into a 2048 WebP
    texture. A conversion that should reach the game becomes a new unpublished version and is
    published by the existing explicit action (derived artifact design).
- **Kinds (proposed):** `asset.convert_image` (thumbnails and conversions of images) and, for GLB
  models, `asset.render_thumbnail` (report section 6). One job may produce up to 4 outputs.
- **Shared with LAI-LAMBDA-010:** texture downscale and re-encode (including power-of-two sizing)
  use this module. That is **shared design owned by 013**; 010 calls it rather than adding a
  second imaging path. Texture compression to KTX2 or Basis stays with 010.

## 2. Pipeline

```text
version (VALIDATED | PUBLISHED | RETIRED)
  -> Django builds the request: version identity, key, SHA-256, size, format, profile, plan
  -> worker: HEAD size <= 10 MiB; read; SHA-256 equals the recorded value      (engine, existing)
  -> pure Python: sniff format; walk structure; header width/height within limits;
     facts: alpha, mode, animation, orientation, ICC, EXIF/XMP/GPS presence      (no decoder yet)
  -> native adapter: decode under the limits below
  -> orientation baked in; colour converted to sRGB (or values preserved); alpha handled
  -> resize (downscale only), premultiplied
  -> encode to a fresh image with no metadata
  -> pure Python: post-conditions on the output bytes (sniffed format, dimensions, allow-listed
     chunks only, passes validation_media.validate_image)
  -> write to the derived prefix (create-only) ; result with facts and output references
  -> Django applies the result: derived records (staff-only) ; promotion is a later staff action
```

## 3. Decompression-bomb and decoder protection (defence in depth)

| # | Control | Where | Value |
|---|---|---|---|
| 1 | Input bytes | Worker, before reading | `<= LAI_ASSET_MAX_IMAGE_BYTES` (10 MiB default), and the profile's `max_input_bytes` |
| 2 | Checksum | Engine, before the processor | Read bytes must match the version's SHA-256 and size |
| 3 | Format from bytes | Pure Python | Sniffed format must equal the version's `format`; anything else is `unsupported_input` |
| 4 | Header dimensions | Pure Python, **before any decoder sees the bytes** | `MAX_IMAGE_SIDE` 4096 (`validation_media.py:26`) and `MAX_IMAGE_PIXELS` 16,000,000 (`validation_media.py:27`), the same constants, imported, never copied |
| 5 | Decoder allow-list | Adapter | `Image.open(stream, formats=["PNG", "JPEG", "WEBP"])`; no other plugin may claim the bytes |
| 6 | Library bomb guard | Adapter | `Image.MAX_IMAGE_PIXELS = 16_000_000` and `DecompressionBombWarning` raised as an error, so Pillow refuses above the same limit (Pillow alone would only warn up to twice its limit) |
| 7 | Decoded size equals header size | Adapter | `image.size` must equal the walker's width and height, else `invalid_input` |
| 8 | Frames | Adapter | Animated WebP and APNG: thumbnails use the first frame; conversions refuse (`animated_not_supported`) |
| 9 | Text and metadata chunks | Adapter | `PngImagePlugin.MAX_TEXT_CHUNK` lowered to 64 KiB and `MAX_TEXT_MEMORY` to 256 KiB; `ImageFile.LOAD_TRUNCATED_IMAGES` stays `False` |
| 10 | Modes | Adapter | Accept `1`, `L`, `LA`, `P` (with or without `tRNS`), `RGB`, `RGBA`, `I;16` (16-bit PNG, reduced to 8 bit), `CMYK` JPEG (converted); anything else `unsupported_input` |
| 11 | Memory | Function | Worst case one RGBA frame at the limit is 64 MiB; the adapter keeps at most three frames alive. Measured peak 208 to 271 MiB (section 9). Function memory 1024 MB |
| 12 | Time | Profile and function | `max_execution_seconds` 60; Lambda timeout 120 s |
| 13 | Isolation | Runtime | Its own function and role (packaging option P3); no database; read the input key, write the derived prefix only |
| 14 | Patching | Build | Pillow pinned by hash; its bundled decoders (libwebp, libjpeg-turbo, libpng, zlib) tracked for CVEs, for example the 2023 libwebp heap overflow (CVE-2023-4863), which affected every WebP decoder of its time |

A Lambda that exceeds its memory is killed, which SQS sees as a failed receive; after 3 receives
the message reaches the DLQ and the job later times out. The header checks (4) make that path
unreachable for files within the limits; the DLQ alarm covers the rest.

## 4. EXIF orientation

- The pure walker reads the EXIF `Orientation` tag (0x0112) from JPEG APP1, PNG `eXIf` and WebP
  `EXIF` without decoding pixels and reports it as a fact.
- The adapter applies it (`ImageOps.exif_transpose`), so pixels are stored upright, and the tag
  is not written to any output.
- For orientations 5 to 8 the output's width and height are swapped relative to the stored
  header. Both fit the square limit, so no limit can be crossed by rotation.
- The result records `orientationApplied: <1..8>`, which lets staff see why a converted texture
  differs from the original's header dimensions (audit finding A2).

## 5. Colour profiles

Game textures are consumed as sRGB (`mediaAssets.ts` sets `SRGBColorSpace`), and untagged web
images are treated as sRGB by browsers. The design therefore normalises to **untagged sRGB**:

| Input | Default action |
|---|---|
| No ICC profile | Treat as sRGB; nothing to convert |
| ICC profile that is sRGB | Drop the profile |
| ICC profile that is not sRGB (Display P3, Adobe RGB, a camera profile) | Convert to sRGB with `ImageCms.profileToProfile` (perceptual intent), then drop the profile |
| CMYK JPEG | Convert to RGB through its profile when present, otherwise the Adobe inverted-CMYK convention; warning `cmyk_converted` |
| Invalid or oversized ICC (over 1 MiB) | Refuse the conversion with `colour_profile_invalid` |
| PNG `gAMA` or `cHRM` without `iCCP` | Ignored (Pillow does not apply them); recorded as a fact |

**Data textures must not be colour-converted.** A normal, roughness or mask map holds values, not
colours. The profile therefore has a `colour` option: `to_srgb` (default for `image` and
`sprite`) or `preserve_values` (pixel values kept, profile simply dropped). Which kinds default
to which is an owner/content decision (decision D-8 in the report); until it is made, `texture`
uses `preserve_values` when the source is untagged or sRGB and refuses to convert a non-sRGB
tagged texture without an explicit option.

## 6. Transparency

- Alpha is kept for PNG and WebP outputs. A palette image with `tRNS` becomes `RGBA`.
- An alpha channel that is fully opaque (extrema 255 to 255) is dropped, which shrinks outputs.
- Resizing is done premultiplied (`RGBa`), then converted back, so transparent edges do not pick
  up dark fringes.
- JPEG output of an image with any non-opaque pixel is refused (`alpha_not_supported`) unless the
  request names a background colour to flatten onto. Thumbnails are WebP and keep alpha.

## 7. Metadata removal (privacy)

- Outputs carry **no** EXIF, GPS, XMP, IPTC, ICC, PNG text (`tEXt`, `zTXt`, `iTXt`), PNG `tIME`,
  JPEG `COM` or APPn segments other than JFIF APP0. The adapter encodes from a fresh image
  built from pixel data only and passes empty `exif` and no `icc_profile`, because Pillow can
  carry `info` metadata into a save.
- **Verified, not trusted:** a pure-Python post-condition walks the output and refuses any chunk
  or segment outside an allow-list (PNG: `IHDR`, `PLTE`, `tRNS`, `IDAT`, `IEND`; JPEG: SOI, APP0
  JFIF, DQT, SOF0 or SOF2, DHT, DRI, SOS, RST, EOI; WebP: `VP8 `, `VP8L`, `ALPH`, and `VP8X`
  without its EXIF, XMP or ICC flags). The output must also pass `validate_image`.
- Results never contain metadata values: only booleans and the orientation number
  (`exifPresent`, `gpsPresent`, `xmpPresent`, `iccPresent`, `orientation`). GPS coordinates,
  device names and timestamps are never copied into a result, a log or the database.
- The original is never modified (published versions are immutable). A metadata-free copy for
  the game is a new unpublished version (derived artifact design).
- Independent of conversion, the same pure detector could add an upload warning
  (`image_metadata_present`, `image_location_present`) to the synchronous validator, with no
  imaging library (audit finding A1). That is a product change for the owner to approve; it is
  not part of this study.

## 8. Output limits and formats

| Setting | Thumbnails | Conversions |
|---|---|---|
| Formats | WebP lossy, quality 80, `method` 4 | PNG, JPEG (quality 60 to 95, default 85), WebP lossy (quality 60 to 95) or lossless |
| Size | Longest side 256 and 512 (profile list, each at most 1024) | Longest side at most 4096 and at most the source's; optional power-of-two rounding down (for textures, shared with 010) |
| Upscaling | Never | Never (`upscale_not_allowed`) |
| Resampling | Lanczos, `reducing_gap` 2.0; JPEG sources use DCT draft scaling first | Lanczos |
| Bytes per output | At most 512 KiB | At most `LAI_ASSET_MAX_IMAGE_BYTES` (10 MiB), so a promoted output always passes upload validation |
| Outputs per job | At most 4 | At most 4 |
| Total output bytes | `max_output_bytes` 16 MiB per job | Same |
| Determinism | Same input, profile version and library versions give the same bytes (single-threaded encoders); library versions are part of the processor identity, so an upgrade is a new processor version | Same |

Error codes (stable, safe to show): `unsupported_input`, `image_too_large`,
`animated_not_supported`, `colour_profile_invalid`, `alpha_not_supported`,
`upscale_not_allowed`, `output_too_large`, `output_check_failed`; job-level failures map to the
existing `ErrorCode` values (`resource_limit_exceeded`, `checksum_mismatch`, `input_missing`,
`processing_timeout`).

## 9. Local measurements (Pillow, x86, not Lambda)

`scripts/processing/bench/image_bench.py --run` on 2026-11-17: Pillow 12.2.0, Python 3.12.3,
x86_64, 4 cores, a shared and busy workstation (load average 4 to 6). Synthetic texture-like
images; each case processed in a fresh child process. **Measured on this host only**: timings
are indicative and noisy; peak RSS (interpreter, Pillow and processing, without synthesis) is the
more reliable figure. arm64 Lambda figures are to be measured in the spike.

| Case (source size) | Peak RSS, one pass | Decode | 256 WebP thumbnail | Full WebP re-encode |
|---|---:|---:|---:|---:|
| 1024 x 1024 PNG RGBA (0.7 MB) | 38.9 MiB | 31 ms | 60 to 96 ms | 149 ms |
| 2048 x 2048 JPEG RGB (0.9 MB) | 72.6 MiB | 38 ms | 26 to 122 ms | 588 ms |
| 2048 x 2048 PNG RGBA (2.9 MB) | 79.2 MiB | 116 ms | 201 to 232 ms | 458 ms |
| 4096 x 3900 JPEG RGB (3.3 MB) | 208.3 MiB | 109 to 198 ms | 41 to 162 ms (DCT draft 56 ms) | 1.7 to 2.8 s |
| 4096 x 3900 PNG RGBA (11.1 MB, over the 10 MiB upload limit) | 225.2 MiB | 590 ms | 0.65 to 1.6 s | 1.8 to 1.9 s |
| 4096 x 3900 WebP RGBA (2.1 MB) | 271.0 MiB | 432 to 548 ms | 51 to 77 ms | 1.7 to 2.1 s |

Readings: every case at the pixel limit stays under 300 MiB, so 512 MB would work and 1024 MB
leaves headroom and more CPU; thumbnails cost well under a second; full-size re-encodes take a
few seconds, far inside a 60 s job limit. A 256-pixel WebP thumbnail is about 22 to 30 KB.
