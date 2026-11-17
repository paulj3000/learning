# Wave 3 interfaces (LAI-LAMBDA-006 and 007)

Frozen by the principal integration agent on 2026-11-17 for the Wave 3 workstreams. Cards:
[LAI-LAMBDA-006](https://trello.com/c/SYUqyvWM) and [LAI-LAMBDA-007](https://trello.com/c/WQAi4PAi).
It extends `WAVE2_INTERFACES.md` (still frozen) and supersedes the proposals in
`WAVE3_HANDOFF.md` sections 3, 4 and 6 where they differ. Change it only through the principal.

Scope decisions (owner, 2026-11-17): **Option A only**. The existing Django Admin upload stays
the upload surface; asynchronous processing follows it. No presigned PUT, no browser-to-S3, no
CORS, no new public API, no React staff UI, no quarantine promotion, no automatic publication.
The 50 MB upload ceiling is unchanged. ADR-062 is accepted. Nothing is deployed.

## 1. The flag

| Setting | Values | Default | Rule |
|---|---|---|---|
| `LAI_ASSET_ASYNC_VALIDATION` | `off`, `on` | `off` in every environment (base, production, test) | `on` is refused when `LAI_PROCESSING_BACKEND` is `disabled` (base.py), and in production unless the backend is `sqs` (production.py). No deployment sets it |

Helpers in `apps.assets.processing` (foundation commit, principal-owned):

| Symbol | Behaviour |
|---|---|
| `async_validation_enabled()` | The flag is `on` |
| `async_validation_applies(version_or_format)` | Flag on **and** the format is in `ASYNC_FORMATS` (`{"glb"}`); every other format keeps the synchronous path |
| `current_processor()` | `(processor_id, version)` the registry resolves for `asset.validate_model` / `glb-default` v1 |
| `validation_jobs(version)` | The version's `asset.validate_model` jobs (subject `asset_version` / version uuid), newest first, never locked |
| `identity_mismatch(job, version, *, require_current_processor=False)` | `None` when the job validated exactly this version's bytes, else a reason code: `kind_mismatch`, `subject_mismatch`, `namespace_mismatch`, `asset_mismatch` (asset id, version uuid, number from the request's `AssetContext`), `storage_mismatch` (store `assets`, key, no object version), `checksum_mismatch`, `size_mismatch`, `profile_mismatch`, `processor_outdated` (gate only) |
| `model_validation_summary(job)` | Normalized summary of a succeeded result (identity, processor, profile, verdict, counts, `triangle_count`, `vertex_count`, `material_names`, `images`, `skins`, `animations` with exact names and `duration_seconds`, `bounds`, extensions, run warnings, error and warning counts), or `None` |
| `processing_findings(job)` | The result's findings in the Asset Library report shape plus `"source": "processing"` (at most 200) |
| `RESULT_STATES` | `{"validated", "ready_for_review"}` |

## 2. Upload (006, workstream A)

`services.upload_version` with `async_validation_applies(format)`:

1. Synchronous checks exactly as today (checksum, size, format, `validate_upload`). A failing file is
   never stored.
2. In the existing transaction, with the asset row locked: duplicate check, number allocation,
   storage put (existing behaviour), `AssetVersion` created as **`DRAFT`** with the synchronous
   report, clips, dimensions and metadata, `validated_at = None`, then
   `submit_model_validation(version, user=user)` (job, attempt 1 and outbox row) **in the same
   transaction**. Any failure rolls all of it back and deletes the just-written object
   (`_delete_quietly`); a `ProcessingJobsError` becomes `AssetActionRefused("processing_unavailable",
   ...)`. A commit failure after the put leaves an orphan object, found by `audit_storage` (existing).
3. Returns the `DRAFT` version promptly. Flag off, or another format: today's `VALIDATED` path,
   byte for byte.

## 3. Completion hook registry (principal) and asset hook (006, workstream B)

`apps.jobs.processing` (foundation commit):

- `HookResult(code: str, review_ready: bool = False)`.
- `register_completion_hook(job_type, subject_type, hook)`: explicit; same callable again is a
  no-op; another callable for a registered pair raises `ImproperlyConfigured`; `job_type` must be a
  contract kind. `completion_hook(...)`, `set_completion_hooks_for_tests(mapping | None)`.
