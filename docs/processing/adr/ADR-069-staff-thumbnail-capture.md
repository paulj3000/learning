# ADR-069: Staff browser GLB thumbnail capture

**Status: Accepted (owner, 2026-11-18)** for exactly the decisions in the table below. Every
other point is listed under "Open decisions" and is not accepted. The `docs/DECISIONS.md` row is
added by the principal at integration.

Builds on ADR-035 and ADR-045 (Django Admin owns the asset lifecycle and the staff preview) and
ADR-066 (derived artifacts). Presentation: `../GLB_THUMBNAIL_SPEC.md`. Procedure:
`../GLB_THUMBNAIL_CAPTURE.md`. Design source: branch
`feature/lambda-thumbnail-rendering-design` (`ADR-PROPOSED-glb-thumbnail-rendering.md`).

## Context

Staff need a still image of a model to recognise it in lists. A server-side renderer needs a GPU
or software GL stack (headless Chromium, Blender or EGL) that the Lambda and dev EC2 platforms do
not have and that adds a large native surface. The Django Admin already previews GLBs in the
browser with Three.js, so staff can capture the view they choose.

## Decision (accepted)

1. **Staff browser capture first.** A staff member opens a "Capture thumbnail" page from a
   validated GLB version in Django Admin, frames the model, and saves a still image. No job, no
   queue, no Lambda.
2. **Server-side rendering is deferred.** Headless Chromium, Blender and EGL are not built, not
   benchmarked on Lambda and not approved.
3. **Same Admin bundle approach.** A small isolated Three.js capture bundle
   (`asset-capture.js`, built from `react/src/features/assets/capture/` by
   `npm run build:admin-capture`, committed like `asset-preview.js`). It is mounted only by the
   Django Admin capture page. There is no separate React staff application.
4. **Server decides, browser proposes.** `POST .../capture/upload/` is staff-only, CSRF protected
   and permission checked (`assets.capture_derivedartifact` plus the version view access that
   previews need), behind `LAI_THUMBNAIL_CAPTURE=on` (default off). It binds the image to the
   exact version id and SHA-256 the page was issued for, refuses a stale or mismatched pair,
   limits size to 512 KiB, sniffs PNG or WebP and reads the pixel size from the header itself
   (square, 64 to 1024), then calls `apps.assets.artifacts.record_staff_capture`. The server
   never trusts the browser's claim that the image came from that GLB beyond that binding.
5. **Private, reviewed, never automatic.** The result is a `pending_review` `model.thumbnail`
   `DerivedArtifact` under `processing/artifacts/<env>/capture/`, shown only to staff through the
   streamed admin media view. Accept and reject use the artifact review services. A capture is
   not promotable, never published automatically, and never changes the GLB.
6. **Spec version 1** (`GLB_THUMBNAIL_SPEC.md`): 45 degree field of view, azimuth 35, elevation
   20, padding 1.25, fixed light rig, `#eef1f4` background or transparent, WebP by default and PNG
   for transparency or when WebP is unavailable, output 256, 512 or 1024 square.
7. **Reuse the preview loader.** The capture page loads the model only through the existing
   same-origin, token-protected preview route, refuses any other URL, and parses an embedded GLB
   with the shared `GLTFLoader` configuration that follows no external resource.

## Consequences

- No new infrastructure, queue, IAM, job kind or migration. Capture reuses Workstream A's
  `record_staff_capture`, retention and review.
- Quality depends on the browser and GPU the staff member uses. Captures are a staff choice, not
  a reproducible build output.
- Browser acceptance has **not** happened. Until a human runs the checklist in
  `GLB_THUMBNAIL_CAPTURE.md` the feature must stay off (`LAI_THUMBNAIL_CAPTURE` default `off`).

## Open decisions (not accepted)

| # | Decision | Notes |
|---|---|---|
| 1 | Server-side rendering later (headless Chromium, Blender, EGL) | Deferred; would need its own ADR, platform and benchmark. |
| 2 | Show a thumbnail to the child or in the public game | Out of scope; captures are staff-only. Needs promotion into an image version and publication. |
| 3 | Automatic thumbnail on upload or publish | Not accepted. Capture is manual. |
| 4 | KTX2 and other compressed-texture models in the capture page | The capture bundle ships no Basis transcoder (to keep the build one text file). Meshopt models decode. Decide with ADR-070. |
| 5 | Promoting an accepted capture into an image asset version | Role is not promotable today. |
| 6 | Mobile and touch capture support | Not tested. |
| 7 | Output above 1024 or a non-square crop | Not accepted. |
| 8 | Whether staff see the thumbnail on the public asset catalog | Not accepted. |
