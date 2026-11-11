# NPC Manager: QA report (Phase 30, OWNER QA readiness)

Date: 2026-11-07. Branch under test: `feature/npc-manager` at `dc3a8a7` (DEVELOPMENT COMPLETE).
QA branch: `qa/npc-manager-acceptance` (all fixes and tests below). Agent: Claude Code, in a cloud
container. **Nothing is merged and nothing is accepted by this report**: final acceptance and the
merge to `main` are the owner's.

Everything here ran against a real Chromium (Playwright 1.62.1, Chromium build 1243, software
WebGL through SwiftShader), a real Django 6.1 and a real PostgreSQL 16 (port 5442), with the e2e
stack's fake AI provider, speech disabled and in-memory asset storage. **No live AWS call was made.**

## 1. Summary

| Area | Result |
|---|---|
| Backend tests (pytest, full suite) | PASS: 2503 passed |
| Frontend tests (Vitest, full suite) | PASS: 4242 passed in 377 files |
| Django Admin browser QA | PASS (12 browser tests, desktop and 390 px mobile width) |
| Treasure Rush integration | PASS: the NPC Manager's own 8 browser tests and the pre-existing Treasure Rush suite with the managed Pip (F-B fixed, section 8a) |
| Storykeeper's Castle integration | PASS with documented limits (7 browser tests); tale, quest log and backpack need Amplify, not available locally |
| Animation QA | PASS (browser, Admin, asset validation and AnimationMixer tests); the owner's Mixamo pirate file was not available to inspect (section 4) |
| Polly live QA | BLOCKED (no approved test environment or spending limit; fake-client regression PASS) |
| Bedrock live QA | BLOCKED (same; fake-model regression PASS) |
| Accessibility | PASS for automated checks; MANUAL REQUIRED for screen readers, switch access and tablets |
| Merge readiness | READY FOR OWNER REVIEW after F-A and F-B (section 8a): every gate and the full browser suite pass (63 passed, 0 failed). Owner acceptance, manual accessibility and live AWS remain |

Four defects were found and fixed with regression tests (section 6). None of the four documented
limitations is a release blocker (section 7).

## 2. What was inspected

`tasks/TASK_TRACKER.md` Phase 30, `docs/NPC_MANAGER_IMPLEMENTATION_PLAN.md`,
`docs/NPC_MANAGER_CONTRACTS.md`, `docs/NPC_MANAGER_BROWSER_ACCEPTANCE.md`, ADR-054, the e2e
acceptance harness (`tests/e2e/django_server.py`, `react/e2e/acceptance/`). Existing automated
acceptance: `lai/apps/npcs/tests/test_acceptance_flow.py` and
`react/src/features/npc-manager/acceptance/npcManager.acceptance.test.tsx`, both with fakes and
no browser. Missing before this pass: every Part B browser step, real WebGL, real GLB clips, axe.

Branch relationships (fetched 2026-11-07): `feature/npc-manager` is 67 commits ahead of `main`
(`5222b69`, unchanged since the branch point) and contains all of `feature/sound-manager`
(`d5d694a`). It does not contain `dev20261103` / `integration/content-dev20261103` (`bf324fa`).

## 3. Browser coverage (new Playwright specs)