- Called by `_apply_locked` after every **APPLY** (succeeded, failed or cancelled result), inside
  the completion transaction and under the job row lock, in a savepoint. Never for DUPLICATE,
  STALE, RETRY or REJECT. `DatabaseError` propagates (completion deferred, redelivered); any other
  exception is logged (`processing.hook_error`), `subject_outcome = "hook_error"`, and the applied
  job result is kept.
- The hook's code is stored in `ProcessingJob.subject_outcome` (migration `jobs.0003`);
  `review_ready` moves the job `validated -> ready_for_review`.

The asset hook (`apps/assets/completion.py`, registered in `AssetsConfig.ready()` for
`("asset.validate_model", "asset_version")`):

| Situation | Version | `HookResult` |
|---|---|---|
| Result not `succeeded` (terminal processing failure, cancelled) | unchanged (stays `DRAFT`) | `processing_failed`, not review-ready |
| Version row gone | none | `version_missing` |
| `identity_mismatch(job, version)` returns a reason | unchanged; WARNING `processing.subject_mismatch job=.. reason=..` | the reason, not review-ready |
| Version not `DRAFT` (validated, published, retired, rejected: a manual revalidation) | unchanged (published versions are immutable) | `result_recorded`, review-ready |
| `DRAFT` and verdict `pass` | `DRAFT -> VALIDATED`, `validated_at`, report = upload findings + `processing_findings(job)`, `metadata["model_validation"] = model_validation_summary(job)` | `version_validated`, review-ready |
| `DRAFT` and verdict `fail` | `DRAFT -> REJECTED`, same report and summary | `version_rejected`, review-ready |

`clips` and `dimensions` keep the synchronous values (exact clip names live in the summary).

## 4. Lock order (verified against the code, 2026-11-17)

| Path | Locks, in order |
|---|---|
| Completion (`apply_completion` + asset hook) | job row -> `ContentAsset` row -> `AssetVersion` row |
| Upload (`upload_version`) | `ContentAsset` row; inserts version, job, attempt and outbox rows (no existing job locked) |
| Publish, set default, retire, republish | `ContentAsset` row -> `AssetVersion` row; the publication gate **reads** jobs without locking |
| Cancel, requeue, reconcile | job row (then its own outbox and attempt rows) |
| Delete unpublished version | `AssetVersion` row only |
| Admin "Validate in background" | none held while submitting (`submit_processing_job` inserts) |

No path takes a job lock after an asset or version lock, so the completion order cannot form a
cycle. The asset hook must lock the asset before the version (as `publish_version` does).

## 5. Admin and publication gate (007, workstream D)

- Version change page: a read-only "Background validation" section built from
  `validation_jobs(version)` (latest), its state, `subject_outcome`, `model_validation_summary`,
  `processing_findings`, timestamps, current attempt, retry eligibility and a link to the job
  admin page. All text escaped (`format_html`/`format_html_join`), never `mark_safe` on job data.
- Action **Validate in background** (`assets.add_assetversion` plus view): submits or returns the
  existing job (`submit_model_validation`); refuses retired assets; never changes the version.
  The legacy "Inspect in background" (`asset.inspect`) stays as it is.
- Publication gate in `services.publish_version`, only when `async_validation_applies(version)`:
  require a job in `validation_jobs(version)` with `state in RESULT_STATES`, verdict `pass`, and
  `identity_mismatch(job, version, require_current_processor=True) is None`; otherwise
  `AssetActionRefused("processing_required", <safe message>)`. Checked before the bytes are
  re-read; the existing re-read and synchronous re-validation stay. Rollback, republish and set
  default are not gated.

## 6. Operations (006, workstream C)

- `jobs_reconcile` on a systemd timer (`lai-jobs-reconcile.timer` + `.service`, oneshot,
  PostgreSQL advisory lock so two runs never overlap), installed and quiesced with the other
  units, and run once by `power-native.sh verify` after the database is reachable.
- Startup: the consumer already checks PostgreSQL before every receive; units start only after
  RDS is reachable.
