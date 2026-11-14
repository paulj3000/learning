# Shared Django Asset Library (LAI-2200)

Status: AM-1 to AM-10 merged into `main` on 2026-10-25 after merge verification (section 18).
AM-13 and AM-17 (Django Admin ownership, images and audio, lifecycle completion; ADR-045) merged
into `main` in `5222b690` on 2026-11-02. **Owner-reported local QA accepted 2026-11-05**: QA-01 to
QA-07 and the Treasure Rush integration pass, in an isolated local environment. That is not
deployed AWS acceptance: **AM-16** (deployed dev S3 and Django signed delivery) and **AM-11**
(signed CloudFront, deferred) stay open. Closure report:
`docs/qa/ASSET_LIBRARY_CLOSURE_2026-11-11.md`.
**Treasure Cove uses it (TR-10, 2026-10-30):** with `VITE_BACKEND=django`, the cove's models
resolve through the asset library, so a version published in Django Admin reaches the game with
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

**Child photos are not here (ADR-042).** Parent-uploaded child photos live in the separate
private bucket `LaiChildPhotos-<env>`, owned by the child profile subsystem, never published and
never served through a CDN (`docs/platform/CHILD_PHOTO_STORAGE.md`). The asset bucket and its
policy were reviewed for that decision and left unchanged.

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
| AM-13 | Non-model asset kinds: textures, images and sprites, audio. Each family gets validation, a key directory under `assets/`, a matching IAM prefix and previews (section 21) | **Done 2026-11-02, in `main` (`5222b690`)**; owner-reported local QA accepted 2026-11-05. Animation clips remain a property of models. Not checked against AWS (AM-16) |
| AM-14 | Administrator REST API (section 20) | **Superseded by ADR-045 (2026-11-02): removed.** Staff administer assets in Django Admin only |
| AM-15 | React staff pages on that API (section 20) | **Superseded by ADR-045 (2026-11-02): removed**, together with the Amplify upload wizard and the admin "Game assets" hub |
| AM-16 | End-to-end publish and delivery verification on the deployed dev environment, now through Django Admin | **Not started, pending**: needs LAI-1002/1004 (dev platform), the asset bucket deployed, and a browser/manual pass against them. Local QA does not satisfy it. Nothing in `main` claims it |
| AM-17 | Django Admin lifecycle completion under ADR-045: rollback, reactivation, stored-file verification, admin-history audit, image and audio previews (section 21) | **Done 2026-11-02, in `main` (`5222b690`)**; owner-reported local QA accepted 2026-11-05 |

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

