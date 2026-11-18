# Image conversion (LAI-LAMBDA-013a): contract, operations and measurements

Status: phases 1 and 2 of Workstream D. Phase 1: packaging, processor, privacy. Phase 2 (this
revision): the worker runs the ADR-061 engine over A's frozen derived artifact interface
(`DERIVED_ARTIFACTS.md`), and the Asset Library has the staff actions (section 5b). Decision record: `adr/ADR-068-image-conversion.md`. Nothing here is
deployed; no AWS call was made; no Lambda number exists.

## 1. What exists

| Piece | Path |
|---|---|
| Processor (Pillow) | `processing/lai_native/image/` (`profiles`, `decode`, `prepare`, `colour`, `encode`, `audit`, `convert`) |
| Worker | `lambda/image_worker/` (`handler`) and `lai_native/image/engine.py`, `contract.py` |
| Packaging | `native/pillow/` (`requirements-*.txt` with hashes, `build.py`, notices, vulnerability note, SBOM, `bench.py`) |
| Tests | `tests/native_image/` |

`lai_processing` is untouched and stays standard-library only. The worker imports
`jobs_worker.handler` (strict envelope, wrong-queue rejection, redelivery from the stored result,
`running` and final messages, S3 result storage) and `jobs_worker.aws` (settings, runtime, the
create-only artifact store); it does not fork them.

## 2. Pipeline (one source, one or more profiles)

1. Input at most 10 MiB; format from the leading bytes (PNG, JPEG, WebP; anything else is
   `unsupported_format`, never judged by name or content type).
2. A PNG header stating more than 4096 on a side or 16,000,000 pixels is refused before Pillow
   sees it. Pillow then parses the header only (`Image.open(..., formats=[sniffed])`), with
   `Image.MAX_IMAGE_PIXELS` set to the upload limit and `DecompressionBombWarning` raised as an
   error, and the same limits are checked again on the parsed size, before `load()`.
3. Animated input: refused (`animated_not_supported`), except for profiles marked
   `first_frame_only` (thumbnails). Truncated or corrupt data is `malformed_image`; Pillow's
   truncated-image tolerance is never enabled. Decoded size must equal the header size.
4. EXIF orientation is applied (`ImageOps.exif_transpose`); sides swap for orientations 5 to 8.
5. Mode normalisation: palette and colour-key transparency become RGBA, 1-bit becomes L, 16-bit
   grayscale is reduced for artwork (`bit_depth_reduced`) and refused for data
   (`bit_depth_not_supported`), CMYK is converted for artwork and refused for data.
6. Resize: fit within `max_side` on both axes, aspect preserved, never upscaled; optional power of
   two. Artwork uses Lanczos with Pillow's premultiplied alpha resize; data profiles resize each
   band separately with a box filter (no premultiplication, no ringing).
7. Colour (artwork only): embedded ICC to sRGB with lcms (perceptual), alpha untouched; sRGB or
   missing profile keeps values; gray profiles are ignored with a finding; invalid or over
   1 MiB profiles are refused (`colour_profile_invalid`). A fully opaque alpha channel is dropped.
   PNG's own parser refuses an `iCCP` that inflates past 64 KiB (reported as malformed).
8. Encode with explicit arguments and an `info`-free image (no EXIF, XMP, comments, text, ICC
   except the optional sRGB tag), then walk the output bytes (`audit.py`). A dirty output is
   `output_check_failed` and nothing is stored. Outputs over 10 MiB (or 16 MiB in total) are
   `output_too_large`.

Same input and same Pillow build give the same bytes (single-threaded encoders, fixed arguments,
an sRGB profile with its date and id cleared); a Pillow upgrade is a new `PROCESSOR_VERSION`.

## 3. Profiles (immutable, versioned; `lai_native.image.PROFILES`)

