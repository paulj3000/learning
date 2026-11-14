# Amplify Storage to Django-managed S3: cutover runbook (AMP-04)

Date: 2026-11-10. Trello: AMP-04 ("Finish Amplify Storage to Django-managed S3 cutover"). Input:
`docs/platform/AMPLIFY_EXIT_MATRIX.md` (AMP-01: the `assetService.ts` and `avatarPhoto.ts` rows,
gap G9, section 5). Builds the photo migration designed in `CHILD_PHOTO_STORAGE.md` section 10
(LAI-1103) and reuses the asset importer (`docs/ASSET_LIBRARY.md` section 11, AM-8).

**The owner runs every AWS step.** Nothing in this card ran against AWS, changed IAM, or touched
a bucket. **No bucket, object or Amplify resource is deleted** by anything here: the Amplify bucket
`learningAdventureIslandMedia` stays exactly as it is until its own retirement card (LAI-1204,
AMP-08) is approved.

## 1. Status

| Part | State |
|---|---|
| React: asset resolution (`features/assets/assetService.ts`) | Django only. The Amplify Data (`Asset`, `AssetVersion`) and Storage (`getUrl`) path is removed |
| React: child photos (`features/child-profile/avatarPhoto.ts`) | Django only (`djangoPhotos.ts`, `children/<id>/photo/`). `avatarPhoto.ts` keeps the browser checks and the EXIF-dropping re-encode, and calls no backend |
| React: Amplify builds (`VITE_BACKEND` unset) | No photo field, no photo shown (the authored avatar character instead). The legacy `avatarPhotoKey` is kept on the row so the migration can map it |
| React: remaining Amplify Storage call | One, delete only: `child-profile/deletion.ts` removes a child's legacy photo when an Amplify build deletes that child, so no child photo is orphaned. It goes with `deletion.ts` (AMP-03, LAI-1301) |
| React: admin catalog | Its two Amplify `Asset` reads moved into `features/admin/catalogApi.ts` (retired with the React admin pages, AMP-03) |
| Django: `manage.py migrate_amplify_child_photos` | Built and tested (stubbed S3). Not run against AWS |
| Django: `manage.py migrate_amplify_asset_objects` | Built and tested (stubbed S3). Not run against AWS |
| Live inventory, copy, reconciliation and acceptance | **Open: owner, sections 4 to 7** |

## 2. What is preserved

- **Separate buckets.** Child photos go only to the private `LaiChildPhotos-<env>` bucket; game
  assets only to `LaiAssetStorage-<env>` (ADR-042). The two never share a bucket, prefix or CDN.
- **Parent-only photo access.** Every Django photo route resolves the child through the
  authenticated parent (`services.get_owned_child_profile`); another family's child is a `404`.
  The migration does not change any route. It maps a legacy object to a child only when the
  export's owner `sub` equals the Django child's parent `cognito_sub`.
- **EXIF stripping and validation.** Each photo is re-run through the upload pipeline
  (`photos.replace_photo`: size, type and JPEG structure checks, `clean_jpeg` metadata removal,
  checksummed conditional write). A photo the pipeline rejects is reported, never copied raw.
- **No public CDN of child photos.** Photos are served only as short-lived presigned GETs or
  through the authenticated `photo/content/` route. Nothing here adds a public path.
- **Asset versions and publication.** Legacy asset files become `VALIDATED` versions through the
  normal importer. Publishing stays an administrator's decision in Django Admin; published
  versions are never deleted, not even by a rollback.
- **The source.** The migration code reads the Amplify bucket through `apps/core/legacy_bucket.py`,
  which has no put, copy or delete operation. Noncurrent versions and delete markers are counted,
  never copied: they are photos and models the app already replaced or removed.

## 3. Prerequisites and gates

1. **Gate G9 (ParentConsent, LAI-0308, `docs/DECISIONS.md` ADR-019)** is resolved before real
   family photos move. Until then, run only the inventory and dry runs.
2. `LaiChildPhotos-<env>` and `LaiAssetStorage-<env>` are deployed, and the Django settings for the
   target environment use them (`LAI_CHILD_PHOTO_STORAGE=s3`, `LAI_ASSET_STORAGE=s3`).
3. The read-only DynamoDB export exists (LAI-1101): the profile export
   (`{"parentProfiles": [...], "childProfiles": [...]}`, `AMPLIFY_PROFILE_IMPORT.md`) and the asset
   export (`{"assets": [...]}` with `versions[].s3Key`, `ASSET_LIBRARY.md` section 11).
4. `import_amplify_profiles --apply` has run against the target database, so every Django child
   carries its Amplify id. A photo whose child is not there is reported `child_not_imported`.
5. Credentials (boto3 default chain) that can **read** the Amplify bucket (`s3:ListBucket`,
   `s3:ListBucketVersions`, `s3:GetObject`, `s3:GetObjectVersion` on `child-photos/*` and
   `assets/*`) and that the Django runtime already has for its own buckets. Grant the Amplify read
   access temporarily and read-only; this card changes no IAM. Region: `us-west-1`.
