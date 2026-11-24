# GLB thumbnail presentation spec (version 1)

Status: **implemented by staff browser capture** (ADR-069, `GLB_THUMBNAIL_CAPTURE.md`). Server
side rendering (headless Chromium, Blender, EGL) is deferred and not built. This spec defines what
a staff GLB thumbnail looks like, independent of the renderer. The reference implementations of
section 3 are `react/src/features/assets/capture/thumbnailFraming.ts` (the one in use, with
unit tests) and the Python module `scripts/processing/bench/thumbnail_framing.py` on branch
`feature/lambda-thumbnail-rendering-design` (the golden values in the TypeScript test come from
it).

The look matches the Admin preview viewer (`react/src/features/assets/preview/modelPreviewViewer.ts`,
Three.js `GLTFLoader`, sRGB output, no tone mapping) so a thumbnail does not surprise staff who
open the interactive preview.

## 1. Inputs and isolation

- A validated GLB version, at most 50 MiB (`GLB_VALIDATION.md`). Binary glTF only.
- The model is loaded only through the existing staff preview route of the same origin, with the
  short-lived preview token. The capture page refuses any other URL (`assertSameOriginUrl`).
  External resources are blocked: a model whose buffers or images use a non-`data:` URI is not
  shown (the validator already rejects them, and the loader refuses to follow one).
- Extensions the loader cannot decode fail with a plain message. KTX2 textures are not decoded in
  the capture bundle (open decision in ADR-069).

## 2. Pose and content

- **Rest pose.** No `AnimationMixer`, no clip is played. Nodes use their authored transforms.
- All meshes of the default scene are drawn. Cameras and lights stored in the file are ignored
  (the rig in section 5 is used). No helpers, grid or axes are drawn.
- Textures load from the embedded buffers only.

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

**Bounds.** In the browser capture the world bounding box is measured from the loaded scene
(`Box3.setFromObject`, precise). The Python reference reads POSITION accessor min and max.

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

"Reset view" in the capture page applies exactly this. Staff may then orbit and zoom, which is the
point of a staff capture. While they do, near and far are recomputed from the camera's current
distance to the bounding sphere centre by the same `near` and `far` formulas, so nothing clips.
Non-finite or inverted bounds are refused, never guessed.

## 4. Background and transparency

| Variant | Background | Format |
|---|---|---|
| Opaque (default) | Solid `#eef1f4`, the Admin viewer's clear colour | WebP, quality 0.85 (retried once at 0.7 if over 512 KiB); PNG when the browser returns another type |
| Transparent (option) | Alpha 0 | PNG, 8 bits per channel |

No ground plane and no shadow are drawn in either variant.

## 5. Lighting and colour

World-fixed rig, same as the Admin viewer:

| Light | Value |
|---|---|
| Hemisphere | sky `#ffffff`, ground `#6b7280`, intensity 1.6 |
| Directional ("sun") | white, intensity 1.8, from position (3, 5, 4) toward the target |

Colour management: Three.js defaults (sRGB output, `NoToneMapping`). Shadows off, no environment
map.

## 6. Output

Square only. Staff choose 256, 512 (default) or 1024 pixels a side. Hard limits, enforced by the
server (`apps/assets/capture_image.py`, `record_staff_capture`): 64 to 1024 pixels on each side and
width equal to height, at most 512 KiB (the `model.thumbnail` role limit), PNG or WebP only,
animated WebP refused. The server reads the header itself; it does not trust the browser's
claimed type. Browser `toBlob` output carries no EXIF, XMP or text metadata.

(The first draft of this spec capped output at 512. The owner-approved staff capture allows an
optional 1024 for close inspection; the byte limit is unchanged.)

## 7. Determinism

A staff capture is a human choice of view, so it is not deterministic. What is recorded: the
exact source version and SHA-256 (stored on the `DerivedArtifact`), the capturing account, the
processor id `lai.staff_capture` version `1.0.0` and profile `browser-capture` version 1. The page
that produced it implements spec version 1 (`SPEC_VERSION` in `thumbnailFraming.ts`). A newer
capture supersedes an older pending or accepted one; nothing is overwritten.

## 8. Acceptance checks

Browser acceptance has **not** happened. The manual checklist is in `GLB_THUMBNAIL_CAPTURE.md`.
Any future automatic renderer must meet:

- Not blank: at least 1 percent of pixels differ from the background (opaque) or have alpha above 0.
- Framing: the silhouette lies inside the central region (at least 4 percent margin on every
  side) for the reset view.
- Fidelity against a staff capture of the same GLB, with tolerances to be measured then.
- No network request.
