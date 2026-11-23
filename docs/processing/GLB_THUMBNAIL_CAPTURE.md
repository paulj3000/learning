# GLB thumbnail capture: staff guide and QA checklist (ADR-069)

**Browser acceptance has NOT happened.** Everything here was verified by unit tests only (Django
tests, Vitest with mocked renderer and canvas). No real browser, GPU, WebGL context or real
`canvas.toBlob` was exercised. Keep `LAI_THUMBNAIL_CAPTURE` at `off` in every shared environment
until a human completes section 4.

## 1. What it is

A "Capture thumbnail" page for a validated GLB version in Django Admin. Staff orbit and zoom the
model, press Capture, and save the image for review. A capture is a private `pending_review`
`model.thumbnail` derived artifact. It is never published automatically and the GLB is never
changed. Server side rendering is deferred (ADR-069).

## 2. Turning it on and who may use it

- Setting `LAI_THUMBNAIL_CAPTURE=on` (default `off`). With it off the upload endpoint answers 403
  and the page explains that capture is off.
- A staff account needs `assets.view_assetversion` (or change), `assets.capture_derivedartifact`
  to capture, `assets.view_derivedartifact` to see captures, and `assets.review_derivedartifact`
  to accept or reject. Grant them to the group that should capture.
- The version must be a GLB that is validated, published or retired (the states the preview
  allows), at most the model upload limit.

## 3. Routes (all staff-only, under `/admin/assets/assetversion/<id>/`)

| Route | Method | Purpose |
|---|---|---|
| `capture/` | GET | The capture page |
| `capture/upload/` | POST | Receives the image: CSRF header, fields `version_id`, `source_sha256`, file `image` |
| `capture/review/` | POST | Accept or reject one capture of this version |

Upload refusals (JSON, no em dashes): 403 forbidden or switched off, 409 stale version or
unavailable source, 413 over 512 KiB, 415 not PNG or WebP, 422 not square or outside 64 to 1024.

## 4. Manual QA checklist (a human must run this; not done yet)

Setup: a dev environment with `LAI_THUMBNAIL_CAPTURE=on`, `python manage.py ensure_asset_roles`,
a staff account with the permissions in section 2, and at least these validated GLBs: a small
static prop, a textured model, a model with a transparent (blend) material, a very small model
(millimetres), a very large model, and an animated or skinned character. Use current Chrome,
Firefox and Safari.

Page and loading
- [ ] The version change page shows a "Thumbnail capture" section with a link only for a GLB.
- [ ] The capture page loads the model and the status line says it is loaded.
- [ ] Reset view frames the whole model from the front right and above, with margin on every side
      (small and large models both fill the frame).
- [ ] Drag rotates, scroll or pinch zooms, Reset view returns to the framing, Zoom buttons work.
- [ ] No grid or axes are drawn. The background is light grey.
- [ ] The browser network panel shows only: the page, its script and style, the model request
      to `.../preview/model/`, and the upload POST. No third party host, no `blob:` fetch to a
      remote URL.
- [ ] An animated character shows in rest pose.

Capture
- [ ] Capture at 256, 512 and 1024 shows a preview image of that size and says WebP or PNG.
- [ ] Tick transparent: the capture is PNG and the preview shows the page background through it.
- [ ] A browser that cannot encode WebP (Safari older versions) falls back to PNG.
- [ ] The image matches the view (square, same framing).
- [ ] Save for review reports success. The version page and list show the thumbnail.
- [ ] The saved file is under 512 KiB for every size (try a busy textured model at 1024; the
      page should retry at lower quality or ask for a smaller size).
- [ ] A second capture supersedes the first (the first shows as superseded in the artifact list).

Safety and errors
- [ ] Reload the page after the model version was replaced by a new upload: saving a capture
      from the old page is refused with the stale message.
- [ ] A staff account without the capture permission gets 403 on the page; without the
      derived artifact view permission it sees no thumbnail.
- [ ] With the control off the page shows "switched off" and nothing is stored.
- [ ] Accept and Reject work for a reviewer, change the state, and are in the admin history.
- [ ] A GLB with an unsupported compression shows a plain error instead of a blank view.
- [ ] Close the tab or navigate away repeatedly with a large model: memory in the browser task
      manager returns (no leak) and no WebGL context warning accumulates.
- [ ] Keyboard: every button is reachable with Tab and has a visible focus ring.
- [ ] The GLB downloads byte for byte the same before and after (compare SHA-256 on the version
      page).

Record the browser versions, models and results in `docs/IMPLEMENTATION_STATUS.md` when done.

## 5. How it is built

- Page, endpoints and admin integration: `lai/apps/assets/admin_capture.py` (mixin on
  `AssetVersionAdmin`), template `templates/admin/assets/assetversion/capture.html`.
- Image header check in the standard library: `lai/apps/assets/capture_image.py`.
- Storage and supersession: `apps.assets.artifacts.record_staff_capture` (ADR-066).
- Browser: `react/src/features/assets/capture/` (framing math, output and format fallback,
  Three.js component, mount, upload). Built to
  `lai/apps/assets/static/assets/admin/asset-capture.js` with `npm run build:admin-capture` from
  `react/` (rebuild whenever those files or `features/assets/preview/previewModelSource.ts`
  change; the built file is committed, like `asset-preview.js`).
- Tests: `lai/apps/assets/tests/test_capture_admin.py` and the Vitest files in the capture folder.

## 6. Known limits

KTX2 textured models are not decoded by this bundle (ADR-069 open decision 4). Touch devices are
untested. Output is square only.
