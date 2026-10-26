# Shared Django Asset Manager (LAI-2200)

Status: implemented on `feature/django-asset-manager` (AM-1 to AM-10), unit-tested, not merged
and not deployed. S3, the bucket policy and CloudFront are not provisioned (section 12), and
nothing, including the admin 3D preview (section 17), has been checked in a browser.
Decision record: ADR-035 in `docs/DECISIONS.md` (Accepted 2026-10-25).

An administrator uploads a 3D model once, validates it, publishes an immutable version, and any
island, region, adventure or quest refers to it by its stable asset id. No source change, no
duplicate upload.

## 1. What already existed, and what this reuses

| Existing piece | Role here |
|---|---|
| `catalog.ContentAsset` (LAI-0304), keyed by `asset_id` | **The asset definition.** One identity for the whole platform (CLAUDE.md section 20: no second catalog). Extended with Django-owned fields; rows can now also be created in Django |
| `catalog.asset_refs.validate_asset_ref` | Unchanged: region rows and catalog rows still reference assets by id |
| Bundled manifest (`react/src/features/island-map/three/assets/manifest.ts`) and `BUNDLED_ASSET_RESOLVER` | Unchanged; the fallback for every id Django does not publish |
| `AssetResolver` contract and the LAI-2106 loader (`assetLoader.ts`, cache, failed-load eviction, events) | Unchanged; the Django adapter is another `AssetResolver` |
| Amplify `Asset` / `AssetVersion` (ADR-030, Admins-only) | Source for the import tool only. Not read by the child app, not deleted |
| Amplify upload checks (`modelFileChecks.ts`: GLB header, 50 MB limit) and key layout (`storageKeys.ts`) | Same rules, now enforced on the server |
| LAI-0404 / ADR-034 Django Admin | The admin surface. Extended with Django permissions and groups (ADR-035) |
| LAI-1002 (RDS, S3) | **Not built.** Storage is an abstraction with S3, local and in-memory backends |

## 2. Concepts

```text
AssetDefinition (= catalog.ContentAsset, stable id "npc-pip")
  ├── AssetVersion 1  (immutable binary, sha256, storage key, metadata)   PUBLISHED
  ├── AssetVersion 2  (immutable binary)                                  PUBLISHED  <- default
  └── AssetVersion 3  (uploaded, validation failed)                       REJECTED
AssetReference = "npc-pip" (follows the default) or "npc-pip@1" (pinned)
```

