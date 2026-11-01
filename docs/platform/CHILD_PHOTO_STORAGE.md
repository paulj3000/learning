# Child Photo Storage and the Two-Bucket Architecture

Status (2026-10-31, branch `feature/lai-0905-photo-clients`, which also carries the LAI-0904
commits; not merged, not pushed):

| Task | Implementation | Tests | Deployment | Acceptance |
|---|---|---|---|---|
| LAI-0904 CDK `LaiChildPhotos-<env>` and EC2 wiring | Done | 43 infra unit tests pass; `infra:synth` passes for dev and prod | **Not deployed.** Live AWS state not checked (AWS CLI not permitted in the session that verified it) | Open: needs the approved dev deployment and section 8 step 6 |
| LAI-0904 Django photo API (`lai/apps/users`) | Done | pytest with the in-memory store, full Django stack | Not released to any environment with S3 | Open: never run against a real bucket |
| LAI-0905 React client | Done | Vitest component and client tests | Ships with the next React build that uses the Django API | Open: browser check needs a test Cognito pool (gate A6) and the dev bucket |
| LAI-0905 Android contract | Documented (`docs/android/ANDROID_API_CONTRACT.md`) | n/a | n/a | Open: no Android client exists in this repository |
| LAI-0602 photo cleanup on child deletion (`lai/apps/users/deletion.py`) | Service done | pytest | n/a | Open: the API route stays blocked until LAI-0209 |
| LAI-1103 Amplify photo migration | Designed (section 10) | none | none | Not started: its inputs (LAI-1101 export, bucket read access) do not exist |
| LAI-1204 legacy Amplify storage retirement | Planned (section 11) | none | none | Nothing deleted, nothing changed |

Decision: ADR-042 (`docs/DECISIONS.md`). Tasks: LAI-0904, LAI-0905, LAI-1002, LAI-1103,
LAI-1204, AM-13 (`docs/DJANGO_MIGRATION_ROADMAP.md`, `tasks/TASK_TRACKER.md`).

## 1. Decision

Game assets and child photos live in **separate S3 buckets**, owned by different Django
subsystems, with different policies for access, publication, caching and retention.

- `LaiAssetStorage-<env>` keeps the asset manager's published content (ADR-035). Unchanged by
  this work.
- `LaiChildPhotos-<env>` is new. It holds parent-uploaded child profile photos, which are a child's
  personal data. The child profile subsystem (`lai/apps/users`) owns it. The asset manager never
  reads or writes it.
- The existing Amplify bucket (`learningAdventureIslandMedia`, `amplify/storage/resource.ts`)
  stays exactly as it is until migration and cutover are verified (section 9).

## 2. Architecture

```text
Existing Amplify S3 bucket (legacy, unchanged, still serving the Amplify app)
        |
        +-- assets/*  (admin-uploaded GLBs) --> manage.py import_assets --from-amplify
        |                                              |
        |                                              v
        |                                   LaiAssetStorage-<env>
        |                                   lai-assets-<env>-<account>-<region>
        |                                              |
        |                                              v
        |                                   Django asset manager (apps/assets)
        |                                   published versions, resolver API, Three.js loader
        |
        +-- child-photos/<identity id>/*  -->  LAI-1103 photo migration (designed, not built)
                                                       |
                                                       v
                                            LaiChildPhotos-<env>
                                            lai-child-photos-<env>-<account>-<region>
                                                       |
                                                       v
                                            Django child profiles (apps/users, ChildPhoto)
                                            parent-authorized API, presigned GET only
```