1. **Asset library, Asset versions, Add** (the upload form). Pick the asset (`npc-pip`,
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
8. **React.** Nothing to set: every build calls Django (AMP-03; leave `VITE_DJANGO_API_BASE`
   unset for a same-origin API). Amplify Hosting is retired.
9. **Children.** A child must exist in Django to play: real families need the child-profile
   migration (LAI-0502/0602, TR-9). **Open blocker.**

Never run the import, or any publish, from the container entry point: both are explicit
administrative actions.

### 19.4 Rolling back

| What | How |
|---|---|
| A bad model version | Make the previous published version the default (19.2, step 4). Versions are immutable, so the old bytes are untouched. Retiring the bad one stops it at once with `django` delivery |
| An asset that should not be in the game at all | Retire the definition (admin action): every reference becomes `retired` and the game uses the bundled file |
| TR-10 itself | Retire the region's asset definitions (above): its models fall back to the bundled loader. The `VITE_BACKEND` switch that used to do this is gone (AMP-03) |
| The storage stack | It retains the bucket on delete, so tearing the stack down never deletes content. A deleted object can be restored from its noncurrent version for 30 days (`aws s3api list-object-versions`, then copy it back) |
| A whole Django release | Roll the service back to the previous image; asset rows and objects are unaffected (the asset migrations are additive) |

### 19.5 Troubleshooting

| You see | Likely cause |
|---|---|
| A loud pink box where a model should be, and `[location ...] could not place ...` in the console | The model failed to load from both Django and the bundle: a typo in the asset id, or a file the loader cannot parse. The warning carries the error |
| `[assets] "<id>" is unavailable in the asset library (expected until it is published)` | Nothing published for that id, or only drafts. The bundled file is used. Publish a version (19.2) |
| `[assets] ... is retired ...` | The definition or the default version was retired. Make another version the default, or leave the bundled file in use |
| `[assets] the asset library request failed (unauthenticated 401)` or `(not_found 404)` | Not a publishing problem. 401: Cognito settings or an expired sign-in. 404: the child does not exist in Django or belongs to another family (TREASURE_RUSH_LOCAL_DEV step 7) |
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

## 20. Administrator API and React pages (AM-14, AM-15): SUPERSEDED, removed

> **Superseded 2026-11-02 by ADR-045.** The administrator API (`/api/v1/admin/assets/`,
> `lai/apps/assets/admin_api.py`) and the React staff pages described below no longer exist.
> The section is kept as a record of what was built and why it was removed. Staff use Django
> Admin (section 21). No route under `api/v1/admin/` is served, and a test fails if one appears.

The React admin manages Django assets through Django, never through a bucket. Files go to
Django; Django checks, stores and records them with the same services Django Admin uses
(`apps/assets/services.py`), so there is one lifecycle and one set of rules.

| Route (`/api/v1/`) | Method | Does |
|---|---|---|
| `admin/assets/` | GET | Every definition (`?kind=` filter): id, names, kind, category, status, default version, version count |
| `admin/assets/` | POST | Create a `DJANGO` definition with no versions. `assetId` must match the storage key rule (lowercase words joined by hyphens). `409 asset_exists` if taken |
| `admin/assets/<id>/` | GET | The definition, its versions (status, file name, size, format, clips, validation report) and `publishedReferences` (objects in published 3D Areas that use it) |
| `admin/assets/<id>/versions/` | POST | Multipart `file`: checksum, validate, store under `assets/models/<id>/<uuid>/model.<format>`, record `VALIDATED`. `400 invalid_model` with `details.findings`, `409 duplicate_version` with `details.version`, `413 asset_too_large`, `503 storage_failed` |
| `admin/assets/<id>/versions/<n>/publish/` | POST | Re-verify the stored bytes, then `PUBLISHED`; the first published version becomes the default |
| `admin/assets/<id>/versions/<n>/default/` | POST | Make a published version the default |
| `admin/assets/<id>/versions/<n>/retire/` | POST | Body `{"replacement": n}` when retiring the default |
| `admin/assets/<id>/versions/<n>/` | DELETE | Only never-published versions; the file is deleted after the row commits |

**Authorization.** Every route needs a verified Cognito access token in the `Admins` group, and a
provisioned account (ADR-024 A4). Every mutation also passes `admin_api.MUTATION_GATE`,
`RequiresRecentAuthentication` (LAI-0209, ADR-043, `docs/platform/RECENT_SIGN_IN.md`), checked
after the `Admins` check: a non-administrator gets `403 permission_denied` however recently they
signed in; an administrator whose Cognito sign-in is older than 300 seconds gets `403
recent_auth_required`, and the React pages ask them to sign in again and confirm, keeping the
form and chosen file, then retry once. Reads need no recent sign-in. Django Admin's own staff
permissions (section 3) are unchanged; Django Admin has no recent sign-in step of its own yet.

**What never happens.** Definitions are never deleted through the API (retire in Django Admin).
Published and retired versions are never deleted. Responses carry no storage key, bucket name,
uploader identity or credential. The original file name is kept for the admin's reference only.

**Retries.** Creating a definition that exists answers `409 asset_exists`; uploading a file the
asset already holds answers `409 duplicate_version` with that version's number, which the React
pages treat as uploaded; deleting a version that is already gone answers `404`, which the client
treats as done. A failed upload leaves no row and no object.

**React** (`react/src/routes/modelAssetPages.tsx`). A build with the Django API
(`VITE_BACKEND=django`) uses `features/assets/django/`: the model list, "Add a model" (define,
then upload; a retry only uploads) and a per-asset page with the version actions and new-version
uploads. Uploads use `XMLHttpRequest` for progress (`api/assets/djangoAssetAdmin.ts`), with one
forced token refresh after a 401, and send the token only to the configured API origin. A test
walks those pages' runtime imports and fails on any Amplify or AWS SDK import. A build without the
Django API keeps the Amplify pages (`AdminModelAssets`, `AdminNewModelAsset`) unchanged until
LAI-1301.

**Not done here.** Non-model kinds (textures, images, audio) remain AM-13: they need a key family
and IAM prefix per kind, validation per format, and a runtime consumer in the engine, which is a
decision of its own. The Amplify catalog admin's model picker (`features/admin/catalogApi.ts`) still
reads Amplify `Asset` records; it goes with LAI-1301. AM-16 verifies publish and delivery on the
deployed dev environment.

## 21. Django Admin asset library (AM-13, AM-17; ADR-045)

**Django Admin owns staff authoring.** React owns gameplay and parent screens, and consumes
published assets through the read-only resolver (section 7). There is no React staff asset page.

### 21.1 What staff do, and where

| Task | Where in Django Admin | Permission |
|---|---|---|
| Create a definition: id, kind, category, name, description, tags | Catalog > Content assets > Add | `catalog.add_contentasset` |
| Edit names, descriptions, categories, tags (kind and clips only on Django-made definitions) | Content assets > change | `catalog.change_contentasset` |
| Find assets | Search (id, name, description, tags); filters: status, origin, category, kind | view |
| Upload a file (a new version) | Asset versions > Add (upload form) | `assets.add_assetversion` |
| See versions, storage metadata, validation findings, thumbnail or audio player | Content asset page (versions table) and each version page | view |
| Publish; make default | Asset versions > actions | `assets.publish_assetversion` |
| Roll back to an earlier version (republishes a retired one after re-verifying it) | Action "Roll back" (select one) | `assets.publish_assetversion` |
| Retire a version or an asset | Actions "Retire" | `assets.retire_assetversion` |
| Reactivate a retired asset | Content assets > action "Reactivate" | `assets.retire_assetversion` |
| Verify stored files (present, checksum, still valid) | Action "Verify the stored files" | view |
| Delete a never-published version and its file | Version page > Delete | `assets.delete_assetversion` |

Groups come from `manage.py ensure_asset_roles` (viewers, editors, publishers). Every upload,
publish, default change, rollback, retirement and deletion is written to Django Admin's history
(`LogEntry`: who, when, what) and, without child data, to the `lai.assets` log.

### 21.2 Kinds, families and formats

A definition's `kind` decides the family of file it accepts. The family is read from the bytes.

| Kind | Family | Accepted formats | Limit (setting) |
|---|---|---|---|
| `character`, `prop`, `collectible`, `kit-piece` | 3D model | `.glb`; `.gltf` only if self-contained (every buffer and texture embedded as a `data:` URI) | 50 MB (`LAI_ASSET_MAX_UPLOAD_BYTES`) |
| `texture`, `image`, `sprite` | Image | PNG, JPEG, WebP | 10 MB (`LAI_ASSET_MAX_IMAGE_BYTES`), 4096 px a side, 16 M pixels |
| `audio` | Audio | MP3 (Layer III), WAV (PCM or float, 8 to 32 bit), Ogg (Vorbis or Opus) | 20 MB (`LAI_ASSET_MAX_AUDIO_BYTES`), mono or stereo, 8 to 96 kHz, 15 minutes |

External glTF dependencies are **not** supported: a `.gltf` with a relative or remote `uri` is
rejected with a finding, never published half-working. Package it as `.glb` or embed it.

### 21.3 Validation rules (all server-side, `validation.py`, `validation_media.py`)

- The format comes from the leading bytes. File name and browser content type are ignored. SVG,
  GIF, BMP, TIFF, AAC, FLAC, scripts and archives are refused as unknown.
- The family must suit the definition's kind (`wrong_file_family`).
- Structures are walked with bounds and must end where the file ends. Extra bytes after a PNG
  `IEND`, a JPEG end marker, a WebP/WAV RIFF size, the last MP3 frame or the Ogg end page are
  refused (`trailing_data`), so a polyglot file cannot be stored. PNG chunk CRCs are verified.
- Dimensions, channels, sample rate and duration are limited; non-power-of-two textures get a
  warning, not a refusal.
- A file that fails is never stored and makes no row. SHA-256 is recorded, sent to S3 as the
  object checksum, and re-checked on publish, rollback, preview and verify.
- Object keys are made only by `object_key` from the asset id and a version UUID:
  `assets/<models|images|audio>/<asset id>/<version uuid>/<model|image|audio>.<format>`. Names the
  user supplied are kept only as display text. Every storage call refuses a key outside those
  directories, with `..`, `//`, a backslash, a leading slash or a NUL.

### 21.4 Versions, publishing and retirement

- Uploading to an asset always makes a **new version** (1, 2, 3). Identical bytes already held by
  the asset answer `duplicate_version`.
- Published and retired versions are immutable (checksum, key, metadata); the model layer raises
  `ImmutableVersion` on any change and on deletion.
- A new version is `VALIDATED` and invisible to games. Only **Publish** makes it servable; the
  definition's `default_version` decides what an unpinned reference gets. React never chooses a
  version: it receives what Django resolved.
- Transitions: `DRAFT > VALIDATED | REJECTED`, `VALIDATED > PUBLISHED | REJECTED`,
  `PUBLISHED > RETIRED`, and `RETIRED > PUBLISHED` only through rollback, after the stored bytes
  are re-verified. Everything else is refused.
- **Rollback** makes an earlier published version the default; if that version was retired it is
  republished first. A version whose bytes are missing or changed cannot be rolled back to.
- Retiring the default version needs a replacement; retiring an asset stops all resolution
  (versions and files are kept). Reactivating an asset republishes nothing.
- A definition is never deleted (versions are `PROTECT`ed, and locations reference it by
  `PROTECT`). A published version is never deleted. A never-published version can be deleted and
  its file is removed after the row commits.
- Each transition runs in a transaction with the asset row locked, so two staff cannot allocate
  the same number or race a publish.

### 21.5 Previews (Django Admin only, no third-party scripts)

- **Images:** a thumbnail with dimensions, type and size on the version page, and a larger view
  on the preview page.
- **Audio:** native `<audio controls>` with duration, sample rate, channels and size.
- **3D models:** the existing sandboxed viewer (section 17) and model metadata.
- Image and audio bytes are served by `.../assetversion/<id>/media/` to staff sessions with view
  permission only, after the checksum is verified. The response has the content type from our own
  table, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`
  and `Content-Disposition: inline`. Bytes are never inserted into a page. The game file route
  (`/api/v1/asset-files/<token>/<name>`) sends the same hardening headers.

### 21.6 Storage and S3

`get_storage()` returns `s3`, `local` or `memory` from `LAI_ASSET_STORAGE`. Unit tests use
`memory` and botocore `Stubber`; nothing contacts AWS. Production settings: `LAI_ASSET_STORAGE=s3`,
`LAI_ASSET_BUCKET`, `LAI_ASSET_REGION`; credentials come from the runtime role, never from code.

Required IAM (policy `lai-django-asset-storage-<env>`, defined in `infra/lib/assetStorageStack.ts`,
synthesized, **not deployed**):

- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on exactly `arn:aws:s3:::<bucket>/assets/models/*`,
  `/assets/images/*` and `/assets/audio/*` (no `assets/*`, no bucket root);
- `s3:ListBucket` on the bucket (also needed so a missing key answers 404, not 403);
- no `s3:*`, no version or ACL rights, no IAM user or access key.

S3 and the database cannot commit together. The rules: write the object first (never overwriting,
`IfNoneMatch: *`), then the row; a row failure deletes the object; a delete removes the row first
and the object after commit; a publish re-reads the object before changing state. Leftovers are
found by `manage.py asset_storage_audit` (orphans, and rows whose object is missing) and removed
with `--delete` (objects older than a day only). Signed URLs (`s3` delivery) or signed tokens
(`django` delivery) expire; a client that gets 403/404 on a file re-resolves the id for a fresh
URL. Asset ids, not URLs, are the stable identifiers.

### 21.7 Published-asset API contract (read-only, child-scoped)

`GET /api/v1/children/<child_id>/assets/?ids=a,b@2` returns, per reference, `status`
(`resolved`, `retired` or `unavailable`) and for `resolved`: `id`, `kind`, `category`, `version`,
`versionId`, `sha256`, `family` (`model|image|audio`), `format`, `contentType`, `sizeBytes`,
`url`, `urlExpiresAt`, `clips`, `dimensions` (models), `cache {key, immutable, ttl}` and, for
images and audio only, `media`: `{width, height}` or `{durationSeconds, sampleRate, channels}`.
Never returned: drafts, validation reports, storage keys, buckets, uploaders, notes. Unpublished,
retired, unknown and draft-only assets are `unavailable` or `retired` with no URL.

### 21.8 Three.js and Treasure Rush

The Django adapter (`react/src/api/assets/djangoAssetResolver.ts`) parses the contract above;
`three/assets/mediaAssets.ts` loads textures (cached by `cache.key`, disposed when a newer
version replaces them) and resolves sound URLs. Treasure Rush refers to `treasure-chest`,
`npc-pip` and the other cove models by logical id through this resolver (TR-10; tests in
`regionAssets.test.ts` and the cove view tests); no S3 URL is in game code, and the bundled
manifest remains the fallback when an id is not published.

### 21.9 Associations

Existing references already cover the hierarchy: `catalog.LocationAsset` links Places (and so
their 3D Areas) to assets, rows in NPCs, items and regions store asset ids validated by
`validate_asset_ref`, and an asset may be referenced by any number of them. Assets belong to
no adventure. Texture, image and audio ids are referenced the same way (by id); wiring a
specific adventure, quest or effect field to a texture or sound id is done by the feature that
needs it, with the kind check in `validate_asset_ref`. No scene editor is part of this work.

### 21.10 Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Upload says `wrong_file_family` | The asset's kind takes another family. Create a definition of the right kind |
| Upload says `trailing_data` or `png_crc` | The file is damaged or has data appended. Re-export it |
| `.gltf` rejected for an external `uri` | Pack it as `.glb` or embed buffers and textures |
| Publish says verification failed or rejected | The stored object changed or is missing. Run "Verify the stored files", `asset_storage_audit`, re-upload |
| Game shows the bundled fallback | The id is unpublished, retired or has no default. Check the version page |
| Browser gets 404 on an asset URL | The token expired or the version was retired. The client re-resolves |
| Preview shows 409 / 503 | Checksum mismatch / object unreadable. Verify, then check bucket permissions |
| Admin cannot see an action | Missing group permission. Run `ensure_asset_roles` |

### 21.11 LAI-0209 and administrator re-authentication

LAI-0209 (recent sign-in) protected the **Cognito-token** asset mutations of the removed API. Those
no longer exist, so that scope of LAI-0209 is retired. The guard is unchanged and still protects
child deletion (`DELETE /api/v1/children/<id>/`) and any future sensitive parent action. Django
Admin staff authenticate through Django's own session login with group-based permissions (ADR-040),
and Django Admin has no recent sign-in step of its own yet. That remains a possible later
hardening and is not claimed here.

### 21.12 Remaining acceptance (not done in this branch)

Deploying the asset bucket and policy; hosting Django (LAI-1004); live S3 upload, publish and
delivery; a browser pass of the admin upload, preview and game load; manual acceptance. These are
AM-16 and stay open.

## 22. Sound cues over audio assets (Sound Manager Phase 2, ADR-050)

Audio files stay here: upload, validation, versions, publishing, retirement and signed delivery are
unchanged. The `audio` app adds a configuration layer over published audio assets: `SoundCue`
(a stable sound name plus mix settings, referencing a `ContentAsset` of kind `audio`),
`SoundAssignment` and immutable `SoundRelease` snapshots that pin an exact `AssetVersion` per cue.
Retiring an asset or version removes its sound from the live manifest and blocks the next publish
until fixed. See `docs/audio/PHASE_2_ASSET_INTEGRATION.md`.