Run with `npm run test:acceptance -w react -- npc- --project=desktop` (PostgreSQL on the compose
port; set `LAI_E2E_CHROMIUM` only where Playwright's own Chromium is not installed). The specs are
numbered because `npc-1-admin` publishes the release the others use. The e2e server now seeds the
NPC roles and Pip and Quill as **unpublished** drafts, so the older suites still see the legacy
NPCs until a spec publishes.

| Spec | Tests | Covers |
|---|---|---|
| `npc-1-admin.spec.ts` | 12 | Staff login; permission refusals (no-perms and Studio author 403, editor sees no Publish); character GLB upload and asset publish; Mixamo-named GLB keeps its take names and is flagged; Django-only character; variant animation map (missing clip, unknown state, non-object, Mixamo semantic names refused, valid map); behaviour profile (schema and geometry refusals, preview SVG); placement (Place on another Island refused); dialogue with nodes and ordered choices; validate refuses a broken dialogue (no Publish button, no release); publish release 1 (DRAFT character left out until READY); runtime place/area/catalog reads (exactly one Pip, one Quill, server-only keys absent); draft node edit and unpublished model v2 never served; retired character dropped by release 2; rollback to release 1; dependency report; asset retirement refused while used; retire the active release (`404 no_active_release`); a retired release offers no rollback; another family 404 and no token 401 on every route; five Admin pages at 390 px with no horizontal overflow |
| `npc-2-treasure.spec.ts` | 8 | Exactly one managed Pip on the authored spot, manifest Pip hidden; first-visit greeting once; Talk prompt only within reach; dialogue opens with the talk animation and closes back to idle; focus returns to the prompt; keyboard (E opens, Tab stays inside, Escape closes); quest accept through the normal flow; Pip never covers the chest panel or reward reveal; reaction after a find; rewards exactly once (inventory unchanged by talking again or reopening a chest); return visit keeps progress and plays the welcome-back line; five reloads never show two Pips; legacy Pip on `404 no_active_release` and on a proxy 502; a model that fails to load stands as a placeholder you can still talk to |
| `npc-3-castle.spec.ts` | 7 | Exactly one managed Quill on his spot facing the entry hall, `Idle` clip; stationary and solid (the child cannot walk through him); prompt within reach; first meeting, story offer, talk animation, "I am just visiting." closes, once-per-child then the rules line; no "Hear it again" when speech is refused; accepting the offer keeps the page usable; Sprout greeting with no quest offer; re-entry never doubles Quill; legacy Quill on 404 and 502 |
| `npc-4-a11y.spec.ts` | 5 | axe-core WCAG 2.1 A/AA on the prompt and the panel (0 violations); 56 px targets; named modal dialog, one atomic polite live region with the line once, labelled choice group, focus inside; reduced motion (no transitions or animations in the panel); muted child: captions only, no speech request, no replay; 20 conversations and 5 client-side re-entries with heap and frame samples |

The existing `treasure-rush.spec.ts` (the whole of Pip's Missing Treasure) now runs after the NPC
specs, that is **with the managed Pip**, which makes it a parity check of the legacy experience.
It fails in three places (F-B, section 8).

Screenshots (a selection, full set in `react/test-results/npc-qa/` after a run) are in
`docs/qa/npc-manager/`:

- Admin: `admin-02-mixamo-version-findings.png`, `admin-04-mixamo-map-refused.png`,
  `admin-08-dialogue-node-choices.png`, `admin-09b-validate-refuses-broken-dialogue.png`,
  `admin-10-published-release-1.png`, `admin-13-asset-retire-refused.png`, `admin-m4-validate.png`
- Treasure Cove: `cove-01-first-greeting.png`, `cove-02-talk-prompt.png`,
  `cove-05-pip-reacts-to-treasure.png`, `cove-07-placeholder-pip.png`, `cove-08-welcome-back.png`
- Castle: `castle-01-managed-quill.png`, `castle-02-quest-offer.png`,
  `castle-05-legacy-fallback-404.png`
- Accessibility: `a11y-02-muted-captions-only.png`; performance sample `perf.json`

Browser coverage: Chromium only (desktop 1280x720 and 390x844 for Admin). Firefox, Safari/WebKit
and real tablets were not run.

## 4. Animation and GLB (Phase 3)

**What exists.** Upload validation records every animation name verbatim (`AssetVersion.clips`),
refuses duplicates and names over 64 characters, and warns on names outside the clip vocabulary.
The variant form and release validation refuse an animation map naming a clip the resolved model
does not have, listing the clips it does have. At runtime the animator resolves a state only
through the map and the fixed fallback chain (`ANIMATION_FALLBACKS`); it never matches clip names
by guesswork, and with no usable clip it uses a small procedural motion whose one-shots still end
on time.

**The Mixamo pirate.** The uploaded file with `Armature|mixamo.com|Layer0` and
`Armature|mixamo.com|Layer0.001` is not in any branch of the repository, so it could not be opened
here. A synthetic GLB with exactly those take names (built from the bundled Pip placeholder,
`react/e2e/acceptance/support/glb.ts`) was used instead. Verified in the browser: the version page
lists the names exactly and warns; mapping `idle`/`talk`/`wave` to `Idle`/`Talk`/`Wave` is refused
with the real take names shown; nothing is mapped automatically.

**Asset deficiency (exact).** A model whose takes are `Armature|mixamo.com|Layer0`,
`...Layer0.001`, `...Layer0.002` carries no information about which motion each take is. It has
no clip named for any NPC state (Idle, Walk, Talk, Wave, Point, Celebrate, ReactHappy,
ReactConcerned), so a variant built on it can only stand with procedural motion, or with a map that
someone has checked take by take. QA did not, and the system must not, assign Idle/Walking/Talking/
Waving to these takes.

**Corrective export (Blender 4.x).**

1. Download each Mixamo animation separately as FBX (one take per file; "With Skin" for the first,
   "Without Skin" for the rest), so you know which file is which motion.
2. File > Import > FBX each file. In the Dope Sheet's Action Editor, rename every imported action
   to its motion: `Idle`, `Walk`, `Talk`, `Wave` (optionally `Point`, `Celebrate`,
   `ReactHappy`, `ReactConcerned`). Exact, case-sensitive names from the clip vocabulary.
3. Keep every renamed action on the one skinned armature and mark each with a fake user (the
   shield icon in the Action Editor) so Blender keeps it; delete the extra armatures and meshes
   the other FBX files brought in.
4. File > Export > glTF 2.0: Format "glTF Binary (.glb)"; under Animation, enable animation export
   and choose the mode that writes one glTF animation per action ("Actions" in Blender 4.x), so each
   animation is named after its action. Exact option names vary between exporter versions; what
   matters is the check in step 5.
5. Check the result before uploading: drop the GLB into https://gltf-viewer.donmccurdy.com/ (or the
   Admin "Preview in 3D") and confirm the animation list reads exactly `Idle, Walk, Talk, Wave`.
6. Upload as a new version of the character asset; the version page's "Animation clips" must show
   those names and no `generic_clip_name` warning. Then set the variant's map, for example
   `{"idle": "Idle", "walk": "Walk", "talk": "Talk", "wave": "Wave"}`.

Bulk renaming and retargeting stay with the separately planned Lambda animation-processing
project; nothing here starts that work.

**Resolved 2026-11-07: the pirate is Pip's `pirate` variant.** The owner sent the pirate as one
file per Mixamo motion. Its four usable motions were merged onto the one skinned mesh as `Idle`,
`Walk`, `Wave` and `Point` (`content/models/npc-pip-pirate.glb`, 3.3 MB; validator: no
findings). Left out: Shooting (not suitable for the age range), the two talking takes (phone and
seated), Sitting Idle, Looking Around and T-pose (outside the clip vocabulary). There is still no
`Talk` clip, so talk falls back to idle. Apply it with
`manage.py add_pip_pirate_variant [--use-in-cove] [--publish]`: it creates the Django-authored
asset `npc-pip-pirate`, uploads and publishes the file through the Asset Library services, and
adds the `pirate` variant (scale 1.25, map idle/walk/wave/point). `classic` and the shared
`npc-pip` placeholder are unchanged, and `classic` stays the default. `--use-in-cove` points the
Treasure Cove placement at the pirate (switch back in Admin by clearing the placement's variant).
Checked in Chromium against a local stack: the pirate loads (not the placeholder), faces the
child, stands at Pip's height and plays Wave on arrival and Idle at rest.

**Added in this pass.** A `generic_clip_name` upload warning for exporter default take names
(`mixamo.com`, `|LayerN(.00n)`, `ArmatureAction`, `Action.00n`, `Take 001`) with the fix above;
regression tests at every layer: `lai/apps/assets/tests/test_validation.py` (Mixamo and other
default names flagged, descriptive names not, duplicates still an error),
`lai/apps/npcs/tests/test_admin_characters.py` (semantic names refused for a Mixamo model, an
empty map stays empty, an exact reviewed take accepted, a near miss refused),
`react/src/features/npc-manager/animation/npcAnimator.test.ts` (no map: no take chosen, no crash,
one-shots finish; one mapped take used as every fallback; unknown map names ignored; dispose).
Playback, switching, looping, crossfade, priorities and cleanup were already covered by the
existing animator tests; the browser specs confirm the real `Idle` clip plays, `talk` and `wave`
overlays start with dialogue and clear when it closes.

## 5. Polly and Bedrock (Phase 6)

**Audit.** Voice reuses `speech.VoiceProfile`, the ADR-049 Polly client and cache; NPC lines are
`npcDialogueNode` references resolved from the ACTIVE release. Bedrock hints go through
`apps.ai.run_turn` with a versioned, approved `NpcPersona`, server-built context, no child free
text, authored fallbacks. Captions always show.

**Fake-client regression (run here).** `pytest lai/apps/npcs lai/apps/speech lai/apps/ai
lai/apps/assets`: 891 passed. Covers speech disabled (safe 503, nothing called), Polly failure
(safe 503, not cached), storage failure, cache hits and versioning, voice validation, publish-time
pre-generation never raising; AI hint success writes only an audit row, invalid output and
boundary violations fall back (safety event), Guardrail intervention, redirect/stop dispositions,
parent switch and kill switch, disabled provider, rate limit, authored characters never call a
model, no client text accepted, another family 404. Vitest covers captions, mute, interruption and
audio/animation synchronisation (`voice/*.test.ts`), and the browser specs cover captions with
speech refused and a muted child making no speech request.

**Live AWS: BLOCKED.** The container has AWS credentials in its environment, but there is no
approved test account, spending limit, Guardrail id/version or confirmed model and voice
availability, and the tracker marks LAI-NPC-027/028/030/033 as needing owner approval. Credentials
alone are not approval, so no call was made (not even an identity check). Nothing here claims a
live PASS. The live Polly smoke belongs to the separate Sound Manager live Polly card; the live
Bedrock check pairs with LAI-0705 / LAI-AQS-025.

**Pip's voice profile.** Recommendation: **captions-only is acceptable for this merge**, and a
published voice profile is **not** a release requirement for OWNER QA. Reasons: ADR-054 item 8
makes audio optional and captions mandatory; no environment has live Polly, so a profile would not
change what any child hears today (Quill, who has one, is also captions-only); and after QA-D2
Pip's talk lines animate without audio. Before a child-facing launch to Sprouts (ages 3 to 4,
voice-first in CLAUDE.md section 3), the owner should choose Pip's voice and make it a launch
requirement together with the Sound Manager live Polly card. Choosing the voice is a content
decision left to the owner.

## 6. Defects found and fixed

| Id | Defect | Fix | Regression tests |
|---|---|---|---|
| QA-D1 | The dialogue choice inline in Django Admin had no `sort_order`, so every staff-authored choice was saved as 0 and served alphabetically by key ("Maybe later" before "Tell me more") | `sort_order` added to the inline | `test_dialogue_choices_keep_the_order_staff_give_them` (fails without the fix); `npc-1-admin` |
| QA-D2 | A `talk` line with no audio (no voice profile, speech disabled, muted, or a failed request) never played the talk animation: the host left `talk` to the voice coordinator, which animates only while audio plays. Pip stood idle through every talk line | The host starts the talk loop when the line shows; a voice that plays still stops it when the audio ends | `useNpcSceneHost.test.tsx` "a captions-only talk line plays the talk loop" (fails without the fix); `npc-2-treasure`, `npc-3-castle` |
| QA-D3 | Returning to Treasure Cove with the session still open never raised `on_return_visit`: the client resumes from the region bootstrap without a start call, so Pip's welcome-back line (LAI-NPC-018, checklist B4.11) never played | `useRegionPlay` reports the bootstrap's open session as a resumed `session_upserted` (`created: false`) | two `useRegionPlay.test.tsx` tests (fail without the fix); `npc-2-treasure` "a return visit" |
| QA-D4 | A voiced line whose speech was refused (speech disabled everywhere today, or Polly down) still offered "Hear it again", which could only fail again (checklist B7.1, B13.10) | The NPC voice state carries `refused` (no clip came back); the button hides for that line. A clip whose playback was merely blocked (autoplay) keeps the button | `useNpcSceneHost.test.tsx` QA-D4 test (fails without the fix); `npc-3-castle` |

Also changed: the variant extras inline now says extras are "checked and published, but not shown
in the game yet" (limitation 4); an e2e-only diagnostics hook (`NPC_DIAGNOSTICS` on each NPC root,
read by the e2e probe that only `vite --mode e2e` installs); `@axe-core/playwright` 4.14.0 added
as a test-only dev dependency of the React workspace (lockfile change is additive, 27 lines);
`playwright.acceptance.config.ts` honours `LAI_E2E_CHROMIUM` for a preinstalled browser.

