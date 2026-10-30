# Shared Django Asset Manager (LAI-2200)

Status: AM-1 to AM-10 merged into `main` on 2026-10-25 after merge verification (section 18).
**Treasure Cove uses it (TR-10, 2026-10-30):** with `VITE_BACKEND=django`, the cove's models
resolve through the asset manager, so a version published in Django Admin reaches the game with
no React rebuild (section 15). **AWS storage is defined but not deployed:** `infra/` synthesizes
the private bucket and the Django role policy (section 12); deploying it, and hosting Django at
all (LAI-1004), are approval steps nobody has taken. Signed CloudFront delivery (AM-11) is not
needed for launch (section 8). The admin preview was checked in headless Chromium with software
WebGL. The child app's Django path, TR-10 included, has not been checked in a browser.
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
Cross-origin: the API is same-origin by design (no CORS on Django, TR-D14; the React host must
route `/api/*` to Django, `docs/platform/AMPLIFY_HOSTING.md` section 7). In `s3` mode the bucket
needs a CORS rule allowing `GET` from the app origin (`allowedOrigins` in `infra/`, section 12).
A Content-Security-Policy, when one is added, needs `connect-src` for the bucket host in `s3`
mode.

**Production choice (2026-10-30): `django` delivery from the private S3 bucket.** Storage is S3
(`LAI_ASSET_STORAGE=s3`), delivery stays `django`:

- The browser only ever talks to the app's own origin. The bucket needs no CORS rule and is never
  reachable from a browser; the CSP needs no bucket entry.
- Retiring a version stops it at once, which matters for child-facing content.
- The cost is Django bandwidth: the cove's three bundled models are about 17 KB together, cached by the
  browser for the URL's life (`private, max-age=<remaining>, immutable`) and by the loader for
  the visit.

Switch to `LAI_ASSET_DELIVERY=s3` (presigned URLs straight from the bucket) only if model
traffic becomes material; deploy the stack with `allowedOrigins` first. **CloudFront is not
added:** nothing in the repository serves assets through a distribution yet, and presigned S3
URLs already give private, short-lived, cacheable delivery. Signed CloudFront URLs (AM-11) stay a
later optimisation for when LAI-1005's distribution exists.

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
scene asks for in one tick into one request, caches answers until their URL is near expiry, and
falls back to the bundled resolver for `unavailable` and `retired`. When the fallback also does
not know the id, it rejects, which is the loader's existing failure path: the runtime draws the
TR-7a placeholder. It lives outside the engine folder, so the engine still imports no backend
client.