| | Asset bucket | Child photo bucket | Legacy Amplify bucket |
|---|---|---|---|
| Stack | `LaiAssetStorage-<env>` (`infra/lib/assetStorageStack.ts`) | `LaiChildPhotos-<env>` (`infra/lib/childPhotoStorageStack.ts`) | Amplify Gen 2 (`amplify/storage/resource.ts`) |
| Owner in Django | `apps/assets` (asset manager) | `apps/users` (child profiles) | none |
| Content | Published game content: GLB/glTF today; textures, images, audio and animations when AM-13 adds them | One current photo per child profile | Child photos and admin-uploaded models |
| Key layout | `assets/models/<asset id>/<version uuid>/model.<glb\|gltf>` | `children/<child uuid>/<photo uuid>` | `child-photos/<identity pool id>/<uuid>.jpg`, `assets/models/...` |
| Who decides access | Publication state (draft, published, retired) | The owning parent, checked on every request | Cognito identity pool rules |
| Delivery | Django-signed URLs (default) or presigned GET; cacheable, immutable | Presigned GET, 300 s by default, or the authenticated API route; never cached by shared caches | Amplify `getUrl` |
| Publication workflow | Yes | **Never** | No |
| CDN | None today; signed CloudFront later (AM-11) | **Never** | None |
| Noncurrent versions kept | 30 days | **7 days** | Amplify default (not changed) |
| IAM policy | `lai-django-asset-storage-<env>` on `assets/models/*` | `lai-django-child-photos-<env>` on `children/*` | Amplify-generated |

Neither Django policy can touch the other bucket's prefix, and production settings refuse a photo
bucket name equal to the asset bucket name.

## 3. Bucket security (`LaiChildPhotos-<env>`)

| Control | Setting |
|---|---|
| Name | `lai-child-photos-<env>-<account>-<region>` (account and region are CloudFormation pseudo-parameters; nothing is hard-coded) |
| Public access | All four Block Public Access settings on. The bucket policy only denies; it grants no principal anything |
| Ownership | Bucket owner enforced: ACLs are disabled |
| Transport | Deny any request without TLS, and any request below TLS 1.2 |
| Encryption | SSE-S3 (AES-256) by default for every object |
| Versioning | On, with the lifecycle rules in section 5 so versioning never keeps a deleted photo indefinitely |
| CORS | None by default. Uploads go through Django, and an `<img>` loading a presigned URL is not a CORS request. `photoAllowedOrigins` (`LAI_PHOTO_ALLOWED_ORIGINS`) adds one `GET`/`HEAD` rule for explicit `https://` origins only if a client must `fetch()` the URL; wildcards and plain `http://` (other than localhost) fail the synth |
| Removal | Retained when the stack is deleted; termination protection on `prod` |
| CDN | None, by design |
| Tags | `Component=child-photos`, `DataClassification=child-personal-data` |

**Why SSE-S3 and not a KMS key.** SSE-KMS with a customer-managed key would add a key policy,
`kms:Decrypt` for the Django role on every read and presign, and a per-request KMS cost. Its
benefits are per-key audit and the option to make every object unreadable by destroying the key.
Neither is required today. The default encryption can be changed later in place, without
replacing the bucket. This is listed as an open decision for the privacy review (gate G9).

## 4. Django: upload contract and API

All routes are child-scoped (`ChildScopedAPIView`). The parent comes only from the verified token,
and the child is resolved through that parent, so another family's child and an unknown id give
the same `404 not_found`. A photo's storage key is never sent to a client.

| Route | Result |
|---|---|
| `GET /api/v1/children/<id>/photo/` | `{"photo": null}` or `{"photo": {id, contentType, byteSize, width, height, uploadedAt, delivery, url, urlExpiresAt}}` |
| `PUT /api/v1/children/<id>/photo/` | Upload or replace. Body: the raw JPEG with `Content-Type: image/jpeg`. No multipart, no file name. Returns the same body as `GET` |
| `DELETE /api/v1/children/<id>/photo/` | `204`, whether or not there was a photo |
| `GET /api/v1/children/<id>/photo/content/` | The bytes, with the bearer token (`Cache-Control: private, no-store`, `nosniff`) |

`delivery` is `presigned` with S3. In that case `url` works without credentials until
`urlExpiresAt`, which suits an `<img>` element. With the local or in-memory stores, `delivery` is
`api`: `url` is the content route, which needs the bearer token. Native clients can always use the
content route.