| Profile v1 | Purpose | Output | Settings |
|---|---|---|---|
| `thumbnail-128`, `-256`, `-512` | artwork | WebP lossy q80 | fit in the box, first frame, untagged sRGB |
| `convert-webp` | artwork | WebP lossy q85 | up to 4096, sRGB tagged |
| `convert-webp-lossless` | artwork | WebP lossless | sRGB tagged |
| `convert-png` | artwork | PNG, level 6 | sRGB tagged |
| `convert-jpeg` | artwork | JPEG q88, 4:2:0, optimised | flatten alpha on `#ffffff`, sRGB tagged |
| `texture-data-png` | data | PNG | no transform, exact channels |
| `texture-data-webp` | data | WebP lossless, `exact=True` | no transform, exact channels |
| `texture-colour-webp` | artwork | WebP lossy q90 | sRGB tagged |

Options (`ImageProfile.with_options`, all validated): `max_side` (16 to 4096), `quality`,
`power_of_two`, `flatten_background` (`#rrggbb`), `output_format`. A data profile can never be
lossy, tagged or flattened. At most 4 profiles per job.

## 4. Privacy

Outputs carry no EXIF, GPS, XMP, IPTC, comments, text chunks, embedded thumbnails, maker notes or
device identifiers (tests build sources with all of them and search outputs for the markers and
the planted secret strings, parse them with Pillow, and run the allow-list walk). Results and logs
carry presence flags (`exifPresent`, `gpsPresent`, `xmpPresent`, `iccPresent`, `textPresent`,
`iptcPresent`), the orientation number, a colour profile class (`srgb`, `display-p3`, `adobe-rgb`,
`other`, `none`, `dropped`), sizes and hashes; never coordinates, names, dates or text. The
original object is read with ranged GETs and never written. Child photos, audio and text are
never inputs (the asset key shape `assets/images/...` is enforced).

## 5. Worker contract (canonical request, phase 2)

Kind `asset.convert_image`, queue `image`, settings `jobs_worker.aws.Settings`. The payload is the
ADR-061 `ProcessingJobRequest` that `apps.assets.artifact_jobs.derived_request` builds (input =
the stored object with its recorded size and SHA-256, subject = the version). The handler
(`image_worker.handler.handle`) reuses `jobs_worker.handler.process`, registers `run_convert` in
the jobs core `RUNNERS`, and runs `ExecutionEngine` with the `asset.image_converter` processor
(`lai_native.image.engine`) and `Runtime.artifact_storage(namespace, job id, attempt id)`: the
engine verifies the input copy, applies the limits and deadline, and every output is written with
`ProcessingContext.write_artifact` (create-only, the attempt prefix, `IfNoneMatch="*"`, checksum).

| Contract profile (v1) | Options (defaults) | Role, logical ids |
|---|---|---|
| `image-convert` | `target_format` png, jpeg, webp (webp); `purpose` artwork, data (artwork); `quality` 1 to 100 (85); `lossless` (false); `power_of_two` (false); `flatten_background` `#rrggbb` or empty | `image.converted`, `converted` |
| `image-resize` | the same, plus `max_side` 16 to 4096 (1024); `target_format` also `source` (source) | `image.resized`, `resized` |
| `image-thumbnails` | none | `image.thumbnail`, `thumb-128`, `thumb-256`, `thumb-512` |

Limits in the request (`IMAGE_LIMITS`): input 10 MiB, outputs 16 MiB in total, 60 s, 64 MiB temp,
4 artifacts, 32 KiB metadata. The processor version is `1.0.0` (`PROCESSOR_VERSION`); Django
registers `PROCESSOR_VERSION_RESOLVERS["asset.convert_image"]` from `lai_native.image.contract`
(Pillow free), so an older processor's result is `processor_outdated`.

Result metadata (value free): `tool_versions.pillow`, `source` (format, size, orientation number,
animated), `source_flags` (EXIF, GPS, XMP, ICC present, booleans only) and
`artifact_facts[logical id]` with `width`, `height`, `format`, `source_width`, `source_height`,
`source_format`, `colour_action`, `colour_class`, `alpha_action`, `orientation`, `sanitized`,
`profile`; Django stores these with each derived artifact. Findings: `cmyk_converted`,
`gray_profile_ignored`, `bit_depth_reduced`. Engine error codes: `invalid_input` (malformed,
bad colour profile), `unsupported_input` (format, animation, 16-bit or CMYK data, alpha into JPEG
without a background), `resource_limit_exceeded` (input, pixels, output), `checksum_mismatch`,
`invalid_processing_profile`, `unexpected_failure` (an output failed the metadata audit), plus
the engine's storage and timeout codes.

