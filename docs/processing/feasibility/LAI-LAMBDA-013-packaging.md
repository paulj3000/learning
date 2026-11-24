# LAI-LAMBDA-013 packaging feasibility: Pillow, libvips and the Lambda worker

Part of the LAI-LAMBDA-013 feasibility study (`LAI-LAMBDA-013-image-and-thumbnails.md`).
Feasibility only: no dependency was added to `requirements*.txt`, `processing/lai_processing` or
the worker zip, and nothing was deployed.

## 1. How the numbers were obtained

- **Measured** values come from `scripts/processing/bench/measure_native_wheels.py`, run on
  2026-11-17 with `--download` into a new, empty scratch directory outside the repository. The
  wheels were never extracted, imported or executed: sizes come from each wheel's zip directory.
  Command used (the script builds it):

  ```text
  pip download --only-binary=:all: --no-deps --python-version 3.12 --implementation cp \
    --platform manylinux2014_aarch64 --platform manylinux_2_28_aarch64 \
    --platform manylinux_2_34_aarch64 pillow            (then: pyvips pyvips-binary cffi pycparser)
  ```

  Re-run: `python3 scripts/processing/bench/measure_native_wheels.py --download <new empty dir>`
  (or `--measure <dir>` on wheels already downloaded). Without a flag the script prints its plan
  and does nothing else.
- **Estimated** values are marked as such, with their source.
- Lambda quotas are AWS's published Lambda limits (50 MB zipped for direct upload, 250 MB
  unzipped for function code plus layers, 5 layers, 10 GB container images, 128 to 10,240 MB
  memory, 512 MB to 10,240 MB `/tmp`, 15-minute timeout, no GPU). They were not re-fetched for
  this study; re-check them before the ADR is accepted.

## 2. Measured wheel sizes (arm64, CPython 3.12, Amazon Linux 2023 compatible)

| Stack | Wheel(s) | Compressed | Uncompressed | Shared libraries | Licence |
|---|---|---:|---:|---:|---|
| **Pillow** | `pillow-13.0.0-cp312-cp312-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl` | 6,519,309 B (6.2 MiB) | 21,567,855 B (20.6 MiB) | 26 files, 20,269,631 B | MIT-CMU (bundled libraries carry their own: libjpeg-turbo, libpng, libwebp, zlib, lcms2, libtiff, openjpeg, libavif, freetype, harfbuzz, brotli, zstd, xz, libxcb) |
| **pyvips + libvips** | `pyvips-2.1.0` (34,213 / 111,118), `pyvips_binary-8.18.7-cp37-abi3-manylinux_2_28_aarch64` (8,213,253 / 18,850,269), `cffi-2.1.1` (222,389 / 838,972), `pycparser-3.12` (62,600 / 262,110) | 8,532,455 B (8.1 MiB) | 20,062,469 B (19.1 MiB) | `libvips-*.so.42` alone 18,185,169 B | pyvips MIT; **libvips LGPL-3.0-or-later**; cffi MIT-0; pycparser BSD-3-Clause |

Largest Pillow members (uncompressed): `_imaging` 3.6 MB, `libavif` 3.5 MB, `libharfbuzz`
1.7 MB, `libfreetype` 1.3 MB, `libzstd`, `libjpeg`, `libtiff` 0.86 MB each, `libwebp` 0.79 MB.
About 7 MB of that (AVIF, fonts, TIFF, JPEG 2000, X11) is never needed for PNG, JPEG and WebP,
but `_imaging` links several of them, so trimming the wheel is not supported and is not proposed.

Both wheels target glibc 2.28, which the Lambda `python3.12` runtime (Amazon Linux 2023, glibc
2.34) satisfies. Neither was loaded on arm64 in this study; that is the first step of the spike
(section 7).

## 3. Against the budgets