6. The manifests hold child ids and Cognito identity ids. Write them to an encrypted,
   access-controlled location (they are created `0600`), never to the repository or a Trello card,
   and delete them after the cutover record is closed.

## 4. Inventory (read only)

Cross-check S3's own count first, then the commands' (`B` = the Amplify bucket name):

```bash
aws s3 ls s3://B/child-photos/ --recursive --summarize | tail -2
aws s3 ls s3://B/assets/ --recursive --summarize | tail -2
cd lai
../.venv/bin/python manage.py migrate_amplify_child_photos --bucket B --region us-west-1 \
    --inventory --manifest /secure/amp04-photos-inventory.json
../.venv/bin/python manage.py migrate_amplify_asset_objects --bucket B --region us-west-1 \
    --inventory --manifest /secure/amp04-assets-inventory.json
```

Each prints counts only: `sourceObjects`, `sourceBytes`, outcomes, and the noncurrent-version and
delete-marker counts. `sourceObjects` and `sourceBytes` must equal the `aws s3 ls` totals. The
manifest has one row per object: key, size, ETag, version id, SHA-256 and whether the ETag is the
MD5 of the bytes read (`etagMatchesMd5`; `null` for multipart uploads). The asset inventory also
says which Django version already holds each object's bytes (`in_django`).

## 5. Child photos

```bash
# Dry run (the default with --export): maps, validates, writes nothing but the manifest.
../.venv/bin/python manage.py migrate_amplify_child_photos --bucket B --region us-west-1 \
    --export /secure/export.json --manifest /secure/amp04-photos-plan.json
# Review every outcome other than would_copy (section 9). Then, with approval:
../.venv/bin/python manage.py migrate_amplify_child_photos --bucket B --region us-west-1 \
    --export /secure/export.json --manifest /secure/amp04-photos-copy.json --confirm-copy
# Re-run as the reconciliation: expect only already_copied (and the reviewed exceptions).
../.venv/bin/python manage.py migrate_amplify_child_photos --bucket B --region us-west-1 \
    --export /secure/export.json --manifest /secure/amp04-photos-reconcile.json
../.venv/bin/python manage.py child_photo_storage_audit
```

How a legacy object is mapped (`apps/users/amplify_photo_migration.py`):

1. The child is the exported child whose `avatarPhotoKey` names the object. Its Amplify id is its
   Django id. No such child: `unreferenced_object`, left in place for LAI-1204's review.
2. The owner is the child's `ownerSub`, else its parent profile's `owner` (`<sub>::<username>`).
   It must equal the Django parent's `cognito_sub` (`owner_mismatch` otherwise).
3. The identity id in the key is a consistency check only: one identity id per owner and one
   owner per identity id, otherwise `identity_conflict` for every object involved.
4. The bytes read must match the listed size and, for a single-part object, the listed ETag
   (`integrity_failed` otherwise).
5. The photo goes through the upload pipeline and is stored under a new
   `children/<child id>/<photo id>` key with a `ChildPhoto` row, then read back from the Django
   bucket and compared by SHA-256 with the row (`copied`; a failed comparison is
   `verify_failed` and the new photo is removed again).
6. A child that already has a Django photo keeps it: the same SHA-256 is `already_copied` (and is
   re-verified against the stored object), a different one is `django_photo_newer`. A copy never
   replaces a photo.

The Django SHA-256 is of the cleaned bytes. Amplify icons were re-encoded through a canvas, so they
normally carry no metadata and `byteIdentical` is `true`; `false` means metadata was stripped.

## 6. Asset-library objects

```bash
../.venv/bin/python manage.py migrate_amplify_asset_objects --bucket B --region us-west-1 \
    --export /secure/assets.json --manifest /secure/amp04-assets-plan.json
../.venv/bin/python manage.py migrate_amplify_asset_objects --bucket B --region us-west-1 \
    --export /secure/assets.json --manifest /secure/amp04-assets-copy.json --confirm-copy
../.venv/bin/python manage.py asset_storage_audit
```

The command streams every `assets/*` object into a private temporary directory, laid out by key,
and runs the existing importer over it (`importer.import_amplify`): validation, a checksummed
conditional write to the asset bucket, and a `VALIDATED` version (Amplify slugs are the asset ids,
ADR-030). Each new version is re-read and checked (`services.verify_version`), and every source
object is reconciled by SHA-256 against the Django versions (`in_django`). Re-runs skip files
already imported. An object no exported record names stays `not_in_django` for a person to decide
on. Then, in Django Admin, an administrator publishes the versions that should be live and sets
the default.

## 7. Acceptance (owner, on the target environment)

