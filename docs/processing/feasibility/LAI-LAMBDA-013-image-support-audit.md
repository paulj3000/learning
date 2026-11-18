# LAI-LAMBDA-013 audit: image support that exists today

Part of the LAI-LAMBDA-013 feasibility study (`LAI-LAMBDA-013-image-and-thumbnails.md`). Audited
on branch `feature/w4-image-feasibility` (base `2333d9e`, the canonical processing branch,
2026-11-17). Read-only: nothing here changes product code. The code wins over this page.

## 1. Summary

| Question | Answer |
|---|---|
| Accepted image formats | PNG, JPEG (baseline, extended and progressive Huffman), WebP (lossy, lossless, extended). SVG, GIF, BMP, TIFF, AVIF and anything else are refused |
| Pixel limits | `MAX_IMAGE_SIDE = 4096` (`lai/apps/assets/validation_media.py:26`), `MAX_IMAGE_PIXELS = 16_000_000` (`validation_media.py:27`), enforced at `validation_media.py:101` |
| Byte limit | `LAI_ASSET_MAX_IMAGE_BYTES`, default 10 MiB (`validation_media.py:38-39`); not set in `lai/config/settings/base.py`, so the default applies everywhere |
| Is any pixel decoded server-side? | No. Every check reads headers and structure only |
| Imaging dependency | None. Pillow is not in `requirements.txt` or `requirements-dev.txt`, nothing imports `PIL` or `pyvips`, and no model uses `ImageField` (Pillow is present in the author's ambient `/Coding/ENV` interpreter, 12.2.0, but the project does not depend on it) |
| EXIF, XMP, ICC, GPS | Not parsed, not reported, not stripped. Stored and published images keep whatever metadata the uploaded file had |
| Thumbnails | None generated. The Admin version page shows the original file scaled by CSS. Models have no thumbnail at all (`docs/ASSET_LIBRARY.md` section 16: "Thumbnails are not built") |
| Background image work | `asset.inspect` probes PNG, JPEG and WebP headers (`lai/apps/jobs/core/probe.py`); informational only |

## 2. Upload validation (`validation.py`, `validation_media.py`)

- **Sniffing.** `sniff_format` (`validation_media.py:46`) decides the format from leading bytes
  (PNG signature, `FF D8 FF`, `RIFF....WEBP`). File names and client content types are ignored.
  `validate_upload` (`validation.py:156`) then checks the family against the definition's kind
  (`formats.KIND_FAMILY`; a `texture`, `image` or `sprite` takes images, `character`, `prop`,
  `collectible` and `kit-piece` take models) and refuses a mismatch as `wrong_file_family`
  (`validation.py:177`).
- **`validate_image`** (`validation_media.py:80`): size first (`_size_ok`, empty or over 10 MiB is
  refused), then a structure walker per format, then `_check_dimensions` (`:97`).
  - **PNG** (`_check_png`, `:117`): signature, `IHDR` first with length 13, every chunk's CRC,
    at least one `IDAT`, ends exactly at `IEND` (trailing bytes refused as `trailing_data`), at
    most 100,000 chunks. Ancillary chunks (`iCCP`, `eXIf`, `tEXt`, `zTXt`, `iTXt`, `acTL` for
    APNG) are walked but not inspected: an APNG passes as a PNG and is shown as its first frame.
  - **JPEG** (`_check_jpeg`, `:159`): segment walk to the first start-of-scan, a SOF0, SOF1 or SOF2
    frame header for the dimensions, arithmetic-coded and lossless JPEGs refused, and the file must
    end with `FF D9`. APP1 (EXIF, XMP) and APP2 (ICC) segments are skipped, not read.
  - **WebP** (`_check_webp`, `:212`): RIFF size must equal the file size (or the size plus one pad
    byte); dimensions from `VP8 `, `VP8L` or `VP8X`. An animated WebP passes with the warning
    `webp_animated` (`:229`). `EXIF`, `XMP ` and `ICCP` chunks are not inspected.
  - **Dimensions** (`:97-115`): zero pixels refused; over 4096 on a side or over 16,000,000 pixels
    refused as `image_too_large`; non-power-of-two sides get the warning `not_power_of_two`.
- **Result.** `metadata = {"width", "height"}` only. No colour type, bit depth, alpha flag,
  colour profile, orientation or metadata presence is recorded on the version.

**Finding A1 (privacy, staff content). Verified against the code 2026-11-17; since then the synchronous validator warns (`image_location_present`, `image_metadata_present`), nothing is stripped or rejected.** A JPEG photographed on a phone and uploaded as a texture
keeps its EXIF block (GPS position, device, time) in the stored object, and once published those
bytes are delivered unchanged to the child app through `/api/v1/asset-files/...`. The content is
staff-authored, not child data, so this is not a child-data leak, but it is avoidable location
disclosure about staff. A standard-library detector (APP1 `Exif`/XMP in JPEG; `eXIf`, `tEXt`,
`iTXt`, `zTXt` in PNG; `EXIF`/`XMP ` chunks in WebP) fits the existing walkers and needs no
imaging library; stripping needs a re-encode or a lossless segment rewrite. See the conversion
design, section 7.

**Finding A2 (orientation).** An EXIF orientation tag is not read. `validate_image` reports the
stored width and height, which are swapped for orientations 5 to 8. The Admin `<img>` applies the
orientation (browsers default to `image-orientation: from-image`); a Three.js `TextureLoader`
upload may or may not, depending on the browser and loader path. Staff can therefore see a
correctly rotated image in the Admin and a rotated texture in the game. Not observed in the
shipped assets; recorded as a risk the conversion design removes by baking orientation in.

## 3. The background probe (`lai/apps/jobs/core/probe.py`)

- Pure Python, vendored into the worker zip as `jobs_worker/vendor/jobs_core/probe.py`
  (`lambda/build.py`, `VENDORED`). Used by the `asset.inspect` kind on the media queue.
- `probe()` (`probe.py:324`) reads the first `HEAD_BYTES` = 256 KiB (`:19`) of an image and
  dispatches to `probe_png` (`:156`; width, height, bit depth, colour type), `probe_jpeg`
  (`:172`; width, height, precision, components, progressive) or `probe_webp` (`:205`; width,
  height, lossy, lossless or extended, animated, alpha).
- It never decodes pixels, never raises on bad input (problems become stable codes), and its
  result stays on the job: `asset.inspect` never changes a version.
- It is the natural home for **metadata-only facts** a conversion job needs to plan its work
  (alpha, colour type, presence of ICC or EXIF, orientation), which keeps that part in the zip and
  standard library (packaging study, section 5).

## 4. Previews and presentation

### Django Admin

- **Version page.** `AssetVersionAdmin.file_preview` (`lai/apps/assets/admin.py:530`) calls
  `preview.file_preview_html` (`lai/apps/assets/preview.py:158`). For an image it renders
  `<img src=".../assetversion/<id>/media/">` with `max-width:320px` (`preview.py:173`): the
  **original file** (up to 10 MiB) is downloaded and scaled by the browser. Facts shown: width,
  height, format, size.
- **Media route.** `media_file_view` (`admin.py:320`) requires an active staff session with
  `assets.view_assetversion` (or change), GET only, a previewable status (`VALIDATED`, `PUBLISHED`,
  `RETIRED`), and streams the object through `_verified_response` (`admin.py:836`), which
  re-hashes the whole object before sending it, then sets `nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox` and `Content-Disposition: inline`.
  Every view of a thumbnail therefore costs a full read and SHA-256 of the original.
- **Lists.** The version list shows `preview_link` (text), not an image
  (`admin.py`, `list_display`). The content asset list shows no image either.
- **3D models.** The preview page (`templates/admin/assets/assetversion/preview.html`) loads
  `static/assets/admin/asset-preview.js` (626,865 bytes), built from
  `react/src/features/assets/preview/` by `npm run build:admin-preview`: Three.js 0.185
  (`react/package.json`), `GLTFLoader`, `OrbitControls`, a `WebGLRenderer` created with
  `antialias: true, alpha: false, powerPreference: 'low-power'`
  (`modelPreviewViewer.ts:148`). It renders on demand and has no capture or export function
  (`preserveDrawingBuffer` is not set; nothing calls `toBlob` or `toDataURL`). The bytes come
  from the token-guarded route; the token travels in a header, never a URL.

### React (gameplay)

- Images reach the game only as published versions through the resolver
  (`lai/apps/assets/resolver.py`), which exposes `media: {width, height}` and never drafts,
  reports or storage keys. `react/src/features/island-map/three/assets/mediaAssets.ts` loads them
  with `TextureLoader` and `SRGBColorSpace`, cached per `asset@versionId`.
- There is no React staff asset manager (ADR-045); thumbnails, if built, belong in the Django
  Admin.
- Child avatar photos are a separate subsystem (ADR-042): `react/src/features/child-profile/
  avatarPhoto.ts` crops and re-encodes in the parent's browser (`createImageBitmap` with
  `imageOrientation: 'from-image'`, a canvas, `toBlob`), which drops EXIF. That pipeline is out
  of scope for LAI-LAMBDA-013 and must never be routed through the jobs path (ADR-061 item 7).

