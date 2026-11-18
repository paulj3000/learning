# GLB thumbnail presentation spec (version 1)

Status: design for LAI-LAMBDA-013b, not implemented. It defines what a staff-only GLB thumbnail
looks like, independent of the renderer that draws it (browser capture, headless Chromium or
anything else). The renderer decision is in
`proposals/ADR-PROPOSED-glb-thumbnail-rendering.md`; where results are stored is in
`proposals/ADR-PROPOSED-derived-artifacts.md` and is not repeated here. The reference
implementation of section 3 is `scripts/processing/bench/thumbnail_framing.py` (unit tests in
`tests/processing/test_thumbnail_framing.py`).

The look matches the Admin preview viewer (`react/src/features/assets/preview/modelPreviewViewer.ts`,
Three.js `GLTFLoader`, sRGB output, no tone mapping) so a thumbnail does not surprise staff who
open the interactive preview.

## 1. Inputs and isolation

- A validated GLB version, at most 50 MiB (`GLB_VALIDATION.md`). Binary glTF only.
- External resources are blocked: a model whose buffers or images use a non-`data:` URI is not
  rendered (the validator already rejects them). The renderer gets the GLB as bytes or a local
  file, with network access disabled. Any request outside the local file is a render failure.
- Extensions the validator reports as unsupported or required-but-unknown fail the render with a
  typed reason; the thumbnail slot shows "No thumbnail" and the reason code.

## 2. Pose and content

- **Rest pose.** No `AnimationMixer`, no clip is played, no frame is sampled. Nodes use their
  authored translation, rotation and scale. Skinned meshes appear in the pose the file stores
  (bind pose with default node transforms). This is the same for animated models and is
  deterministic.
- All meshes of the default scene (`scene`, else scene 0) are drawn. Cameras and lights stored in
  the file are ignored (the rig in section 5 is used). Helpers, grids and axes are not drawn.
- Textures load from the embedded buffers only. A texture that fails to decode is replaced by
  the material's base colour factor and the render is flagged `texture_fallback`.

## 3. Camera

glTF is right-handed, +Y up, the model faces +Z.

| Parameter | Value |
|---|---|
| Projection | Perspective, vertical field of view 45 degrees, aspect 1.0 (square) |
| Azimuth | 35 degrees from +Z toward +X (the camera sits at the model's front right) |
| Elevation | 20 degrees above the horizon |
| Up | +Y |
| Target | Centre of the world bounding box |
| Padding | 1.25 |

These angles equal the Admin viewer's default direction (1, 0.6, 1.4).

**Bounds.** World bounding box of the default scene from the POSITION accessors' `min` and `max`
transformed by node matrices (the validator already computes it as `bounds_min` and `bounds_max`;
no vertex data is read). Skinned deformation and morph targets are not included. A mesh with no
accessor bounds makes the box approximate (`missing_bounds` warning); the render proceeds.

**Framing formula.** With box corners `lo` and `hi`:

```
centre   = (lo + hi) / 2
radius   = |hi - lo| / 2                      (half the box diagonal)
radius   = 1 if radius is 0                    (a point is framed as a unit sphere)
half_v   = fov / 2
half_h   = atan(tan(half_v) * aspect)
distance = padding * radius / sin(min(half_v, half_h))
dir      = (cos(el) * sin(az), sin(el), cos(el) * cos(az))
position = centre + dir * distance
near     = max(distance - 2 * radius, 0.01 * distance)
far      = distance + 2 * radius
```

The bounding sphere always fits inside the view with a 25 percent margin, whatever the size:
a 1 mm prop and a 1 km island both fill the frame. Tight near and far planes give the depth
buffer its precision back (the viewer's `distance / 1000` near plane is looser; thumbnails use
the tighter pair). Non-finite or inverted bounds are a render failure, never a guess.

## 4. Background and transparency

| Variant | Background | Format |
|---|---|---|
| Opaque (default) | Solid `#eef1f4`, the Admin viewer's clear colour | WebP lossy quality 85 (JPEG quality 85 where WebP is not available) |
| Transparent (option) | Alpha 0 | PNG, straight (not premultiplied) alpha, 8 bits per channel |

Material transparency (`alphaMode` `BLEND` or `MASK`) renders as in the game: Three.js sorts
blended objects back to front. In the opaque variant blended surfaces composite over the grey
background. In the transparent variant they composite into the alpha channel; the output is
un-premultiplied before encoding. No ground plane and no shadow are drawn in either variant.

## 5. Lighting and colour

Same rig as the Admin viewer, world-fixed (it does not follow the camera):

| Light | Value |
|---|---|
| Hemisphere | sky `#ffffff`, ground `#6b7280`, intensity 1.6 |
| Directional ("sun") | white, intensity 1.8, from position (3, 5, 4) toward the target |

Colour management: linear working space, sRGB output encoding, `NoToneMapping`, as the viewer.
Shadows off. Environment maps off. Material fidelity is whatever Three.js `MeshStandardMaterial`
gives; a different renderer must match this within the tolerance in section 8 or it is not
acceptable.

## 6. Output

| Size | Use | Source |
|---|---|---|
| 512 x 512 | Version page | Rendered at 512 with 4x multisampling, or at 1024 and reduced by a 2 x 2 box filter |
| 256 x 256 | Admin lists | The 512 image reduced by a 2 x 2 box filter, never rendered separately |

Hard limits (they match the proposed image thumbnail limits): longest side at most 512, file at
most 512 KiB. A render over the byte limit is re-encoded at lower quality once, else fails.

Encoded files carry no metadata: no EXIF, XMP, ICC (sRGB is implied), text chunks or timestamps.
Django re-validates every file with its existing pure-Python image validation before storing it.

## 7. Deterministic output requirements

1. Everything above is a constant of "spec version 1"; a change bumps the version and the stored
   record carries `spec_version`.
2. Same GLB bytes + same spec version + same renderer build identifier produces the same pixels
   and, with fixed encoder settings, the same bytes. The record stores the GLB SHA-256, spec
   version and renderer build id; those three are the idempotency key of the render job.
3. No randomness: fixed camera, no jitter, no time-dependent input (no animation time), no
   `Math.random` in the page, fixed multisample count, fixed zlib or WebP encoder settings.
4. Determinism is guaranteed within one renderer build on one CPU architecture. Across builds or
   architectures, equality is by tolerance (section 8), not bytes.
5. The first render of a version is stored; a later render never silently replaces it. A new
   renderer build or spec version creates a new record and the old one is superseded.

## 8. Acceptance checks for any renderer

- Not blank: at least 1 percent of pixels differ from the background (opaque) or have alpha
  above 0 (transparent).
- Framing: the model's silhouette lies inside the central region (at least 4 percent margin on
  every side) and fills at least 40 percent of the larger dimension for a roughly cubic model.
- Fidelity: against a golden image from the Admin viewer on the same GLB, mean absolute
  channel difference at most 6 of 255 and no more than 5 percent of pixels differing by more than
  32. (Starting values, to be tuned on real fixtures; not yet measured.)
- No network request, no file outside the work directory, peak memory and duration within the
  ADR's thresholds.
- Fixtures: generated synthetic GLBs (quad, sphere, textured, blended, skinned, very large and
  very small), generated at test time; no committed binaries.