## 5b. Django side

`apps/assets/image_conversion.py` (`submit`, `eligibility`, `output_rows`, the resolver) and
`apps/assets/admin_image.py` (mixin on `AssetVersionAdmin`): Convert image, Resize image and
Generate thumbnail, permission gated, refused with a safe message unless `LAI_IMAGE_CONVERSION` is
on, and an "Image conversions" section with original and output dimensions and sizes, format,
colour handling, sanitization, a preview and the link to review and promotion (A's). Details and
rules: `docs/ASSET_LIBRARY.md` section 25. Nothing publishes automatically.

### Shared-file changes (phase 2)

| File | Change |
|---|---|
| `lai/apps/assets/admin.py` | class base `ImageConversionAdminMixin` and `IMAGE_FIELDS` appended to the read-only field list (2 lines and an import) |
| `lai/apps/assets/artifact_results.py` | none: the resolver is registered from `image_conversion.py` through `PROCESSOR_VERSION_RESOLVERS` |
| `lambda/build.py`, `jobs_worker`, `tests/lambda` | none |

## 6. Packaging and sizes (measured by `native/pillow/build.py`, 2026-11-18)

Pillow 13.0.0 (current release on PyPI; wheels pinned by sha256, checked by `pip download
--require-hashes` and again by the build). Target wheel
`pillow-13.0.0-cp312-cp312-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl` (cp312, arm64);
x86_64 wheel for local tests.

| Measure | aarch64 (target) | x86_64 (local tests) |
|---|---:|---:|
| Wheel (compressed) | 6,519,309 B | 7,144,542 B |
| Wheel unpacked, nothing pruned | 21,567,855 B | not measured |
| **Function zip, stored (budget basis)** | **13,280,922 B (12.67 MiB)** | 12,439,678 B (11.86 MiB) |
| Function zip, unpacked | 13,253,828 B | 12,412,594 B |
| Function zip, deflate level 9 (informational) | 3,391,518 B | 3,537,673 B |
| Documented budget | 25,165,824 B (24 MiB) | |

Composition of the aarch64 tree: `pillow.libs` 6,446,252 B, `PIL` 6,091,095 B, `lai_processing`
448,835 B, wheel metadata and licences 114,124 B, `jobs_worker` (with vendored core and the
artifact store) 95,501 B, `lai_native` 50,861 B, `image_worker` 4,079 B, notices 3,081 B. The zip is stored, not deflated,
so its bytes and name are reproducible regardless of the zlib build; the same inputs give the
same zip (tested). The budget test fails the build above 24 MiB; actual use is 53 percent of it.
Lambda limits (250 MB unzipped, 50 MB direct upload) do not bind; the function is deployed from S3.

Pruning (8,916,384 B less than the unpruned wheel contents): AVIF (`_avif`, libavif), font
rendering (`_imagingft`, FreeType, HarfBuzz, Brotli, libpng), Tk, Qt, screen grab and type stubs.
The build parses ELF `DT_NEEDED` and refuses to build if a kept library loses a dependency
(libsharpyuv stays: libwebp needs it). `libz.so.1` comes from the Lambda runtime. Licences,
notices and SBOM: `native/pillow/THIRD_PARTY_NOTICES.md`, `sbom-aarch64.cdx.json`,
`pillow-13.0.0.dist-info/` in the zip. Vulnerabilities: `native/pillow/VULNERABILITIES.md` (none
listed for 13.0.0 by PyPI or OSV on 2026-11-18).

Commands (no network after the first download; nothing is uploaded):

```
python3 native/pillow/build.py --arch aarch64 --sbom native/pillow/sbom-aarch64.cdx.json
python3 native/pillow/build.py --arch x86_64
```

## 7. Measurements (x86_64 workstation, NOT Lambda, NOT arm64)

`python native/pillow/bench.py --repeat 3`, 2026-11-18, Pillow 13.0.0, Python 3.12.3, 4 cores.
**The machine was heavily loaded by other jobs (load average 16 to 22 on 4 cores), so seconds are
inflated and only their order of magnitude is meaningful; rerun on a quiet machine before quoting
them.** Peak RSS is the process maximum (interpreter and Pillow about 30 MiB included) and is not
load dependent. 4096 x 4096 is 16,777,216 pixels, over the 16,000,000 limit, so it is refused
(tested); the largest square that converts is 4000 x 4000, the largest at full side 4096 x 3906.
The sources are synthetic smooth noise, so file sizes are indicative only.

| Source | Profile set | Best seconds | Peak RSS |
|---|---|---:|---:|
| JPEG 2048x2048 | thumbnails 128/256/512 | 0.07 | 72 MiB |
| JPEG 2048x2048 | convert-webp / convert-png / convert-jpeg / texture-data-png | 0.75 / 1.56 / 0.08 / 0.96 | 72 to 87 MiB |
| JPEG 4000x4000 (16 MP) | thumbnails | 0.24 | 224 MiB |
| JPEG 4000x4000 | convert-webp / convert-png / convert-jpeg / texture-data-png | 1.92 / 2.60 / 0.18 / 1.92 | 224 to 245 MiB |
| JPEG 4096x3906 | thumbnails / convert-webp / convert-png / convert-jpeg / texture-data-png | 0.14 / 1.84 / 3.92 / 0.57 / 4.27 | 224 to 245 MiB |
| PNG 4000x4000 (9.2 MB) | thumbnails / convert-webp / convert-png / convert-jpeg / texture-data-png | 0.90 / 6.35 / 8.41 / 0.75 / 7.37 | 224 to 254 MiB |
| WebP 4000x4000 | thumbnails / convert-webp / convert-png / convert-jpeg / texture-data-png | 0.39 / 1.92 / 6.56 / 0.62 / 4.51 | 296 to 366 MiB |

Reading: the worst case at the limits is a 16 MP WebP: 366 MiB, which fits 512 MB with headroom and
1024 MB comfortably; the design branch's 345 to 416 MiB (a careless adapter holding every
intermediate) is not directly comparable (different sources and host); the adapter releases each profile's intermediate before the next.
Time is dominated by PNG encoding and lossy WebP encoding; a 60 s job limit within a 120 s timeout
(ADR-068 O-1) leaves a large margin even at the loaded-machine figures. Lambda arm64 timings and
cold start are not measured.

