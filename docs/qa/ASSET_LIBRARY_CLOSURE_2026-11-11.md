# Asset Library subproject: closure review (2026-11-11)

Trello parent: "[Subproject] Asset Library" (z61Oe83W, list Owner QA). Remaining delivery card:
"[AM-11 / AM-16] Asset delivery dev acceptance" (BgiQDaKv). Completed QA card: "[QA ACCEPTED]
Asset Library local QA + Treasure Rush integration" (Cv2g9zI2).

Reviewed on `main` at `b7b7309163aa7c7d16656a64da29824a942f597b` (2026-11-11). Nothing was
deployed, no AWS call was made, and no Trello card was changed.

## 1. Merge verification

| Check | Result |
|---|---|
| `5222b690613cb82075e918abfffee44f56923047` (2026-11-02, merge of `dev20261102`: AQS Phase 28, TR-12 to TR-20, AM-13, AM-17, POST-MERGE-05) is an ancestor of `main` | **Yes** |
| `origin/feature/asset-manager` head | `a4fc833c61ce246ca824a0b4bde1e6e1594dd62d` (2026-11-02) |
| Commits on `feature/asset-manager` not in `main` (`git log main..feature/asset-manager`, `git cherry`) | **0** |
| `feature/asset-manager` head is an ancestor of `5222b690` | Yes (merge base with `main` is the branch head) |
| Asset code changed in `main` after `5222b690` | `lai/apps/assets`, `react/src/api/assets`, `react/src/features/assets`: **none**. `infra/` only: the asset storage stack wired into the CDK app beside new frontend and EC2 stacks (LAI-INFRA-003 to 005), with cross-stack tests |

Core functionality present in `main`: `apps/assets` (models, `validation.py`,
`validation_media.py`, `formats.py`, storage, resolver, delivery, Django Admin with lifecycle
actions, 3D preview, hardened media route, importer), migrations, the React Django resolver
adapter and media helpers, Treasure Rush resolution (`regionAssets.ts`), the bundled fallback,
`infra/lib/assetStorageStack.ts`. The removed AM-14 API (`admin_api.py`) and AM-15 React staff
pages are absent, as ADR-045 requires.

## 2. AM-11 to AM-17 reconciliation

| Task | Code in `main` | Tracker before | Reconciled status |
|---|---|---|---|
| AM-11 signed CloudFront | Not built (by design) | Open, APPROVAL: AWS | **Open, deferred optimisation.** Not needed for launch (`ASSET_LIBRARY.md` section 8) |
| AM-12 S3 storage as code | Yes (`infra/`, tested) | **Missing from tracker** | Done as code; row added. Deploying is LAI-1002, verified by AM-16 |
| AM-13 non-model kinds | Yes | Done (said "on `feature/asset-manager`") | Done, in `main` via `5222b690`; owner local QA accepted |
| AM-14 admin REST API | Removed | Superseded | Superseded (no change) |
| AM-15 React staff pages | Removed | Superseded | Superseded (no change) |
| AM-16 deployed verification | n/a | Open; depends on AM-14, AM-15, LAI-0209, LAI-1002, LAI-1004 | **Open.** Stale dependencies removed: AM-14/15 superseded, LAI-0209 asset scope retired (section 21.11). Waits on LAI-1002, LAI-1004 and a live pass |
| AM-17 lifecycle completion | Yes | Done (said "not browser-verified") | Done, in `main`; owner local QA accepted; local browser suite passes (below) |

Stale wording fixed: `IMPLEMENTATION_STATUS.md` said the work was "merged into `dev20261102`
only"; `ASSET_LIBRARY.md` status line mentioned only AM-1 to AM-10. The Trello note "AM-13 to 15
historical TODO" on BgiQDaKv is settled by this table: AM-13 done, AM-14 and AM-15 superseded.

## 3. 2026-11-05 owner QA and Treasure Rush integration

Represented accurately and not reopened. Trello Cv2g9zI2 (Complete) records owner-reported
acceptance of QA-01 to QA-07, the Treasure Rush Asset Library integration pass and the automated
checks, in an isolated local QA checkout (PostgreSQL on port 5440), with `5222b690` as baseline.
The repository had no record of it; it is now noted in `ASSET_LIBRARY.md`, the tracker and
`IMPLEMENTATION_STATUS.md`, worded as owner-reported local acceptance. Since the asset code is
unchanged after `5222b690` and every check below passes, there is **no evidence of regression**.