Why an id fell back is reported (`onIssue`, default `reportAssetResolutionIssue`, a console
warning): `not-published` for an `unavailable`, `retired` or unusable answer (expected while
assets migrate), and `request-failed` with the `ApiError` kind and status when the request
itself failed (signed out, another family's child, Django down). A failed request still plays
on bundled files, but it is never reported as "not published", and it is not cached, so the
next load asks again. Treasure Cove uses it (TR-10, section 15).

## 11. Import (`manage.py import_assets`)

- `--from-bundled`: every export-origin `ContentAsset` whose `bundled_path` exists under
  `react/public` becomes a validated version (not published), matched by SHA-256, so a re-run
  creates nothing new. `--ids a,b,c` limits it to those ids (Treasure Cove:
  `--ids npc-pip,treasure-chest,ground-tile`); an id that is not an exported bundled asset is
  listed as `unknown_asset`. The Django image carries `react/public/models`, so this runs as a
  one-off container task against production storage (section 19).
- `--from-amplify FILE --files DIR`: Amplify `Asset` / `AssetVersion` records (from the
  read-only export of LAI-1101) plus their downloaded files. The slug is the asset id; known
  clip names are kept; records without a file, or whose file fails validation, are listed as
  unresolved.
- `--dry-run` reports without writing. Nothing is deleted, in S3 or in Amplify, and no gameplay
  reference changes.

## 12. AWS storage (`infra/`, synthesized, not deployed)

`infra/lib/assetStorageStack.ts` (CDK, the first stack of LAI-1001's `infra/` app) defines
`LaiAssetStorage-<env>` for `dev` and `prod`. How to synthesize and deploy it: `infra/README.md`.

| Piece | Definition |
|---|---|
| Bucket | `lai-assets-<env>-<account>-<region>`. Block Public Access (all four), bucket-owner-enforced (no ACLs), SSE-S3, a bucket policy denying non-TLS requests, retained when the stack is deleted, termination protection on `prod` |
| Versioning | On. Keys are immutable, so no live object ever has two versions; a deleted object (a never-published version, or `asset_storage_audit --delete`) stays recoverable for 30 days, then expires. Incomplete multipart uploads are aborted after a day |
| IAM | Managed policy `lai-django-asset-storage-<env>`: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/assets/models/*`; `s3:ListBucket` on the bucket. Attached to the Django workload role (`djangoRoleArn`) or attached by hand. No IAM user, no access key, no `s3:*`, no version deletes |
| Why ListBucket has no prefix condition | `list_objects_v2` sends a prefix, but `head_object` on a missing key does not, and without ListBucket S3 answers it 403 instead of 404, which `asset_storage_audit` would report as a failure. The bucket holds nothing else |
| CORS | None by default (`django` delivery). With `allowedOrigins`, one rule: `GET` and `HEAD`, those explicit `https://` origins only, `Range` request header, `Content-Length`, `Content-Type`, `ETag` exposed, one hour preflight cache. Wildcards and plain `http://` (other than localhost) are refused at synth |
| Credentials | From the workload role through the default AWS SDK chain (`boto3.client("s3")`). Nothing in settings, `.env` files or the React build. Local development keeps `local` storage and needs no AWS credentials |

Deploying it is a Phase 10 approval step (`docs/DJANGO_MIGRATION_ROADMAP.md`). No test makes a
live AWS call: `infra/lib/assetStorageStack.test.ts` asserts on the synthesized template, and
`apps/assets/tests/test_storage.py` stubs boto3.

## 13. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `LAI_ASSET_STORAGE` | `local` (local), `memory` (test), required in production | `s3`, `local` or `memory` |
| `LAI_ASSET_BUCKET`, `LAI_ASSET_REGION` | none | Required for `s3`; never hard-coded |
| `LAI_ASSET_DELIVERY` | `django` | `django` or `s3` |
| `LAI_ASSET_URL_TTL_SECONDS` | 3600 | Delivery URL lifetime (60 to 43200) |
| `LAI_ASSET_MAX_UPLOAD_BYTES` | 52428800 | Upload limit (also the largest file the admin preview shows) |

Production (`config.settings.production`) refuses to start unless `LAI_ASSET_STORAGE=s3` and both
`LAI_ASSET_BUCKET` and `LAI_ASSET_REGION` are set, so a container can never fall back to its own
disk. The key prefix (`assets/models/`) is fixed in code and in the IAM policy, not a setting. The
React build needs nothing new: `VITE_BACKEND=django` (and `VITE_DJANGO_API_BASE` only for a
non-same-origin API) are the whole client configuration; no bucket name, key or credential ever
reaches Vite.

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
| AM-11 | Signed CloudFront delivery | Not needed for launch (section 8); later optimisation once LAI-1005's distribution exists |
| AM-12 | Production S3 storage: bucket, IAM, CORS, image, runbook (sections 12 and 19) | Done as code and documentation; deploying it is an approval step |

## 15. Treasure Rush TR-10 (done 2026-10-30)

```text
Treasure Cove entity (asset id "npc-pip")
  -> regionAssetsFor(child, region)             react/src/features/region-play/regionAssets.ts
  -> createAssetLoader(djangoAssetResolverFor(child))
  -> GET /api/v1/children/<child>/assets/?ids=npc-pip,treasure-chest,ground-tile
  -> published default version -> signed URL     (bundled file if nothing is published)
  -> GLTFLoader -> clone (SkeletonUtils for rigged models) -> scene
```

- **Which regions.** Regions served by the play API (today only Treasure Cove) in a build with
  `VITE_BACKEND=django`. Source-controlled regions, and every build without it, keep the bundled
  loader, so nothing changes for them.
- **When a new version shows.** Each visit builds its own resolver and loader, so a version made
  the default is what the child gets the next time they enter the cove. A visit in progress
  keeps what it loaded (section 9). No React rebuild is involved.
- **Fallbacks.** Published version, else the bundled file for that id, else the TR-7a
  placeholder. A failed request (auth, scope, network) also plays on bundled files but is
  reported as a failure, not as "not published" (section 10). Amplify Storage is never used.
- **Animations.** The loader hands the scene the parsed glTF unchanged: clips keep their names,
  and the clone is skeleton-safe. The chest finds `Open` by name, Pip loops `Idle` and plays
  `Talk`/`Wave`. Upload validation refuses a new version that drops a clip the definition
  declares (section 5), so a replacement cannot silently break them.
- **Placeholders (TR-7a).** A model that fails draws a primitive box of the admin's placeholder
  size (`placeholder_width/height/depth`), named `missing-model:<asset id>`; the chest keeps its
  built chest; a ground tile that fails becomes a plain floor. Each failure is a console warning
  naming the entity and the error.

Inventory of the cove's runtime models (all three are export-origin `ContentAsset` rows after
`load_content`; none is published until an administrator does it):

| Asset id | Used for | Bundled fallback | Kind | Clips the game uses | Cove placement |
|---|---|---|---|---|---|
| `npc-pip` | Pirate Pip (NPC, `cove-pip`) | `/models/npc-pip.gltf` | `character` | `Idle` (loops), `Talk`, `Wave` | `WorldObjectPlacement.asset_id` |
| `treasure-chest` | The chest (`cove-chest`), drawn open from server state | `/models/treasure-chest.gltf` | `prop` | `Open` (held on its last frame) | `TreasureChest.asset_id` (default), `open_clip` |
| `ground-tile` | The cove floor (tiled, instanced) | `/models/ground-tile.gltf` | `kit-piece` | none | Region default ground (`scene.groundAssetId` overrides) |

Browser verification in a Django-enabled build has not been done (owner: after deployment).

## 16. Open decisions

- **ADR-035 was accepted on 2026-10-25** after the implementation was checked against it. What
  follows is deferred work, not open parts of that decision.
- **Delivery mode in production:** decided 2026-10-30, `django` from the S3 bucket (section 8).
  Revisit with `s3` delivery or signed CloudFront URLs (AM-11) if model traffic grows.
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
   and the bytes are not sent. The checksum is computed in 1 MB chunks. The same handle is then
   rewound and streamed, so memory stays at one chunk whatever the file size, and the bytes sent
   are the bytes that were verified. Every backend's `open` is seekable: memory, a local file, or
   for S3 a local temporary file the object is spooled to.

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
manifest storage would chase a `sourceMappingURL`. Prettier and oxlint skip the generated file.

**Freshness check.** `npm run admin-preview:check` (`scripts/check-admin-preview-bundle.ts`)
rebuilds the bundle with the same config into a temporary directory and fails unless it is
byte-for-byte the committed file. The build is deterministic for a given lockfile. The check
uses no network and no new dependency. It runs in CI (the `checks` job) and in `make js-check`.

**Errors shown.** Each of these has its own message: no access or a lapsed session, missing
version, not previewable, too large, checksum mismatch, storage unavailable, network failure,
expired preview, unsupported format, a file that does not parse as glTF 2.0, a model with no
visible geometry, and WebGL unavailable.

**Tests (unit).** pytest `apps/assets/tests/test_preview.py` (40): editor, publisher and
superuser access; staff without a role, parents and anonymous visitors refused on the page and
the file; unpublished (validated), published and retired previews; draft and rejected refused; the
metadata shown; no lifecycle change; token in a header only; wrong-version, wrong-account, forged,
gameplay and expired tokens; missing versions; oversized files; storage failures; checksum
mismatch; GET only; logs free of tokens and keys; links on the version and definition pages; the
static files present; reads in bounded chunks with a streamed response; a read error during the
checksum. Vitest `react/src/features/assets/preview/` (3 files, 53): fetch refusal
mapping, header-only token, size limits, abort; format sniffing; GLB and glTF parsing, external
references refused; framing for tiny and huge models; grid sizing; viewer set-up, resize,
on-demand rendering, reset, fit, zoom limits, disposal and WebGL unavailable; page states, toolbar,
and clean-up while loading. Three.js rendering itself is mocked (jsdom has no WebGL).

**Known limitations.**

- Checked in headless Chromium with software WebGL (SwiftShader) only, not on a hardware GPU or
  in Firefox or Safari.
- No animation playback, no thumbnails, no wireframe or material inspection.
- In `s3` storage mode `open` first copies the object to a local temporary file (memory up to
  8 MB, then disk). A preview therefore costs one S3 download and up to 50 MB of temporary disk
  per concurrent request. That is acceptable for staff traffic.
- A Content-Security-Policy, when one is added to the admin, must allow `blob:` and `data:`
  images for embedded textures, and `script-src 'self'` covers the bundle.

## 19. Operations: publishing Treasure Rush models, deploying, rolling back

### 19.1 Locally

`docs/TREASURE_RUSH_LOCAL_DEV.md` step 9: import the cove's three models, publish them in the
admin, and play. Local storage is `lai/.asset-storage/` and delivery is `django`; no AWS
account is involved.

### 19.2 Replacing a Treasure Rush model in Django Admin

Roles: an **Asset editor** uploads, an **Asset publisher** publishes and makes a version the
default (`manage.py ensure_asset_roles` creates both groups; a superuser assigns people to them
under Users). The admin path is `DJANGO_ADMIN_URL_PATH` (default `/admin/`).

1. **Asset manager, Asset versions, Add** (the upload form). Pick the asset (`npc-pip`,
   `treasure-chest` or `ground-tile`; a new asset is created first under **Catalog, Content
   assets** with a stable id), choose a `.glb` or self-contained `.gltf`, upload. Validation
   runs at once: a failing file is refused with its findings and nothing is stored; a passing
   one becomes the next version, `VALIDATED`.
2. Optional: the version's **Preview** link shows the stored model in 3D (AM-10).
3. Select the version, action **Publish selected versions**. The first published version of an
   asset becomes its default; a later one is published but not yet used.
4. To switch the game to it: select it alone, action **Make the selected version the default**.
5. The next time a child enters Treasure Cove, the resolver returns the new version's URL and
   the scene loads it. No React build, no deploy.

Animated models must keep the clip names the definition declares (`npc-pip`: `Idle`, `Talk`,
`Wave`; `treasure-chest`: `Open`); validation refuses a version that drops one.

### 19.3 A new AWS environment, in order

Prerequisites outside this document: Django hosting with a workload role, RDS and secrets
(LAI-1002 to LAI-1004, `docs/DJANGO_TARGET_ARCHITECTURE.md` section 11a), and `/api/*` routed to
Django on the app's own origin (`docs/platform/AMPLIFY_HOSTING.md` section 7). Every AWS step is
an approval step.

1. **Storage.** Synthesize and deploy `LaiAssetStorage-<env>` with the Django role
   (`infra/README.md`):
   ```bash
   LAI_ENV=prod LAI_DJANGO_ROLE_ARN=arn:aws:iam::<account>:role/<django-role> \
     CDK_DEFAULT_ACCOUNT=<account> CDK_DEFAULT_REGION=<region> npm run infra:synth
   aws cloudformation deploy --stack-name LaiAssetStorage-prod \
     --template-file infra/cdk.out/LaiAssetStorage-prod.template.json \
     --capabilities CAPABILITY_NAMED_IAM --region <region>
   ```
2. **Django environment.** Besides the variables `config.settings.production` already requires
   (`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `DATABASE_URL`, `DJANGO_CSRF_TRUSTED_ORIGINS`,
   `COGNITO_*`): `LAI_ASSET_STORAGE=s3`, `LAI_ASSET_BUCKET=<AssetBucketName output>`,
   `LAI_ASSET_REGION=<region>`. Leave `LAI_ASSET_DELIVERY` unset (`django`). No AWS key: the
   role supplies credentials.
3. **Image.** `docker build -f lai/Dockerfile -t lai-django .` (it now carries
   `react/public/models` for step 6), push it, release admin static files
   (`scripts/release-admin-static.sh`), roll the service.
4. **One-off tasks** in that image, with the same environment:
   ```bash
   python manage.py migrate
   python manage.py create_admin_account <username> --superuser --no-input   # DJANGO_ADMIN_PASSWORD
   python manage.py ensure_asset_roles
   python manage.py load_content
   ```
5. **Region content.** `python manage.py seed_treasure_rush` creates the cove as `DRAFT`.
   Publishing it in a deployed environment needs TR-3's region admin, which does not exist yet:
   `publish_treasure_rush` is local-only by design (DEBUG and loopback). **Open blocker.**
6. **Models.** `python manage.py import_assets --from-bundled --ids npc-pip,treasure-chest,ground-tile`
   (add `--dry-run` first to see what it would do). Idempotent; publishes nothing.
7. **Publish** the three versions in Django Admin (19.2, step 3). Until then the game uses its
   bundled copies, so this step can come later.
8. **React.** Build with `VITE_BACKEND=django` (and `VITE_DJANGO_API_BASE` unset for a
   same-origin API). Today every hosted Amplify branch keeps `VITE_BACKEND` unset
   (`docs/platform/AMPLIFY_HOSTING.md` section 5); changing that is an owner decision.
9. **Children.** A child must exist in Django to play: real families need the child-profile
   migration (LAI-0502/0602, TR-9). **Open blocker.**

Never run the import, or any publish, from the container entry point: both are explicit
administrative actions.

### 19.4 Rolling back

| What | How |
|---|---|
| A bad model version | Make the previous published version the default (19.2, step 4). Versions are immutable, so the old bytes are untouched. Retiring the bad one stops it at once with `django` delivery |
| An asset that should not be in the game at all | Retire the definition (admin action): every reference becomes `retired` and the game uses the bundled file |
| TR-10 itself | Build React without `VITE_BACKEND=django`: every region uses the bundled loader again. Nothing else changes |
| The storage stack | It retains the bucket on delete, so tearing the stack down never deletes content. A deleted object can be restored from its noncurrent version for 30 days (`aws s3api list-object-versions`, then copy it back) |
| A whole Django release | Roll the service back to the previous image; asset rows and objects are unaffected (the asset migrations are additive) |

### 19.5 Troubleshooting

| You see | Likely cause |
|---|---|
| A loud pink box where a model should be, and `[location ...] could not place ...` in the console | The model failed to load from both Django and the bundle: a typo in the asset id, or a file the loader cannot parse. The warning carries the error |
| `[assets] "<id>" is unavailable in the asset manager (expected until it is published)` | Nothing published for that id, or only drafts. The bundled file is used. Publish a version (19.2) |
| `[assets] ... is retired ...` | The definition or the default version was retired. Make another version the default, or leave the bundled file in use |
| `[assets] the asset manager request failed (unauthenticated 401)` or `(not_found 404)` | Not a publishing problem. 401: Cognito settings or an expired sign-in. 404: the child does not exist in Django or belongs to another family (TREASURE_RUSH_LOCAL_DEV step 7) |
| `(network)` or `(unavailable 503)` | Django is down or `/api/*` does not reach it. Models fall back to the bundle; check the routing |
| A published version does not appear | It is published but not the default (19.2, step 4), or the child is still in the same visit: leave the cove and come back |
| The upload form refuses the file | The findings say why: external `uri`s, Draco/meshopt, an unknown clip name, a dropped clip, or over the size limit (sections 4 and 5) |
| `asset file unavailable` in the Django log, 503 to the browser | The object is missing or unreadable in the bucket: check the role policy is attached, and run `manage.py asset_storage_audit` |
| Django refuses to start: `LAI_ASSET_STORAGE must be s3 in production` or `LAI_ASSET_BUCKET must be set` | Step 2's variables are missing |

## 18. Merge verification (2026-10-25)

Run on `feature/django-asset-manager` before merging into `main`. `origin/main` had not moved
since the branch was cut (`f279299`), so the merge had no conflicts.

| Check | Result |
|---|---|
| pytest, full suite, PostgreSQL required (`make py-test-db`) | 873 passed, 0 skipped |
| Vitest, full suite (`npm test`) | 289 files, 3030 tests passed |
| TypeScript (`npm run typecheck`) | Pass |
| Ruff lint and format | Branch issues fixed. Two failures remain and are already on `main`, unrelated: `S105` in `users/management/commands/create_admin_account.py` and the format of `users/migrations/0002_admin_accounts.py` |
| oxlint | Exit 0 (warnings only, all already on `main`) |
| Prettier | Branch issues fixed. One pre-existing `main` file remains: `react/src/api/djangoAdmin.test.ts` |
| `manage.py check`, `makemigrations --check` | Clean, no changes |
| ADR check | Pass (35 decisions) |
| Production React build (`npm run build`) | Pass. The child app's bundle contains no admin preview code |
| `docker build -f lai/Dockerfile .` | Pass. Build-time `collectstatic` hashes `asset-preview.js` and `.css` |
| Admin preview bundle freshness | Pass. It also fails, as it should, after a one-character source change |
| Playwright e2e (`npm run test:e2e`) | 7 passed |
| Browser check of the admin preview (headless Chromium, WebGL2 through SwiftShader, local Django on a throwaway PostgreSQL) | 24 of 24 checks |

The browser check is a script outside the repository. It needs a running Django, which CI's e2e
job does not start. It covered: admin login; the preview link on the version list; the preview
page with its metadata; a real validated, unpublished GLB (`kenney-tree-large.glb`) rendering
with model pixels; orbit (left-drag), pan (right-drag), wheel zoom and the zoom buttons; reset
returning to an identical frame; fit bringing a model panned out of view back to the initial
framing; resizing with the window; the version still `VALIDATED` afterwards; a version with
corrupted stored bytes showing the checksum error as an alert with the controls disabled; staff
without an asset role getting 403 on the page and the file; anonymous visitors sent to login, and
a 403 JSON response with no bytes for the file; a missing token header giving 404; and no page
errors.