| Check | How | Pass when |
|---|---|---|
| Counts reconcile | Section 4 totals vs the copy manifest's `summary` | Every referenced photo is `copied` or `already_copied`; every exception reviewed; `Reconciled: yes` on the photo re-run |
| Checksums reconcile | The reconciliation re-run; `child_photo_storage_audit`, `asset_storage_audit` | Zero `destination_mismatch`, zero orphans, zero missing objects |
| Photo upload, view, delete | As a test parent in the Django build: add, replace and remove a photo on a child | The photo appears, is replaced, and is gone; `child_photo_storage_audit` stays clean |
| Migrated photo view | A sample of migrated children, as their parent | `GET children/<id>/photo/` returns the photo; the image shows on the profile |
| Cross-parent denial | As a different test parent, `GET`, `PUT` and `DELETE children/<other child id>/photo/` and `photo/content/` | `404` every time, and the photo is unchanged |
| No public access | Open a presigned URL after its TTL; try the bucket URL without a signature | Expired / `403` |
| Asset version, publish, use | Publish an imported version and make it the default in Django Admin; open the region that uses it | `children/<id>/assets/?ids=<asset>` resolves that version; the scene loads it |
| No Amplify Storage call | `git grep "aws-amplify/storage" react/src` | Only `child-profile/deletion.ts` (delete only, section 1) and test mocks |

These checks are covered in tests with stubbed S3 and the in-memory stores
(`users/tests/test_amplify_photo_migration.py`, `assets/tests/test_amplify_object_migration.py`);
the live run is what proves them on real buckets.

## 8. Rollback

The migration only adds to Django. The Amplify bucket is never touched, so the Amplify app keeps
working and the copy can always be repeated.

```bash
# Photos: lists, then removes, only the photos the copy run created that are still unchanged.
../.venv/bin/python manage.py migrate_amplify_child_photos --rollback /secure/amp04-photos-copy.json
../.venv/bin/python manage.py migrate_amplify_child_photos --rollback /secure/amp04-photos-copy.json \
    --confirm-rollback
# Assets: deletes the never-published versions the run created; published ones are kept.
../.venv/bin/python manage.py migrate_amplify_asset_objects --rollback /secure/amp04-assets-copy.json
../.venv/bin/python manage.py migrate_amplify_asset_objects --rollback /secure/amp04-assets-copy.json \
    --confirm-rollback
```

- A photo the parent replaced or removed after the copy is `changed_since` and left alone.
- Asset definitions the run created are listed for review in Django Admin, not deleted.
- **React.** The React change cannot be rolled back by data: an Amplify build without it shows
  Amplify photos again. Ship the React change with the Django cutover (`VITE_BACKEND=django`), not
  before it, or Amplify-build parents stop seeing their child's photo until the cutover.

## 9. Outcome reference

Photos (`migrate_amplify_child_photos`):

| Outcome | Meaning | Action |
|---|---|---|
| `inventoried` | Listed and checksummed (inventory without an export) | None |
| `would_copy` / `copied` | Will be / was copied and verified | None |
| `already_copied` | Django already has these bytes for this child, verified | None |
| `django_photo_newer` | The parent uploaded a different photo in Django | None: Django wins |
| `unreferenced_object` | No exported child names this object | LAI-1204 review |
| `invalid_key` | Not `child-photos/<identity id>/<file>` | Review |
| `ambiguous_reference` | Two exported children name the same object | Review the export |
| `unresolved_owner` | The export gives no owner, or two that disagree | Review the export |
| `child_not_imported` | No Django child with that id | Run `import_amplify_profiles --apply` |
| `owner_mismatch` | Export owner is not the Django parent | Review: never copied |
| `identity_conflict` | Identity id shared across owners, or an owner under two identity ids | Review: never copied |
| `integrity_failed` / `read_failed` | Bytes did not match the listing, or could not be read | Re-run; investigate if it persists |
| `validation_failed` | The upload pipeline rejected it (`detail` has the code) | Review; the parent can upload again |
| `copy_failed` / `verify_failed` | Django storage refused it, or the stored copy did not match (and was removed) | Re-run |
| `destination_mismatch` | A Django photo row's stored object is missing or changed | Investigate before cutover |

Assets (`migrate_amplify_asset_objects`): `in_django` (a Django version holds these bytes),
`not_in_django`, `integrity_failed`, `read_failed`, plus the importer's own report
(`imported`, `skipped`, `unresolved` with a reason).

## 10. Verification record (this card, 2026-11-10)

| Check | Result |
|---|---|
| `npx vitest run` on `features/assets`, `features/child-profile`, `features/admin/catalogApi.test.ts`, `api/assets`, `routes/AdminIslandsAndAdventures.test.tsx` | Pass |
| `npx tsc -b` (react) | Pass |
| pytest `lai/apps/users`, `lai/apps/assets`, `lai/apps/core` (PostgreSQL) | Pass |
| Not run | Any AWS command, the live inventory and copy, browser checks, build, Playwright |