## 8. Reuse by texture preparation (Workstream F, ADR-070)

```python
from lai_native.image import decode_image, get_profile, prepare_texture
prepared = prepare_texture(data, get_profile("texture-data-png").with_options(max_side=1024,
                                                                          power_of_two=True))
prepared.image        # PIL.Image, mode L, LA, RGB or RGBA, 8 bit, resized, colour handled
prepared.pixel_bytes()  # raw interleaved channels, row-major
prepared.width, prepared.height, prepared.mode, prepared.has_alpha
```

`prepare_texture` accepts bytes or a `DecodedImage` (decode once, prepare per profile). Use a data
profile for normal, roughness, metallic, ORM and mask maps and an artwork profile
(`texture-colour-webp` or a copy with `output_format="png"`) for base colour and emissive. The
caller owns what happens next (KTX tooling); this module never writes KTX2.

## 9. Tests

```
# image venv (Pillow installed; real results)
$VENV/bin/python -m pytest -q -p no:cacheprovider -c /dev/null --rootdir . tests/native_image
# shared project venv (no Pillow: the Pillow modules skip cleanly)
POSTGRES_PORT=5432 POSTGRES_DB=lai_test_image \
  /Coding/learning-worktrees/storybook/.venv/bin/python -m pytest -q tests/native_image -rs
```

Packaging tests need the pinned wheels in `build/image/wheels/<arch>/` (gitignored; fetched by
`build.py`) and skip otherwise. Coverage: JPEG, PNG and WebP in and out, resize and thumbnails,
transparency and flattening, all eight EXIF orientations, GPS and other metadata removal (marker
search, Pillow parse, allow-list walk), oversize, malformed, truncated, bit-flipped and bomb
inputs, ICC conversion and tagging, CMYK, data-texture byte equality through lossless PNG and
WebP, band-wise resize, determinism, worker handling with fake AWS clients, zip determinism, hash
pinning, size budget, licence and pruning contents, ELF dependency closure, SBOM equality, and a
subprocess run of the unpacked x86 zip.