- **Definition:** id (slug), display name, description, runtime `kind` (`character`, `prop`,
  `collectible`, `kit-piece`, the engine's vocabulary), browsing `category`, free `tags`,
  `status` (`ACTIVE` or `RETIRED`), `origin` (`EXPORT` or `DJANGO`), `default_version`.
- **Version:** number (1, 2, 3 per asset), `version_id` (UUID, immutable, used in URLs and
  cache keys), storage key, original file name, content type, size, SHA-256, format (`glb` or
  self-contained `gltf`), detected metadata (animation clips, bounds, counts), validation report,
  status, timestamps and who uploaded or published it.
- **Publication:** a version's own status says whether gameplay may use it. The definition's
  `default_version` says which published version an unpinned reference gets. Several published
  versions may exist at once; exactly one is the default.
- **Reference:** a stable id, never an S3 URL. A pin (`id@n`) asks for one exact published version.

## 3. Lifecycle

```text
upload (checksum + validate) -> VALIDATED -> publish (re-verify) -> PUBLISHED -> retire -> RETIRED
                                                   \-> REJECTED (stored bytes or definition changed)
A file that fails validation at upload is never stored and makes no row: the admin sees the
findings on the form. DRAFT exists in the schema for a future asynchronous validation step; no
code path creates it today (upload and import both validate synchronously).
```

| Action | Who (permission) | Effect |
|---|---|---|
| Create a definition | `catalog.add_contentasset` | `origin=DJANGO`, `status=ACTIVE`, no versions |
| Upload a version | `assets.add_assetversion` | Server makes the key, checksums, stores, validates in one step. Passing: `VALIDATED`. Failing: `REJECTED` |
| Publish | `assets.publish_assetversion` | `VALIDATED` to `PUBLISHED`. The first published version becomes the default |
| Make default | `assets.publish_assetversion` | Points `default_version` at another **published** version of the same asset |
| Retire a version | `assets.retire_assetversion` | `PUBLISHED` to `RETIRED`. Refused while it is the default unless another published version takes over |
| Retire a definition | `assets.retire_assetversion` | `status=RETIRED`; nothing of it resolves |
| Delete | `assets.delete_assetversion` | Only never-published versions (`DRAFT`, `VALIDATED`, `REJECTED`); the stored file is deleted after the row commits. Published and retired versions are never deleted |

Immutability: once a version has been published its binary fields (number, key, checksum, size,
type, format, metadata) cannot change (model guard plus admin read-only fields). A new model
is always a new version and a new object key.

## 4. Supported formats

- `glb` (glTF 2.0 binary), as today.
- `gltf` (glTF 2.0 JSON) only when self-contained: every buffer and image is an embedded
  `data:` URI, like the generated pack in `public/models/`.
- Not accepted: external `uri` references of any kind, `KHR_draco_mesh_compression` and
  `EXT_meshopt_compression` (the loader has no decoders configured), FBX, Blender files, ZIP or
  RAR. There is no conversion pipeline; export browser-ready glTF from the authoring tool.

The type comes from the file's content (GLB magic or a glTF JSON document), never the extension.

## 5. Validation (`apps/assets/validation.py`)

One service, used by upload, import and publish. Reads at most the configured limits, never
executes anything, never follows a URI. Each finding is `{code, severity, message, path}`;
any `error` means `REJECTED`. Checks: identity (id pattern, definition active), format by
signature, size (`LAI_ASSET_MAX_UPLOAD_BYTES`, default 50 MB; JSON chunk 16 MB), GLB header,
length and chunk layout, glTF `asset.version == "2.0"`, buffer, buffer-view and accessor
bounds, embedded-only resources with allowed image types, supported extensions only, mesh,
node and accessor count limits, a default scene with geometry, animation names (unique, from
the clip vocabulary, and every clip the definition already declares must still be present),
bounding box from `POSITION` min and max through the node transforms, and kind and category
compatibility. SHA-256 is computed from the stored bytes and re-verified before publishing.

## 6. Storage (`apps/assets/storage.py`)

`AssetStorage` with `put(key, stream, content_type, sha256)`, `open`, `delete`, `exists`,
`list(prefix)`. Backends: `S3AssetStorage` (boto3; private bucket; `ChecksumSHA256` sent so S3
verifies the bytes; `IfNoneMatch="*"` so an existing key is never overwritten),
`LocalAssetStorage` (development, under `lai/.asset-storage/`), `MemoryAssetStorage` (tests).
Keys are made by the server only: `assets/models/<asset_id>/<version_id>/model.<glb|gltf>`.
A failed database write after a successful upload deletes the object; `manage.py
asset_storage_audit` lists objects with no version row (`--delete` removes those older than a
day).

## 7. Resolution API (child-facing, read-only)

`GET /api/v1/children/<child_id>/assets/?ids=npc-pip,treasure-chest@2` (Cognito bearer token of
the child's parent; up to 100 ids; `ChildScopedAPIView`, so another family's child is a 404).

```json
{"assets": [
  {"ref": "npc-pip", "id": "npc-pip", "status": "resolved", "kind": "character",
   "category": "npc", "version": 2, "versionId": "7c0e...", "sha256": "ab12...",
   "format": "glb", "contentType": "model/gltf-binary", "sizeBytes": 48211,
   "url": "/api/v1/asset-files/<signed token>/model.glb", "urlExpiresAt": "2026-10-25T18:00:00Z",
   "clips": ["Idle", "Talk"], "dimensions": {"x": 0.6, "y": 1.4, "z": 0.5},
   "cache": {"key": "npc-pip@7c0e...", "immutable": true, "ttl": 3600}},
  {"ref": "treasure-chest@2", "id": "treasure-chest", "status": "unavailable"},
  {"ref": "old-boat", "id": "old-boat", "status": "retired"}
]}
```

`ref` echoes the requested reference (with its pin), so one request can ask for `npc-pip` and
`npc-pip@1` side by side. Duplicate references are answered once. In `s3` mode `url` is an
absolute `https://` presigned URL. Methods other than GET are 405.

- `resolved`: a published version (the default, or the pin). Only published data is returned,
  never drafts, uploader names, storage keys or validation reports.
- `unavailable`: unknown id, nothing published, a draft-only asset, or a pin to a version that is
  not published. Indistinguishable on purpose, so drafts cannot be discovered.
- `retired`: the definition or the pinned version was retired. The client uses the bundled
  file if one exists, otherwise its placeholder.
- Malformed ids are a 400. Two queries per request regardless of how many ids.

## 8. Delivery

The URL is self-authorizing because `GLTFLoader` fetches without an `Authorization` header.
Two modes (`LAI_ASSET_DELIVERY`):

- `django` (default; any storage): `/api/v1/asset-files/<signed token>/model.glb`. The token
  names a version and an expiry and is signed with the Django secret. On every fetch Django
  re-checks that the version is still published and its asset active, so **retiring takes
  effect immediately for new fetches**. Costs Django bandwidth.
- `s3` (production with the bucket): a presigned `GetObject` URL for the private object. Valid
  until it expires (`LAI_ASSET_URL_TTL_SECONDS`, default 3600): **retirement does not revoke a
  URL already issued**, it only stops new ones.

Both modes reuse one URL per version per half-TTL window, so a browser's HTTP cache hits
across scenes. The bytes of a version never change, so responses are cacheable for the URL's
remaining life and the loader's in-memory cache (keyed by asset id) needs no invalidation.
Cross-origin: the API is same-origin by design (no CORS). In `s3` mode the bucket needs a CORS
rule allowing `GET` from the app origin. A Content-Security-Policy, when one is added, needs
`connect-src` for the bucket host in `s3` mode. Signed CloudFront URLs (cheaper delivery, the same
revocation limits) are the next step once the distribution exists.

## 9. Consistency rules

| Event | Behaviour |
|---|---|
| New version published | Nothing changes for unpinned references until it is made the default |
| Default changes | New resolutions get the new version; a running scene keeps what it loaded (the loader caches by id for the session) |
| Version retired | Pins to it and the default (if it was) stop resolving; the default must be moved first |
| Definition retired | Every reference to it is `retired` |
| Older adventure pins `id@1` | Keeps getting version 1 while version 1 is published |
| Scene already loaded the asset | Unaffected: parsed geometry is in memory |
| URL expires while a scene runs | Loaded assets are unaffected. The adapter re-resolves before loading anything whose URL is within 60 s of expiry |

## 10. Frontend adapter

`react/src/api/assets/djangoAssetResolver.ts` implements `AssetResolver`. It batches the ids a
scene asks for in one tick into one request, caches answers per sign-in, and falls back to the
bundled resolver for `unavailable` and `retired`. When the fallback also does not know the
id, it rejects, which is the loader's existing failure path (and TR-7a's placeholder once it
lands). It lives outside the engine folder, so the engine still imports no backend client.
It is not wired into any scene here; TR-10 does that for Treasure Cove.