- DLQ runbook in `OPERATIONS.md`. Restricted redrive (B7: separate work and completion sender
  lists and an operations redrive role list, no Django access) is a Wave 2 review fix on
  `feature/serverless-processing-wave2`, merged into Wave 3 by the principal.
- Monitoring: log metric filters and alarms on `processing.completion_rejected`,
  `processing.outbox_stuck`, `processing.reconcile_failed`, `processing.subject_mismatch`,
  `processing.hook_error` and `processing.consumer database_error`.

## 7. Workstream ownership

| Workstream | Owns | Must not edit |
|---|---|---|
| A, upload | `services.upload_version`, upload tests, `AssetVersionAdmin.upload_view` messages for a draft | the hook, the gate, `apps.jobs` |
| B, completion | `apps/assets/completion.py`, `apps/assets/apps.py`, hook and concurrency tests | `services.py`, `admin.py`, `apps.jobs` (report needed changes) |
| C, operations | `deploy/native/systemd/`, `scripts/aws/native/`, log metric filters and alarms in `infra/` (where the Django log group is owned), `jobs_reconcile` command, `OPERATIONS.md` | `apps/assets/*`; the queue policies and sender lists in `processingStack.ts` (Wave 2 fix) |
| D, admin and gate | `apps/assets/admin.py`, admin templates, `services.publish_version`, admin and gate tests | `upload_version`, the hook |
| Principal | this page, `apps.assets.processing`, `apps.jobs.processing` hook registry, settings, migrations, ADRs, README, trackers, integration | |

## 8. Integration notes (2026-11-17)

Recorded by the principal at integration. The sections above stay as frozen; these notes record
what the integrated code does where the freeze left it open, and one bug fixed.

- **`async_validation_applies` accepts a format string.** It takes a version or a format name
  (`"glb"`). The first version read `.format` from its argument, and a `str` has a `.format`
  method, so a format name never matched and the upload path stayed synchronous with the flag on.
  Fixed at integration: a `str` is used as the format directly.
- **The registry lives in `apps.jobs.hooks`.** `HookResult`, `register_completion_hook`,
  `completion_hook` and `set_completion_hooks_for_tests` moved to a module without
  `lai_processing` imports, so `AssetsConfig.ready()` does not load the processing contracts at
  start-up (`manage.py check` runs without `processing/` on the path). `apps.jobs.processing`
  re-exports them; section 3's names and behaviour are unchanged.
- **Hooks must not mutate the job object.** A non-database hook error rolls back the hook's
  savepoint, but `apps.jobs.processing` saves the job object afterwards, so an in-memory change a
  hook made to it would still be saved. Hooks return a `HookResult` and change only their own
  rows.
- **An `IntegrityError` inside a hook is deferred like a database error.** It is a
  `DatabaseError`, so it propagates, the whole completion rolls back and is retried once, then
  deferred (`integrity_error`); the message is redelivered until it reaches the completion DLQ.
  It is never recorded as `hook_error`.
- **`subject_mismatch` and `profile_mismatch` are handled but not reachable through
  `apply_completion`.** The hook is found by the job's own kind and subject type, and
  `apply_completion` refuses a result whose profile differs (`REJECT profile_mismatch`) before any
  hook runs. `identity_mismatch` still returns both codes for a direct call and for the gate.
- **Any non-pass verdict rejects the draft.** The asset hook moves a `DRAFT` to `VALIDATED` only
  on `pass`; `fail` and also `not_applicable` move it to `REJECTED` (`version_rejected`).
- **"Validate in background" on a finished job returns that job.** The idempotency key covers the
  namespace, kind, subject, input identity, profile, options and processor version, so a second
  run for the same file and validator returns the existing job (Admin says it already finished)
  and does not run the hook again. A `failed` job can be requeued from its job page. A `cancelled`
  job cannot be requeued (the lifecycle has no transition out of `cancelled`). Workaround until
  the owner decides: delete the draft and upload the file again (a new version, so a new key).
- **Gate and Admin tests start from versions uploaded with the flag off.** They create a
  `VALIDATED` version synchronously, then turn the flag on, so the gate (`processing_required`
  until a passing job exists) and the Admin section are tested independently of the draft path;
  the draft path itself is covered by `test_async_upload.py`, `test_completion_hook.py` and
  `test_processing_wave3_end_to_end.py`.