`GET` and `PUT` answer with `Cache-Control: private, no-store` (since 2026-11-01): the body carries
a URL Django authorized for that request, so no browser or proxy keeps it. Each `GET` authorizes
the parent again before minting a URL. A client never stores the URL: React asks again when the
image fails to load (an expired signature) and never sends its bearer token to S3
(`ChildAvatar.tsx`, `djangoPhotos.ts`). Byte-serving through Django instead of presigned URLs is
kept for stores that cannot presign; switching S3 to it needs a demonstrated reason (ADR-042
amendment, item 4).

**What the server accepts.** One JPEG, as the clients already produce. React draws a 256 px
square through a canvas (`react/src/features/child-profile/avatarPhoto.ts`); Android must do the
same. The server re-checks everything (`lai/apps/users/photo_validation.py`):

1. Size: `LAI_CHILD_PHOTO_MAX_BYTES` (default 1 MB). Otherwise `413 photo_too_large`. The
   `Content-Length` is checked before the body is read, and the read is capped.
2. Declared type `image/jpeg`. Otherwise `415 photo_type_unsupported`.
3. Content: a complete baseline or progressive 8-bit JPEG stream with 1 or 3 components and
   nothing after the end-of-image marker. Otherwise `400 photo_invalid` or
   `415 photo_type_unsupported`. A PNG labelled as JPEG is caught here.
4. Dimensions: at most `LAI_CHILD_PHOTO_MAX_DIMENSION` (default 1024) on each side. Otherwise
   `400 photo_dimensions`.
5. Metadata stripped before storage: EXIF (camera, GPS), XMP, ICC, IPTC, maker notes, comments
   and JFIF thumbnails. Pixels are unchanged: the stripped files were checked against a reference
   decoder and decode to identical pixels.

The check is structural, in pure Python, so no native image decoder runs on untrusted input in
the API process and no dependency was added. If a pixel-level re-encode is wanted later (for
example a server-side resize for clients that cannot do it), that is a separate decision: it
would add an image library dependency.

**Clients (LAI-0905).** The React Django build (`VITE_BACKEND=django`) sets `supportsPhotos: true`
and `photoWrite: 'after-save'` (`react/src/features/child-profile/djangoProfiles.ts`,
`djangoPhotos.ts`):

- The form saves the profile first, then `PUT`s the prepared 256 px JPEG (or `DELETE`s) for the
  saved child. If only the photo step fails, the message says the profile was saved, and the
  next submit updates that child instead of creating a second one.
- `ChildProfile.avatarPhotoKey` is the child id when the API reports `hasPhoto`, else null.
  `ChildAvatar` resolves it through the store: a `presigned` URL (`https:` only) goes straight
  into the `<img>`; an `api` URL must be this child's content route, which is then fetched
  through the API client with the bearer token, so the token never goes to a host named in a
  response. The bytes become one object URL per child, reused for the same photo id and revoked
  on replace or remove.
- Server errors map to the Amplify build's messages (`photoMessages.ts`).
- Amplify builds keep `avatarPhoto.ts` and the `before-save` order unchanged until LAI-1301.

Android's contract is in `docs/android/ANDROID_API_CONTRACT.md`, "Child profile photo".

**Storage failures never corrupt the database** (`lai/apps/users/photos.py`):

- Upload writes a new object under a fresh UUID key, with a SHA-256 checksum and `If-None-Match`,
  so it never overwrites. Only then does one transaction mark the old row `DELETING` and insert
  the new `CURRENT` row.
  - S3 fails: `503 photo_storage_unavailable`, and nothing changed.
  - The database fails: the new object is deleted again.
- The old photo's object is deleted after commit. If that fails, its `DELETING` row stays, is
  never served, and is retried by `manage.py child_photo_storage_audit --delete`.