## 11. Import (`manage.py import_assets`)

- `--from-bundled`: every export-origin `ContentAsset` whose `bundled_path` exists under
  `react/public` becomes a validated version (not published), matched by SHA-256, so a re-run
  creates nothing new.
- `--from-amplify FILE --files DIR`: Amplify `Asset` / `AssetVersion` records (from the
  read-only export of LAI-1101) plus their downloaded files. The slug is the asset id; known
  clip names are kept; records without a file, or whose file fails validation, are listed as
  unresolved.
- `--dry-run` reports without writing. Nothing is deleted, in S3 or in Amplify, and no gameplay
  reference changes.

## 12. Deployment dependencies (not done)

S3 bucket per environment (private, Block Public Access, SSE, versioning off since keys are
immutable, CORS for `s3` delivery), an IAM task-role policy limited to `assets/models/*`
(`s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`, `s3:ListBucket` on the prefix), the
environment variables in section 13, and production approval (Phase 10, LAI-1002). No live AWS
call is made by the tests.

## 13. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LAI_ASSET_STORAGE` | `local` (local), `memory` (test), required in production | `s3`, `local` or `memory` |
| `LAI_ASSET_BUCKET`, `LAI_ASSET_REGION` | none | Required for `s3`; never hard-coded |
| `LAI_ASSET_DELIVERY` | `django` | `django` or `s3` |
| `LAI_ASSET_URL_TTL_SECONDS` | 3600 | Delivery URL lifetime (60 to 43200) |
| `LAI_ASSET_MAX_UPLOAD_BYTES` | 52428800 | Upload limit (also the largest file the admin preview shows) |

The admin preview (section 17) adds no variable. Its token lifetime is the constant
`apps.assets.preview.PREVIEW_TTL_SECONDS` (600 seconds).

## 14. Work breakdown (LAI-2200)