## 4. Verification run (this review, `main` at `b7b7309`)

Local PostgreSQL 16, fresh `.venv` from `requirements-dev.txt`, `npm ci`.

| Gate | Result |
|---|---|
| Ruff check / Ruff format check | Pass / Pass (604 files) |
| `manage.py check` / `makemigrations --check` | No issues / No changes |
| pytest, Asset Library and audio (`lai/apps/assets`, `lai/apps/audio`) | **417 passed** |
| pytest, full suite (`LAI_REQUIRE_POSTGRES=1`) | **2,796 passed, 3 skipped, 0 failed** (21 min). The skips are `tests/deploy/test_nginx_hosts.py`, which needs an `nginx` binary this container lacks; unrelated to assets |
| `npm run typecheck` | Pass |
| oxlint | Pass: 0 errors, 69 warnings already in `main` (mostly `jsx-a11y` style hints; none in Asset Library code; some in Treasure Rush UI panels). Not blockers; worth a later lint pass |
| Prettier | Pass |
| Vitest, full React suite (`--maxWorkers=2`) | **4,587 passed, 407 files** |
| Vitest, `infra/` (incl. asset storage stack and cross-stack tests) | **82 passed, 6 files** |
| `npm run build` | Pass (chunk-size warning only) |
| `npm run adr:check` / `npm run content:check` | Pass (53 ADRs) / Up to date |
| Browser acceptance (`playwright.acceptance.config.ts`): `asset-library.spec.ts`, `treasure-rush.spec.ts` | **18 passed, 1 skipped by design** (the touch test runs only in the tablet project, where it passed) |

Infrastructure note: the first browser run failed to launch because the pinned Playwright 1.62.1
wanted a browser build not present in this container. The rerun used the preinstalled Chromium via
a temporary, uncommitted config override; no test or config in the repository changed.

Not run: deployed or live AWS checks (excluded; `aws` is denied to Claude), the other browser
specs (Question Studio, Chatty AI, Realm Explorer; unrelated to this subproject).

## 5. Remaining work

### Core MVP blockers (Asset Library)

**None found.** No failing test, no open defect recorded against the Asset Library, and the
owner-accepted local QA has no regression evidence.

Not Asset Library blockers, listed so they are not confused with it: real-family play still
depends on the child-profile migration (LAI-0502/0602, `ASSET_LIBRARY.md` section 19 step 9);
publishing the cove in a deployed environment needs a region publish path because
`publish_treasure_rush` is local-only (section 19 step 5). Both belong to deployment and
Treasure Rush/platform tracks, and both gate AM-16 in practice.

### AM-16 deployed AWS acceptance (open)

Needs, in order: LAI-1002 (asset bucket deployed, APPROVAL: AWS) and LAI-1004 (Django on dev)
accepted per `docs/infrastructure/dev-acceptance.md`; then, on dev: upload GLB, PNG and audio in
Django Admin; validate; publish; version switch and rollback; textures and animation in Treasure
Cove; signed child resolver and child isolation; retire stops new fetches; nothing public in the
bucket. **Not passed; no live evidence exists.** It must be run by the owner or with explicit AWS
approval.

### AM-11 signed CloudFront (deferred)

Depends on AM-6, LAI-1002 and LAI-1005; APPROVAL: AWS. Optimisation only. Django-signed delivery
is the launch path.

## 6. Trello reconciliation recommendations (owner action; nothing changed)

1. **Move "[Subproject] Asset Library" (z61Oe83W) to Complete**: the core implementation is fully
   in `main`, `feature/asset-manager` has no unique commits, and no core blocker remains. Append to
   its description: "Closure review 2026-11-11 on `main` b7b7309: see
   `docs/qa/ASSET_LIBRARY_CLOSURE_2026-11-11.md`. AM-16 and AM-11 continue on BgiQDaKv."
2. **Keep BgiQDaKv open** as the follow-up for AM-16 and AM-11. Update its description: AM-13 done,
   AM-14 and AM-15 superseded by ADR-045 (the "historical TODO" is resolved); AM-16 depends on
   LAI-1002 and LAI-1004 only; AM-11 is deferred. Consider splitting it into two cards so AM-16
   can close without AM-11, and moving it from Ready for Development to a blocked state until
   LAI-1002/1004 are accepted, since nothing in it can start before then.
3. Leave Cv2g9zI2 (QA accepted) as is.