## 5. Storage facts that constrain a design

- Asset keys are made only by `storage.object_key`:
  `assets/<models|images|audio>/<asset id>/<version uuid>/<stem>.<format>`, and every storage call
  refuses a key outside `formats.KEY_PREFIXES` (`storage.py:98-100`). A derived object under any
  other prefix is invisible to the resolver, delivery and `AssetStorage` by construction.
- The asset bucket is private, versioned, SSE-S3, TLS-only, retained on stack deletion, with
  non-current versions expiring after 30 days (`infra/lib/assetStorageStack.ts:70-95`).
- The dev artifacts bucket expires `jobs/results/` after 7 days
  (`infra/lib/devArtifactsStack.ts:20-24`), so it cannot hold durable derived files.
- The media worker role has `s3:GetObject` on the asset bucket and nothing else there
  (`infra/lib/devPlatformStack.ts:1125`); the contract storage port refuses every write
  (`lai/apps/jobs/core/contract.py:58`, `PortStorage.put` raises `StoragePermissionDenied`).
- `AssetVersion.IMMUTABLE_FIELDS` (`lai/apps/assets/models.py:50-69`) include `metadata` and
  `validation_report`: a thumbnail or conversion result can never be written onto a published
  version's row.
- The `lai_processing` contracts already define an `artifacts` store with attempt-scoped keys
  `processing/artifacts/<namespace>/<job id>/<attempt id>/<logical id>.<ext>`
  (`processing/lai_processing/contracts/identifiers.py:69`, `artifact_key`) and an
  `ArtifactReference` record (`contracts/artifacts.py`). Nothing on the canonical path writes
  them yet.

## 6. Packaging facts

- The worker zip is pure Python source, written uncompressed (`ZIP_STORED`,
  `lambda/build.py:95-98`) so the bytes and the hash name are reproducible; it collects
  `*.py` files only.
- Size today: **351,023 bytes (measured** with `lambda/build.py`'s `zip_bytes()` on this branch).
  Budget: `ZIP_BUDGET_BYTES = 2 * 1024 * 1024` (`tests/lambda/test_jobs_worker_package.py:81`).
- `tests/processing/test_processing_runtime_independence.py` forbids third-party imports and
  `subprocess`, `ctypes`, `importlib` and similar modules anywhere in `processing/lai_processing`.
  Pillow or pyvips code can therefore never live in `lai_processing`; it needs an adapter outside
  it (packaging study, section 5).
- Media worker: arm64, `python3.12`, 120 s timeout (`devPlatformStack.ts:107`), memory from the
  shared `LambdaMemorySize` parameter (default 512 MB, `:266`), shared by `asset.inspect`,
  `asset.validate_model`, `reference.checksum` and `speech.synthesize`.