| Id | Task | Status |
|---|---|---|
| AM-1 | Architecture and contract (this document, ADR-035) | Done |
| AM-2 | Models and migrations | Done |
| AM-3 | Model validation service | Done |
| AM-4 | Storage abstraction and upload lifecycle | Done |
| AM-5 | Django Admin management, permissions and groups | Done |
| AM-6 | Published-asset resolver API and delivery | Done |
| AM-7 | Frontend Django resolver adapter | Done |
| AM-8 | Existing asset import tooling | Done |
| AM-9 | Security and integration tests, documentation | Done |
| AM-10 | Admin 3D model preview (section 17) | Done (unit-tested; not checked in a browser) |
| AM-11 | Signed CloudFront delivery | Not started; needs the distribution |

## 15. Treasure Rush TR-10: what it needs from here

TR-10 is not done here (owner rule: no Treasure Rush gameplay change in this workstream). It needs:

1. This branch merged (the resolver route, `djangoAssetResolverFor`, the `assets` migrations).
2. TR-7a's placeholder adapter, so a rejected resolve draws the placeholder instead of nothing.
3. In the Treasure Cove scene, build the loader with
   `createAssetLoader(djangoAssetResolverFor(childId))` instead of the bundled default. The
   region's ids (`npc-pip` today) stay as they are.
4. A published version for each id the cove uses, or nothing at all: unpublished ids fall back
   to the bundled files, which is the current behaviour.
5. Browser verification in a Django-enabled build (`VITE_BACKEND=django`), which has not been done.

## 16. Open decisions

- **ADR-035 was accepted on 2026-10-25** after the implementation was checked against it. What
  follows is deferred work, not open parts of that decision.
- **Delivery mode in production:** `django` (immediate revocation, Django bandwidth) or `s3`
  (cheaper, revocation only at expiry). Signed CloudFront URLs (AM-11) need the distribution.
- **Licence and source fields** (the Amplify `AssetSource` and notes) are not modelled; the import
  keeps only tags. Decide whether licence tracking belongs on the definition or the version.
- **Thumbnails** are not built. The interactive admin preview is (AM-10, section 17).
- **The Amplify `AdventureAsset` join** (which adventure uses which asset) has no Django model.
  Catalog `LocationAsset` and region placements already reference assets by id.

## 17. Admin 3D preview (AM-10)

An administrator can inspect the actual stored model in 3D before publishing it, or at any time
after. Viewing it is read-only: it never publishes, retires, or changes a version, its default
designation, or its definition (a test checks every lifecycle field before and after).

**Where.** Each row on the Asset versions list has a "Preview vN in 3D" link, and so does each
version's change page. On an asset definition's page there is one link for the definition (its
default version, or else its newest previewable version) and one per row in the versions inline.
The preview page is `/admin/assets/assetversion/<pk>/preview/`. It shows the asset name and id,
the version number and `version_id`, the format, file size, validation result, lifecycle status,
asset status, whether it is the default, its animation clips and its bounding box, next to the
viewer.

**What can be previewed.** `VALIDATED` (the point of the feature: check before publishing),
`PUBLISHED` and `RETIRED` versions, in both supported formats (`glb` and self-contained `gltf`).
`DRAFT` (never validated) and `REJECTED` (failed a check) versions are not, and neither is a file
larger than `LAI_ASSET_MAX_UPLOAD_BYTES`. Those pages say why and load no viewer.

**Who.** Active staff with `assets.view_assetversion` or `assets.change_assetversion`, so both
"Asset editors" and "Asset publishers" and every superuser. That is the same rule as the version
admin's view page, and no permission or group was added or changed. Staff without an asset role
get a 403 and see no preview links. Parents and anonymous visitors are sent to the admin login.

**How the file is delivered.** The gameplay route (section 8) serves published versions only and
is left as it is. The preview has its own route, `/admin/assets/assetversion/<pk>/preview/model/`,
which needs **all** of the following:

1. An active staff session with the view permission above. A refusal is JSON (403) and never a
   login redirect, so the viewer can say what happened.
2. A preview token in the `X-Asset-Preview-Token` request header. The page embeds a token signed
   with the Django secret (its own salt, so a gameplay delivery token is never accepted). The token
   names the version, the staff account and an expiry 10 minutes away. It is never put in a URL,
   so it stays out of access logs, referrers and browser history. A cross-site page cannot send
   the header without a CORS preflight, which Django does not answer. A token for another version
   or another account, a forged token, or no token reads as 404. A genuine but expired token is a
   410, and the viewer says to reload the page.
3. A previewable status and a size within the limit (409 and 413 otherwise).
4. Stored bytes whose SHA-256 and length still match the version record. Anything else is a 409
   and the bytes are not sent.