## 7. Documented limitations, classified

| # | Limitation | Classification | Evidence and reasoning |
|---|---|---|---|
| 1 | Pip has no voice profile | ACCEPTED LIMITATION (for this merge); owner decision before a Sprout-facing launch | Section 5. Captions always show; talk lines animate (QA-D2) |
| 2 | Quill's conditions cannot read the castle's Amplify quest state | ACCEPTED LIMITATION; FUTURE ENHANCEMENT when the castle's adventures move to Django (LAI-AQS-028) | Verified: the offer is once per child, a second talk gives the rules line, Sprouts get no offer, and accepting hands over to the castle's own quest flow without breaking the page. Quest state is never written by the NPC Manager |
| 3 | Castle wrong answers do not raise `on_incorrect_answer` | FUTURE ENHANCEMENT | The castle's answers are Adventure Engine results, not play API outcomes; Quill still shows concern through the forwarded gesture. Needs the castle on the play API |
| 4 | Variant accessories are validated but not rendered | ACCEPTED LIMITATION, now labelled in Admin | No published character uses accessories. Rendering them is new runtime work (attach points, disposal) not needed for acceptance |

Also found, not fixed (owner or other owners to decide):

- **O1, two talk prompts for managed Pip.** The world HUD's focus prompt ("E Talk Pirate Pip") and
  the NPC host's "Talk to Pirate Pip" button show at the same time; both open the same
  conversation (the proxy design in the plan). Redundant for young children and screen readers.
  Suggest hiding one when both target the same NPC.