- Disabled storage (`LAI_CHILD_PHOTO_STORAGE=disabled`) answers uploads and reads with `503`, but a
  parent can still remove a photo. The row is retired at once and the object is purged once
  storage is back.

**Metadata.** `users.ChildPhoto` (a `ChildOwnedModel`, ADR-033) stores the id (the photo UUID in
the key), storage key, status (`CURRENT` or `DELETING`), content type, size, SHA-256, width,
height and timestamps. The database allows at most one `CURRENT` row per child.
`ChildProfile.avatar_photo_key` is deprecated: no code writes or reads it. It is not dropped,
because removing a column is a destructive migration that needs the release flag
`--allow-destructive-migrations`; its removal is tracked with LAI-1103.

**Logging.** Photo code logs outcomes and counts only, never a key, child id, nickname or byte.
The audit command prints counts only. Access logs still carry child ids in URL paths, as for
every child route (gate G10).

## 5. Retention and deletion policy

| Event | What happens | When the bytes are gone |
|---|---|---|
| Parent replaces a photo | The old row becomes `DELETING`; Django deletes the object after commit | Current version at once. The noncurrent version expires **7 days** later. S3 runs lifecycle asynchronously, usually within about a day of eligibility, so about 8 days in the worst normal case |
| Parent removes a photo | Same | Same |
| Object delete fails | The `DELETING` row is kept and the photo is never served; `child_photo_storage_audit --delete` retries | After the retry, plus the 7-day window |
| Upload whose database write failed and whose rollback delete failed | An orphan object with no row | `child_photo_storage_audit --delete` removes orphans older than 60 minutes (younger ones may be uploads still committing), plus the 7-day window |
| Child deleted (LAI-0602) | `deletion.delete_child_profile` calls `photos.delete_all_child_photos(child)` (current and superseded `DELETING` rows) and deletes the child, cascading every child-owned row, only if every object is gone. Otherwise it raises `ChildDeletionIncomplete`, keeps the child, and leaves the rows `DELETING` (never served); a retry or the audit finishes. A photo committed during the deletion also stops the cascade. If the objects are gone but the database delete then fails, the child stays with no photo (a consistent state) and a retry finishes. Not reachable from the API until LAI-0209 | As above |
| Abandoned multipart upload | Aborted after 1 day (Django uses single-part `PutObject`; this is a guard) | 1 day |
| Delete markers | Removed by the lifecycle once no version remains behind them | n/a |
| Database rows | `DELETING` rows are deleted once their object is gone | Metadata only, no image bytes; RDS automated backups keep earlier rows for their retention period |

**Recovery trade-off.** For 7 days a replaced or removed photo can be recovered by an operator
with version-read rights. The Django role has none (`s3:GetObjectVersion` is not granted), so this
is a deliberate, audited AWS console or CLI action. Once S3 runs the expiry (7 days, plus the
asynchronous lifecycle lag, so about 8 days at most in normal operation) it cannot be recovered.
A version an operator restores for a deleted child has no row, so the audit treats it as an
orphan and removes it. There is
no backup, replication or Object Lock for this bucket. Each would extend retention of a child's
photograph, and a profile photo is not worth restoring from backup.

**Faster erasure.** If an erasure request must take effect sooner than 7 days, an operator deletes
the object versions by hand (`s3:DeleteObjectVersion`). Django is not granted that right. The
LAI-0602 deletion service (`apps/users/deletion.py`) deliberately uses plain `DeleteObject` and
relies on the lifecycle, so a deleted child's photo bytes also persist as noncurrent versions for
up to about 8 days. Whether that service should get a prefix-scoped version delete stays open for
the privacy review (G9); it is not decided by LAI-0602.

**Scheduling.** Nothing runs the audit on a schedule yet, because the EC2 platform has no
scheduler. Until LAI-1006 or LAI-1007 adds one, run it after any storage incident and before
cutover:

```bash
python manage.py child_photo_storage_audit            # report only
python manage.py child_photo_storage_audit --delete   # repair
```

