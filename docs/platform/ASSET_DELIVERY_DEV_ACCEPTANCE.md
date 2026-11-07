# Asset delivery: deployed dev acceptance (AM-16, with AM-11's deployed check)

Status (2026-11-07): **ready to run, not run.** The checker and this runbook exist; nothing has
been deployed or verified. Local QA of the Asset Library (QA-01 to QA-07, accepted by the owner
on 2026-11-05) does not count as deployed acceptance.

AM-16 passes when a dev environment on AWS shows, end to end and through Django Admin:
upload, validation, publication, resolution in a child scene (Treasure Cove), retirement
stopping new fetches, and nothing public. AM-11 adds one more run with
`LAI_ASSET_DELIVERY=cloudfront` once a distribution exists (step 8).

## 0. Reconciling the older AM-13 to AM-15 TODO

| Item | Today | Effect on this runbook |
|---|---|---|
| AM-13 non-model kinds (images, audio) | Done 2026-11-02, merged in `5222b690` | Steps 3 and 5 cover a PNG and an audio file as well as a GLB |
| AM-14 administrator REST API | Superseded by ADR-045, removed | Not tested. All uploads and publishing go through Django Admin |
| AM-15 React staff pages | Superseded by ADR-045, removed | Not tested. React stays child and parent only |

## 1. Prerequisites (each is an owner approval, none is done)

1. `LaiAssetStorage-dev` deployed with the Django role (`docs/ASSET_LIBRARY.md` 19.3 step 1).
2. Django on dev (LAI-1004, `docs/platform/DJANGO_EC2_DEPLOYMENT.md`) with
   `LAI_ASSET_STORAGE=s3`, `LAI_ASSET_BUCKET`, `LAI_ASSET_REGION`, and `LAI_ASSET_DELIVERY`
   unset (`django`). A release passing its health check.
3. The one-off tasks of 19.3 step 4 (`migrate`, an admin account, `ensure_asset_roles`,
   `load_content`), the cove seeded and published, and the three cove models imported
   (19.3 steps 5 and 6).
4. Two dev parent accounts, each with a child in Django: **parent A / child A** (the one under
   test) and **child B** of another family (the isolation check). Synthetic test data only; never
   a real child.
5. A React build with `VITE_BACKEND=django` pointed at dev (19.3 step 8).

## 2. Tool

`scripts/aws/verify-asset-delivery.py`: Python 3 standard library only, read-only, never prints
the token, redacts signed URLs. Tested against a fake API in
`tests/deploy/test_verify_asset_delivery.py`.

Parent A's Cognito **access** token (Django rejects ID tokens) goes in the environment, never on
the command line:

```bash
read -rs LAI_VERIFY_ACCESS_TOKEN && export LAI_VERIFY_ACCESS_TOKEN   # paste, then Enter
```

Get it from a dev sign-in, for example the browser's storage for the dev app
(`CognitoIdentityServiceProvider.<client id>.<user>.accessToken`). It expires within an hour;
fetch a fresh one per session and `unset LAI_VERIFY_ACCESS_TOKEN` afterwards.

Common arguments for the steps below:

```bash
COMMON=(--api-base https://<dev api host> --child <child A uuid> --other-child <child B uuid>
        --bucket <AssetBucketName output> --region <region>)
```

## 3. Upload and validate (Django Admin, as an Asset editor)

Upload through **Asset library, Asset versions, Add** (`docs/ASSET_LIBRARY.md` 19.2):

| # | File | Expect |
|---|---|---|
| U1 | A new GLB version of `npc-pip` keeping `Idle`, `Talk`, `Wave` | `VALIDATED`, next version number, clips listed |
| U2 | A GLB that drops `Talk` | Refused with a finding; nothing stored (check `manage.py asset_storage_audit`) |
| U3 | A PNG texture under a new image asset (for example `am16-texture`) | `VALIDATED`, image preview shows it |
| U4 | An audio file under a new audio asset (for example `am16-chime`) | `VALIDATED`, the audio preview plays |
| U5 | A file over the size limit or with an external `uri` | Refused with a finding |