- **O2.** The NPC host's prompt sits across the bottom edge of the 3D canvas, over the "Things to
  do here" box (`cove-02-talk-prompt.png`). Cosmetic.
- **O3, pre-existing, not NPC Manager.** axe on the whole cove page reports one serious
  `label-content-name-mismatch` on the world HUD's action prompt (`aria-label="Talk: Pirate Pip"`
  versus its visible "Talk Pirate Pip"). Results in `react/test-results/npc-qa/axe-cove-page.json`.
- **O4, Sound Manager behaviour.** With speech disabled, each voiced line costs one refused
  request (`503 speech_unavailable`, a browser console "Failed to load resource" line). Captions
  are correct. A client that remembers "speech is resting" for the session would remove the noise;
  this belongs to the Sound Manager owner.
- **O5.** In the castle, `on_return_visit` is raised only when the tale itself resumes (an Amplify
  session), so re-entering the castle without resuming the tale plays no welcome-back line
  (checklist B13.9 needs the owner's Amplify-backed run).
- **O6, pre-existing legacy.** The legacy Quill is shorter than the eye-height reticle, so a child
  must look down to focus him; the castle text says "use the button below" but no button appears.
  The managed Quill's proximity prompt avoids both.
- **O7.** Heap after garbage collection grew about 0.4 MB per client-side re-entry of the cove
  (30.0 to 31.6 MB over five), and 0.9 MB over 20 conversations: inside the test budget, but worth
  a look in the owner's tablet profiling (`docs/NPC_MANAGER_PERFORMANCE.md`). Frame times here
  (median 100 ms) reflect SwiftShader software rendering on 4 shared CPU cores, not a device.
- **O8 (noted at LAI-NPC-040).** A hint with `LAI_AI_PROVIDER=disabled` writes no
  `AIInteractionAudit` row.

## 8. Merge-readiness gates

Gate results on the QA branch head (all run in this container on 2026-11-07):

| Gate | Command | Result |
|---|---|---|
| Django tests | `LAI_REQUIRE_POSTGRES=1 pytest -q` | PASS, 2503 passed (2489 before this pass; +14 QA tests) |
| Migration consistency | `manage.py makemigrations --check --dry-run`; `manage.py check` | PASS, no changes; no issues |
| Fresh-database migrate | every e2e run drops and migrates `lai_e2e` from zero | PASS |
| Vitest | `vitest run` (react) | PASS, 4242 passed in 377 files (4235 before; +7 QA tests) |
| TypeScript | `npm run typecheck` (react, amplify, scripts, server, infra) | PASS |
| Ruff | `ruff check .`; `ruff format --check .` | PASS |
| Prettier | `prettier --check .` | PASS |
| oxlint | `npm run lint` | PASS (exit 0; existing warnings only) |
| ADR check | `npm run adr:check` | PASS, 50 decisions, 50 registry rows |
| Production build | `npm run build` | PASS (existing chunk-size warning) |
| Admin preview bundle | `npm run admin-preview:check` | PASS, fresh |
| NPC browser specs | `test:acceptance -- npc-` (32 tests) | PASS, 32 passed (within the full run too) |
| Full browser acceptance | `npm run test:acceptance` (desktop and tablet projects, 64 tests) | **FAIL: 56 passed, 6 failed, 1 skipped (touch test, desktop only), 1 did not run (serial follow-on of a failure)** |

**The six browser failures.** None of these suites had been run on `feature/npc-manager` before
(the plan ruled browser runs out). All six trace to two NPC Manager behaviours:

- **F-A, no active release is reported as an error (2 tests: `asset-library.spec.ts` "a published
  model replaces the bundled one", `integration.spec.ts`).** With no ACTIVE NPC release, every
  Treasure Cove visit calls `GET .../regions/treasure-rush-cove/npcs/`, gets the contract's
  `404 no_active_release`, and the browser logs "Failed to load resource". The game behaves
  correctly (legacy Pip), but the harness's console and network guard treats any `/api` 404 as a
  failure, and every environment without a release (production included, today) will log this on
  every visit. Options for the owner: accept it and teach the harness that this 404 is normal, or
  change contract 1.1 so "no release" is `200` with no placements.
- **F-B, Pip's unprompted lines open a modal panel (4 tests: `treasure-rush.spec.ts` x3 and
  `question-studio.spec.ts` "a pool serves published questions to Treasure Rush").** On arrival
  (first-visit greeting) and on every resumed visit (welcome back, now that QA-D3 raises it) the
  managed Pip opens the same modal dialogue panel used for a conversation. It covers "Full screen",
  hides the HUD's "Hint" and takes focus until the child presses Close or Continue
  (`docs/qa/npc-manager/fb-greeting-blocks-fullscreen.png`, `fb-welcome-back-modal.png`). The
  legacy Pip never spoke unprompted. Checklist B4.1 and B4.11 ask for the greeting and the
  welcome back, but nothing asks for them to block the HUD. Options for the owner: keep the modal
  lines and update the legacy suite to close them; or show ambient lines as a non-modal caption or
  speech bubble (a UX change to the host), which keeps the legacy flows working unchanged. Either
  way, this is the one item standing between the branch and READY.

QA did not change either behaviour or the pre-existing suites, because both choices change what a
child experiences.

**Migrations.** `makemigrations --check` is clean; every e2e run migrates a fresh PostgreSQL from
zero. One migration chain change on this branch: `catalog/0006_npc_definition_origin` and
`npcs/0001_npc_manager_foundation`.

**Merge conflicts.** `git merge-tree` against current heads:

- into `main` (`5222b69`): **clean**. Note that it also brings all of `feature/sound-manager`
  (ADR-048 to ADR-050, still Proposed), an owner-approved dependency (ADR-054 decision C).
- with `feature/sound-manager` (`d5d694a`): clean (already contained).
- with `dev20261103` / `integration/content-dev20261103` (`bf324fa`): **13 conflicting files**:
  `docs/DECISIONS.md`, `docs/IMPLEMENTATION_STATUS.md`, `tasks/TASK_TRACKER.md`,
  `lai/apps/catalog/importer.py`, `lai/apps/catalog/models.py`,
  `lai/apps/core/tests/test_api_conventions.py`, `lai/apps/core/tests/test_django_admin.py`,
  `lai/apps/game_sessions/tests/test_sessions.py`, the castle's `CastleTaleCompanion.tsx`,
  `castleTaleScene.ts`, `castleTaleViewExtension.tsx`, `RegionPlayCompanion.tsx` and
  `useRegionPlay.ts`. Both lines add a `catalog` migration on top of
  `0005_asset_library_media_families` (`0006_npc_definition_origin` here; `0005_content_revisions`
  to `0009_story_catalog` there), so whichever merges second needs a `catalog` merge migration and
  a careful resolution of `NpcDefinition.origin` versus the content-revision changes in
  `catalog/models.py` and `importer.py`. Recommended order is an owner decision; this branch can
  merge to `main` first without conflict.

**Pull request target.** `feature/npc-manager` (the QA branch was cut from it; the diff is the QA
work only). After the owner's acceptance, `feature/npc-manager` merges to `main` cleanly.

## 8a. F-A and F-B resolved (owner decision 2026-11-07, branch `fix/npc-qa-fa-fb`)

The owner accepted both recommendations. Changes, each with regression tests:

- **F-A: "nothing published" is a normal empty answer.** The three runtime reads (catalog, 3D Area,
  Place) answer `200` with `release: 0` and nothing in them when there is no ACTIVE release
  (never published, or retired), instead of `404 no_active_release`. Child and scope checks still
  run first. Clients already treated both the same (legacy Pip and legacy Quill stay); the client
  still accepts the old 404. Interaction, speech and hint routes keep `404 no_active_release`.
  Contract `docs/NPC_MANAGER_CONTRACTS.md` 5.1 updated. Tests: `test_runtime_api.py`
  (`..._are_empty_200`, scoping still applies), seed and acceptance-flow tests, `npc-1-admin`
  (retire answers 200 with `release: 0`).
- **F-B: unprompted lines are a non-modal speech bubble.** A line the child did not ask for
  (spawn greeting, welcome back, reactions) renders as `NpcAmbientLine` (`host.ambient`), not the
  modal panel: a labelled region with one polite live line, no focus move, no key trap, Continue
  (or "Talk to Pip" when the line has choices, which moves the same conversation into the modal
  panel) and Close, 56 px targets, no timer. It sits in a new stage `speechSlot` (top centre,
  below the quest cue and exit link), so it stays in full screen and never covers Hint, Backpack,
  Full screen or the reticle's action prompt. A newer play line replaces an ignored bubble; a
  spawn greeting waits. Only a conversation the child starts is modal (`host.panel`,
  `conversationOpen`). Treasure Cove and Storykeeper's Castle both render it. Accessibility doc
  updated. Tests: host (6 new), `NpcAmbientLine.test.tsx` (5), acceptance test step 7,
  `npc-2-treasure` and `npc-4-a11y` (bubble, axe 0 violations on the bubble, focus untouched).
- **Found while rerunning the full suite:** a best-effort `end` raced the client's next `start`
  for the same NPC (`404 conversation_not_found` or `409 conversation_ended` in the browser
  console). The client no longer sends that `end` when the next conversation is with the same NPC
  (the server keeps one cursor per child and NPC), and the server's `end` is idempotent for a
  conversation that is already over (`200`, `ended: true`); `choose` and `advance` still refuse.
  Tests: `dialogueController.test.ts` (2), `test_dialogue_api.py`
  (`test_end_is_idempotent_for_a_conversation_already_over`).
- **Legacy suites with the managed Pip.** `treasure-rush.spec.ts` and `question-studio.spec.ts`
  assumed the legacy `PipDialog` ("Quest accepted!", "Keep exploring"). Once the NPC specs
  publish release 3 the managed Pip answers instead, so those steps accept either Pip's ending,
  and `closePanel` also closes the managed Pip's conversation that waits behind the finale panel.

**Full browser acceptance after the fixes: PASS, 63 passed, 1 skipped (touch test, desktop
only), 0 failed** (desktop and tablet projects, fresh `lai_e2e` database).

## 9. Remaining owner actions

1. ~~Decide F-A and F-B~~ Decided and fixed (section 8a); the full browser suite passes.
2. Review and merge the QA pull request into `feature/npc-manager`.
3. Physical-device checks: VoiceOver (iPad) and TalkBack (Android tablet) reading the dialog and
   lines once; switch access; touch targets for ages 3 to 4; frame rate and memory on the
   reference tablet (Part B sections 9 and 10).
4. Amplify-backed castle checks not possible locally: tale start/resume, mid-tale tap, gestures,
   completion line, quest log after accepting (B13.4, B13.6 to B13.9).
5. Approve (or not) a live test environment with a spending limit, then live Polly (B7.3) and live
   Bedrock with Guardrail (B8.5).
6. Decide Pip's voice and whether it is a Sprout launch requirement (section 5).
7. Decide O1 (one prompt) and the merge order against `dev20261103` (section 8).
8. Re-export the Mixamo pirate as in section 4 if it is still wanted.
9. Accept or reject in Part B of `docs/NPC_MANAGER_BROWSER_ACCEPTANCE.md`; approve the merge of
   `feature/npc-manager` into `main`.