The id in the URL is an integer primary key. The storage key comes from the database row, never
from the request, so there is no path to traverse. The bytes always pass through Django, in every
storage mode: no presigned or permanent S3 URL is issued for a preview, objects stay private, and
the bucket needs no CORS rule for the admin. Responses are `Cache-Control: no-store, private`.
A storage failure is a 503 with a generic message. Logs record `asset version previewed: <id>
v<n>` (staff action, no child data) and never contain the token, a URL or a storage key.

**The viewer.** It is plain TypeScript on the project's existing Three.js and its `GLTFLoader` and
`OrbitControls`, with no React and no new dependency. It lives in
`react/src/features/assets/preview/` (outside the engine folder, since it is admin tooling, not
gameplay):

- `previewModelSource.ts`: fetches the bytes (same-origin credentials, `no-store`, redirects
  treated as refusals), maps each refusal to a fixed message (no stack traces or server detail),
  checks the size, checks that the bytes are the recorded format, and parses them. A
  `LoadingManager` URL modifier refuses any reference that is not embedded in the file (`data:`
  or `blob:`), so the browser never follows an external URI even if one got past validation.
- `modelPreviewViewer.ts`: neutral hemisphere and directional light, a ground grid and axes scaled
  to the model, the model centred horizontally and standing on the grid (it is moved through a
  wrapper group, so the model's own transforms are not touched). Automatic framing from the
  bounding box, with near and far planes and zoom limits scaled to the model, so a 1 mm prop and a
  1 km island both fit. Orbit, pan (right-drag or Shift-drag) and zoom (wheel or pinch). The
  toolbar has Reset camera (back to the first framing), Fit model (frames again from the current
  direction), Zoom in and Zoom out. Sizing follows the container with a `ResizeObserver`. It
  renders only when something changes, with no idle loop. On leaving the page (`pagehide`) it
  disposes geometries, materials, textures, helpers, controls and the renderer and removes the
  canvas. Animation clips are listed but not played; the model shows in its rest pose.
- `mountAssetPreview.ts`: reads the page's `data-` attributes and drives the status line (loading,
  ready, or an `alert` with the error) and the toolbar, whose buttons stay disabled until the
  model is shown.

**Build.** Django's image has no Node step, so the viewer is bundled into one ES module,
`lai/apps/assets/static/assets/admin/asset-preview.js` (about 630 kB, 160 kB gzipped, mostly
Three.js), and the built file is committed. `collectstatic` ships it, with
`asset-preview.css`, under hashed names like every other admin static file. Rebuild it with
`npm run build:admin-preview` (in `react/`; config `react/vite.admin-preview.config.ts`)
whenever `react/src/features/assets/preview/` changes. The bundle has no source map, because the
manifest storage would chase a `sourceMappingURL`.

**Errors shown.** Each of these has its own message: no access or a lapsed session, missing
version, not previewable, too large, checksum mismatch, storage unavailable, network failure,
expired preview, unsupported format, a file that does not parse as glTF 2.0, a model with no
visible geometry, and WebGL unavailable.

**Tests (unit only).** pytest `apps/assets/tests/test_preview.py` (38): editor, publisher and
superuser access; staff without a role, parents and anonymous visitors refused on the page and
the file; unpublished (validated), published and retired previews; draft and rejected refused; the
metadata shown; no lifecycle change; token in a header only; wrong-version, wrong-account, forged,
gameplay and expired tokens; missing versions; oversized files; storage failures; checksum
mismatch; GET only; logs free of tokens and keys; links on the version and definition pages; the
static files present. Vitest `react/src/features/assets/preview/` (3 files, 53): fetch refusal
mapping, header-only token, size limits, abort; format sniffing; GLB and glTF parsing, external
references refused; framing for tiny and huge models; grid sizing; viewer set-up, resize,
on-demand rendering, reset, fit, zoom limits, disposal and WebGL unavailable; page states, toolbar,
and clean-up while loading. Three.js rendering itself is mocked (jsdom has no WebGL).

**Known limitations.**

- Not checked in a real browser or on a GPU. Browser verification belongs to merge verification.
- No animation playback, no thumbnails, no wireframe or material inspection.
- The committed bundle can go stale if the source changes without a rebuild. No check enforces
  freshness yet. A merge-verification step (or a Node stage in the Docker build) would.
- A file is read into memory once per preview (up to the 50 MB limit) to verify its checksum.
  That is fine for staff traffic, but it would not suit gameplay delivery.
- A Content-Security-Policy, when one is added to the admin, must allow `blob:` and `data:`
  images for embedded textures, and `script-src 'self'` covers the bundle.