## 6. IAM

`lai-django-child-photos-<env>` (customer-managed policy, 0 roles created):

| Statement | Actions | Resource |
|---|---|---|
| `ChildPhotoObjects` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` | `arn:aws:s3:::<photo bucket>/children/*` |
| `ListChildPhotoPrefix` | `s3:ListBucket` with `s3:prefix` `StringLike children/*` | the bucket |

There is no `s3:*`, no version read or delete, no ACL right and no bucket-configuration right.
The EC2 instance role `lai-django-ec2-<env>` attaches the policy by name, as it does the asset
policy. `djangoRoleArn` (`LAI_DJANGO_ROLE_ARN`) attaches both storage policies to another
workload role (for example ECS, LAI-1007). Presigned URLs are signed with the instance role's
temporary credentials, so they also stop working when those credentials expire. No IAM user or
access key exists anywhere.

## 7. Configuration

| Django setting | Source in AWS (`/lai/<env>/django/...`, written by `LaiDjangoEc2-<env>`) | Default | Notes |
|---|---|---|---|
| `LAI_CHILD_PHOTO_STORAGE` | `LAI_CHILD_PHOTO_STORAGE` = `s3` | `local` (development), `disabled` (production when unset), `memory` (tests) | Production allows only `s3` or `disabled` |
| `LAI_CHILD_PHOTOS_BUCKET` | `LAI_CHILD_PHOTOS_BUCKET` = `lai-child-photos-<env>-<account>-<region>` | empty | Required with `s3`; must differ from `LAI_ASSET_BUCKET` |
| `LAI_CHILD_PHOTOS_REGION` | `LAI_CHILD_PHOTOS_REGION` = the stack region | empty | Required with `s3` |
| `LAI_CHILD_PHOTO_MAX_BYTES` | (not set; an operator may add it) | 1048576 | 1 KB to 5 MB |
| `LAI_CHILD_PHOTO_MAX_DIMENSION` | (not set) | 1024 | 64 to 4096 |
| `LAI_CHILD_PHOTO_URL_TTL_SECONDS` | (not set) | 300 | 30 to 900 |
| `LAI_CHILD_PHOTO_LOCAL_ROOT` | n/a | `lai/.child-photo-storage/` (gitignored) | Development only |

The asset settings (`LAI_ASSET_STORAGE`, `LAI_ASSET_BUCKET`, `LAI_ASSET_REGION`) are unchanged.
`scripts/aws/render-env.sh` already turns every `/lai/<env>/django/LAI_*` parameter into the
container environment, so no script change was needed. The photo settings are deliberately not
in its required list: production falls back to `disabled` when they are absent, so a release that
reaches an environment before its stacks are updated still starts.

## 8. Deployment (each step needs explicit owner approval)

Nothing here has been run. The order matters: the EC2 stack attaches both storage policies by
name, so both storage stacks must exist first.

1. Synthesize and review: `LAI_ENV=dev npm run infra:synth`, then read
   `infra/cdk.out/LaiChildPhotos-dev.template.json`. The LaiDjangoEc2 diff against `main` is
   additive: one managed policy ARN on the instance role, three new SSM parameters, and the
   role's description text.
2. Create the change sets: `scripts/aws/provision.sh dev`. It now creates
   `LaiAssetStorage-dev`, then `LaiChildPhotos-dev`, then `LaiDjangoRelease`, then
   `LaiDjangoEc2-dev`, and applies nothing.
3. Review the change sets. `LaiChildPhotos-dev` must show only creations (the bucket, the bucket
   policy, the managed policy). `LaiDjangoEc2-dev` must show `Modify` on the instance role
   (no `Replacement`) and three `Add` for SSM parameters.
4. With approval: `scripts/aws/provision.sh dev --execute`.
5. Release the Django image that contains migration `users.0005_child_photos` (the release runs
   `migrate`; the migration only adds a table).
6. Verify on dev: upload, read (presigned URL), replace, delete as a test parent; the same calls
   as a second parent get `404`; in a React build with `VITE_BACKEND=django` pointed at dev, the
   LAI-0905 flows (new child with photo, replace, remove, a photo failure after save then retry); `child_photo_storage_audit` reports zero orphans and zero missing
   objects; `aws s3api get-public-access-block` and `get-bucket-policy` show the settings above.
7. Repeat for `prod` only after the dev verification and a separate approval.

## 9. The legacy Amplify bucket

It stays operational and untouched until LAI-1204: not renamed, emptied or deleted, and its
CORS, policies, objects and Amplify deployments are not changed. This branch changes nothing
under `amplify/`.

**Every remaining reference, and what eventually replaces it:**

| Reference | Use | Replaced by |
|---|---|---|
| `amplify/storage/resource.ts`, `amplify/backend.ts` (`storage`) | Defines the bucket and its access rules | LAI-1302 / LAI-1303, after LAI-1204 |
| `amplify/data/resource.ts` (`ChildProfile.avatarPhotoKey`) | Path of the child's photo in the bucket | `users.ChildPhoto`; the value is input to LAI-1103 |
| `react/src/features/child-profile/avatarPhoto.ts` (`uploadData`, `getUrl`, `remove`) | Upload, show and delete photos in Amplify builds only. Django builds use `djangoPhotos.ts` (LAI-0905) | LAI-1301 |
| `react/src/features/child-profile/deletion.ts` | Deletes the photo when a child is deleted (Amplify) | LAI-0602 calling `photos.delete_all_child_photos` |
| `react/src/features/child-profile/amplifyProfiles.ts` (`photoWrite: 'before-save'`, `getChildPhotoUrl`) | The Amplify store's photo path; `ChildAvatar` and the form reach it through `ProfileStore` (LAI-0905) | LAI-1301 |
| `react/src/features/assets/assetService.ts`, `modelUpload.ts`, `config.ts` | Amplify admin model upload and signed reads under `assets/*` (ADR-030) | Django asset manager (ADR-035); data via `import_assets --from-amplify` |
| `lai/apps/users/amplify_import.py` | Counts profiles whose photo stays in Amplify | LAI-1103 |
| Android | Uses the Django API only (ADR-036); no Amplify Storage reference was found in the repository | n/a |

**Hazard for Phase 13.** Amplify Gen 2 adds an auto-delete-objects custom resource to its
storage bucket (`docs/IAM_ROLE_AUDIT.md` section 3). Deleting the Amplify stack therefore empties
the bucket. LAI-1302 must not run before LAI-1204 has confirmed migration, integrity and
retention, and the roadmap now makes LAI-1302 depend on LAI-1204.

## 10. LAI-1103: photo migration design (not built, not run)

Moves existing Amplify photos into `LaiChildPhotos-<env>` and `users.ChildPhoto`. It never
modifies or deletes an Amplify object.

**Inputs and prerequisites**

- The LAI-1101 read-only export (`{"parentProfiles": [...], "childProfiles": [...]}`): each child
  item's `id`, `ownerSub` (or its parent's `owner`) and `avatarPhotoKey`. Not built yet.
- The profile import applied to the target database (`import_amplify_profiles`, LAI-CHILD-001):
  Django children keep their Amplify ids, and parents resolve only by Cognito `sub`. This is the
  identity-mapping contract, and it exists.
- A read-only inventory of the Amplify bucket's `child-photos/` prefix: key, size, ETag, last
  modified. Needs approved read access (G1, G7).
- `LaiChildPhotos-<env>` deployed (section 8), and gate G9 (ParentConsent) before real family
  photos move.

**Mapping and ownership validation (planner, read-only)**

1. For each exported child with `avatarPhotoKey`, find the Django child with the same id.
   - No Django child: `child_not_imported`.
   - Owner `sub` differs from the Django parent's `cognito_sub`: `owner_mismatch`, never copied.
2. The key must match `child-photos/<identity id>/<uuid>.jpg` and be in the inventory.
   - Otherwise `missing_object` or `invalid_key`.
3. All of one parent's photos must share one identity id. A key under another parent's identity
   id is `identity_conflict`, never copied. (The identity id is only a consistency check: the
   child item's `avatarPhotoKey` is the authoritative link.)
4. Inventory objects referenced by no child item: `unreferenced_object`. They are not migrated;
   LAI-1204 reviews them.
5. A Django child that already has a `CURRENT` photo uploaded after the import:
   `django_photo_newer`. Django wins and nothing is copied.

**Copy (with approval)**

- Read the legacy object and check its integrity. Compute SHA-256; for a single-part object
  compare the MD5 with the ETag. Mismatch: `integrity_failed`.
- Run the same validation and metadata stripping as an upload (section 4). Failure:
  `validation_failed`, reported and not dropped silently.
- Deterministic photo id `uuid5(NAMESPACE, legacy key)`, so a re-run targets the same
  `children/<child>/<photo>` key. `If-None-Match` makes an existing object a no-op, which is then
  verified by SHA-256. Rows are created only where no `CURRENT` photo exists.
- Transient S3 errors are retried with bounded exponential backoff. The run is resumable and
  idempotent: safe to stop and repeat.
- **Dry run** (default) reads only and writes a report. `--execute` copies.
- **Report**: counts per outcome, total bytes, and run timing. It has no keys, names or subs,
  and the per-child detail is in a local encrypted file, as for LAI-1101.

**Verification before cutover**

- The migrated count equals the planned `ok` count, and every migrated object's SHA-256 matches
  its row.
- A sample of children: the owning parent gets the photo through the API, and another parent gets
  `404`.
- `child_photo_storage_audit` shows zero orphans and zero missing objects.
- Every non-`ok` outcome is reviewed and signed off by a person.

**Rollback.** The migration only adds. Its photo ids are derived from legacy keys, so the
`ChildPhoto` rows it created and their objects can be listed and removed exactly. The Amplify
bucket was never touched, so the Amplify app keeps serving photos throughout. The Phase 12
rollback (flip `VITE_BACKEND` back) needs nothing extra for photos.

**Tracked work:** LAI-1103a (inventory), LAI-1103b (planner and dry run), LAI-1103c (copy, with
approval), LAI-1103d (verification); `docs/DJANGO_MIGRATION_ROADMAP.md` Phase 11.

## 11. LAI-1204: retiring the legacy Amplify storage

Defined in `docs/DJANGO_MIGRATION_ROADMAP.md` Phase 12. It confirms that the asset import and the
photo migration are verified, production cutover is accepted, React (and Android, where it
applies) run on Django-backed storage, and no runtime reference to the bucket remains. It then
reviews every remaining consumer, retention and backup need, and the `unreferenced_object` list,
and writes a deletion plan with rollback considerations. Deletion happens only after explicit
final approval, and never as a side effect of deleting the Amplify stack (section 9, hazard).

## 12. Verification record

| Check | Result (2026-10-31) |
|---|---|
| `infra/lib/childPhotoStorageStack.test.ts` (11 tests), `assetStorageStack.test.ts`, `djangoDeployment.test.ts` | 43 passed |
| `npm run infra:synth` for `dev` and `prod` | Pass; `LaiChildPhotos-dev` and `-prod` templates produced |
| Synth diff against `main` | `LaiAssetStorage-prod` and `LaiDjangoRelease` identical; `LaiDjangoEc2-prod` additive only |
| `lai/apps/users/tests/test_child_photos.py` | 48 passed |
| pytest `lai/apps/users`, `lai/apps/core`, `lai/apps/assets` (PostgreSQL required), and `tests/` | 625 and 166 passed |
| Ruff check and format, `manage.py check`, `makemigrations --check` | Pass |
| Not run | Full pytest and Vitest, typecheck of every project, oxlint, Prettier, build, Playwright, any AWS call |