| Budget | Value | Pillow | pyvips stack |
|---|---|---|---|
| Worker zip today | **351,023 B (measured)** | | |
| Repository budget `ZIP_BUDGET_BYTES` (`tests/lambda/test_jobs_worker_package.py:81`) | 2 MiB (2,097,152 B) | **Does not fit** (about 10 times over) | **Does not fit** |
| Worker zip with the wheel added, as `lambda/build.py` writes it (`ZIP_STORED`, uncompressed) | | about 21.9 MB (351,023 + 21,585,115 estimated entry bytes) | about 20.4 MB |
| Same, if the build switched to deflate (estimate: wheel compressed size plus today's zip) | | about 6.9 MB | about 8.9 MB |
| Lambda direct-upload zip | 50 MB zipped | Fits | Fits |
| Lambda function plus layers, unzipped | 250 MB | Fits (about 22 MB) | Fits (about 21 MB) |
| Lambda container image | 10 GB | Not needed | Not needed |

The deployed worker is referenced from S3 (`WorkerCodeKey`), so the 50 MB direct-upload limit
does not apply; the 250 MB unzipped limit does. **Conclusion: either library fits Lambda's zip
limits with a wide margin, and neither fits the repository's 2 MiB worker budget.** Using one
needs an owner decision to change packaging (section 4); a container is not required for image
conversion.

Not measured here: cold-start cost of a 20 MB package on arm64 Lambda (initialisation includes
downloading and unpacking the code; it grows with package size), and the import time of `PIL` on
Graviton. Both are measured in the spike before any decision is final.

## 4. Packaging options

| # | Option | What changes | For | Against |
|---|---|---|---|---|
| P1 | Pillow inside the existing worker zip | `lambda/build.py` vendors a hash-pinned wheel's files (not only `*.py`); budget raised to about 24 MiB; test that only `.py` files ship is relaxed | One artifact, no infrastructure change | Every media kind (speech, inspect, GLB validation) pays the larger package at cold start; native decoders run in the process and role that also call Polly and write `speech/*`; the build needs the wheel at package time |
| P2 | Pillow as a Lambda layer on the media worker | A layer version built from the pinned wheel, referenced by S3 key like `WorkerCodeKey`; the worker imports `PIL` lazily for image kinds only | The worker zip stays pure Python and under 2 MiB; the layer changes rarely | Same shared process, role and cold start as P1; one more artifact and parameter; layers are per-function, so speech still loads it |
| **P3** | **A dedicated image worker function with its own zip (worker code plus Pillow) and its own work queue and DLQ in `LaiDevPlatform-dev`** | New function `lai-<env>-jobs-image`, queue `lai-<env>-jobs-image` (same `jobs-*` family, same schema-1 envelope, same `jobs_consume_results` consumer), its own role and memory setting | Native decoding is isolated: its own role (read the asset input, write only the derived prefix), its own memory (1024 MB) and timeout, no effect on speech or validation cold starts; failures land in their own DLQ | One more queue, DLQ, alarm, role and function to operate; ADR-064 says "no second queue family", so the owner must confirm that a third `jobs-*` queue is within it |
| P4 | Container image | ECR repository and image pipeline | Needed only for a browser renderer (thumbnails, report section 6) | ADR-064: no ECR in dev, containers only by a later ADR; not justified by Pillow's size |
| P5 | Convert on the Django instance | Pillow in `requirements.txt` | No new AWS resources | Decoding untrusted bytes on the request path and on a `t4g.small`; contradicts ADR-061/064 (heavy work leaves the instance); a decompression-bomb bug becomes a web outage. Not recommended |

**Recommendation: P3 with Pillow**, P2 as the fallback if the owner prefers no new queue.
Both keep the shared worker zip pure Python and inside its 2 MiB budget.

## 5. Separating metadata work from native processing

The runtime-independence test (`tests/processing/test_processing_runtime_independence.py`) keeps
`processing/lai_processing` standard-library only. The design keeps it that way:

| Layer | Where | Native? | Contents |
|---|---|---|---|
| Contracts, profiles, limits, errors | `processing/lai_processing/contracts`, `core` | No | Job types `asset.convert_image`, `asset.render_thumbnail` (owner task LAI-LAMBDA-013), profile `image-default` v1 with output limits |
| Metadata and planning | `processing/lai_processing/processors/image/` (new) | No | Header facts (reuse the `probe.py` and `validation_media.py` walkers), detection of EXIF, XMP, ICC, GPS and orientation, the output plan (target size, format, alpha handling), and **post-condition checks on the output bytes** (format sniffed, dimensions as planned, no metadata chunks) |
| Codec port | `processing/lai_processing/ports/imaging.py` (new, a `Protocol`) | No | `decode(bytes, plan) -> Raster`, `encode(Raster, plan) -> bytes`; no implementation |
| Codec adapter | `lambda/jobs_image_worker/imaging_pillow.py` (new, outside `lai_processing`) | **Yes** | The only module that imports `PIL`; implements the port under the limits in the conversion design |
| Django | `lai/apps/assets/...` | No | Submits, applies results, never imports Pillow; Django registers the processor for the idempotency key and the gate exactly as for the GLB validator |

So: the parts that decide (plans, checks, contracts) are pure and testable in CI without native
code; the part that decodes and encodes is one small adapter. The same port lets a libvips adapter
replace Pillow later without touching contracts.

## 6. Pillow or libvips

| | Pillow | libvips (pyvips-binary) |
|---|---|---|
| Size (measured) | 20.6 MiB unzipped | 19.1 MiB unzipped |
| Licence | MIT-CMU | LGPL-3.0-or-later (dynamic linking; record the obligation) |
| Memory model | Whole-frame decode; measured 208 to 271 MiB peak RSS at the pixel limit on x86 (conversion design, section 9) | Streaming and demand-driven; typically much lower peak (not measured here) |
| Safety controls | `Image.open(formats=[...])`, `MAX_IMAGE_PIXELS`, `DecompressionBombError` | `block_untrusted`, operation blocking, loader allow-list; larger default loader surface |
| Colour management | `ImageCms` (lcms2 bundled) | Built in |
| Familiarity in Python teams | High | Lower |

At a 16-megapixel ceiling Pillow's memory fits a 1024 MB function comfortably. **Choose Pillow**;
revisit libvips only if the owner raises the pixel ceiling.

## 7. Spike steps (after owner approval, none run yet)

1. Build the P3 zip locally from a hash-pinned wheel (`pip download --require-hashes`).
2. On a Graviton host (or the dev Lambda after deployment approval), measure: import time of
   `PIL`, cold and warm invocation for the cases in `scripts/processing/bench/image_bench.py`,
   peak memory at 512 and 1024 MB.
3. Run the post-condition checks on every output.
4. Record the numbers in this page and decide memory and timeout.