Record each version id. `manage.py asset_storage_audit` must report every stored version
present in the bucket and no orphan.

## 4. Publish and resolve (as an Asset publisher)

Publish U1, U3 and U4; make U1 the default for `npc-pip`. Then (`<N>` is U1's version
number; asking for the pin as well saves a URL keyed `npc-pip@<N>` for step 6):

```bash
python3 scripts/aws/verify-asset-delivery.py "${COMMON[@]}" \
  --ids npc-pip,npc-pip@<N>,treasure-chest,ground-tile,am16-texture,am16-chime \
  --expect-delivery django --save-urls "$HOME/.lai-am16-urls.json"
```

All checks must pass: the resolver needs a token, is `private, no-cache`, child B is a 404, each
file is fetched with no token and matches its published SHA-256 and size, tampered URLs are
refused, the bucket refuses anonymous listing and reads.

## 5. In the child scene (browser, parent A signed in)

1. Enter Treasure Cove as child A. Pip is the U1 model and loops `Idle`, plays `Talk` and `Wave`;
   the chest plays `Open`; the floor tiles. No console warning `[assets] ... unavailable`.
2. DevTools, Network: model files come from `/api/v1/asset-files/...` on the app origin, `200`,
   `Cache-Control: private, max-age=..., immutable`; a reload serves them from cache.
3. Nowhere in the page or network log is the bucket host, a storage key or an AWS credential.
4. Make the previous `npc-pip` version the default; leave and re-enter the cove: the old model
   shows. Switch back.

The texture and audio assets have no child scene consumer yet; step 4's byte-for-byte check is
their delivery evidence. Note that in the report.

## 6. Retire

1. In Django Admin, make another version the default, then retire U1.
2. Re-run. The pin now resolves `retired`, the default resolves the other version, and the URL
   saved for `npc-pip@<N>` in step 4 must now fail (404 in `django` mode):

```bash
python3 scripts/aws/verify-asset-delivery.py "${COMMON[@]}" \
  --ids npc-pip,npc-pip@<N>,treasure-chest \
  --expect retired:npc-pip@<N> --revoked-urls "$HOME/.lai-am16-urls.json"
rm "$HOME/.lai-am16-urls.json"
```

3. Optional: retire the `am16-texture` definition; it resolves `retired`. Reactivate it after.

## 7. Private access, by hand

- `curl -sI https://<bucket>.s3.<region>.amazonaws.com/assets/models/` is `403`.
- The bucket's Block Public Access settings are all on and its policy denies non-TLS
  (`aws s3api get-public-access-block`, `get-bucket-policy`).
- The Django role is the only principal with object access (IAM policy
  `lai-django-asset-storage-dev`).

## 8. AM-11: the same run through CloudFront (after LAI-1005, separate approval)

When the distribution, key group and bucket-policy statement of `docs/ASSET_LIBRARY.md` 8.1
exist on dev: set the three `LAI_ASSET_CLOUDFRONT_*` values (the key as a SecureString) and
`LAI_ASSET_DELIVERY=cloudfront`, release, and repeat step 4 with `--expect-delivery cloudfront`.
The checker also requires the unsigned CDN URL to be `403`. Repeat step 5 (files now come from
the distribution host, cross-origin, so CORS must allow the app origin). Step 6 reports issued
URLs as still valid until expiry: that is expected for this mode. Roll back by unsetting
`LAI_ASSET_DELIVERY`.

## 9. Report

Record, for the Trello card and `docs/IMPLEMENTATION_STATUS.md`: the date, the release image, the
checker output for steps 4 and 6 (`--json`, it contains no secrets), the browser observations of
step 5, step 7's results, and anything that failed. AM-16 is accepted by the owner, not by the
script passing.
