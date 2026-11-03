# Storykeeper Castle Reboot: SC-R01 and SC-R02 Verification Audit

**Date:** 2026-11-03. **Branch:** `adventures/storybook` (tracking `origin/adventures/storybook`,
head `96836df` at the start of this audit). **Method:** read the code, the tests and `git log`, then
ran the castle test subset. Nothing here is taken from an earlier completion note.

**No browser, Playwright or screenshot work was run for this audit.** Browser acceptance stays with
the owner. Test results below are Vitest under jsdom, which is not a browser.

## 1. Headline

| Question | Answer |
| --- | --- |
| Was SC-R01 delivered? | Yes. Five tasks, five documents or tests, all present in Git. |
| Was SC-R02 delivered? | **No. Only SC-R02-01 (the reusable visual system) is delivered.** The tracker already showed SC-R02-02 to 09 unchecked. No room has been re-dressed: the castle manifest declares no `materials`, `surfaces` or `effects`. |
| Is ADR-028 accepted? | **No. It is Proposed.** SC-R01-03 recorded a recommendation only. |
| Any duplicate infrastructure? | None found: no new Phaser file, no castle sound engine, no castle asset manager, no second content backend (diff of `main..HEAD`). |

So Part A found one real gap: **the per-room visual work was never done**. It is repaired by the
SC-R02 tasks that follow this audit, not by editing this report.

## 2. Task numbering

The reboot roadmap and the tracker number the SC-R02 work differently from the owner's brief.
This audit uses the tracker's ids and maps the brief onto them.

| Brief id | Brief title | Tracker id |
| --- | --- | --- |
| SC-R02-01 | Reusable Three.js environment components | SC-R02-01 |
| SC-R02-02 | Great Library | SC-R02-02 |
| SC-R02-03 | Entry Hall | SC-R02-03 |
| SC-R02-04 | Story Hall | SC-R02-04a |
| SC-R02-05 | Character Gallery | SC-R02-04b |
| SC-R02-06 | Costume Room | SC-R02-04c |
| SC-R02-07 | East Corridor | SC-R02-04f |
| SC-R02-08 | Setting Tower | SC-R02-04d |
| SC-R02-09 | Illustration Studio | SC-R02-04e |
| SC-R02-10 | Castle-wide consistency and regression | SC-R02-05 to 09 |

## 3. SC-R01 verification

Status key: **Verified** means the deliverable exists and its checkable claims hold.

| Task | Reported | Verified | Evidence | Gaps |
| --- | --- | --- | --- | --- |
| SC-R01-01 audit | DONE | **Verified** | `storykeeper_castle_implementation_audit.md` (356 lines); commits `229c359`, `d7389ab` | None. Findings AUD-1 and AUD-2 are real and AUD-1 was fixed in SC-R01-04 |
| SC-R01-02 roadmap | DONE | **Verified** | `STORYKEEPER_CASTLE_REBOOT_ROADMAP.md`: all eight rooms in the section 2.1 table (`entry-hall`, `story-hall`, `character-gallery`, `costume-room`, `east-corridor`, `setting-tower`, `illustration-studio`, `great-library`), matching `ROOMS` in `storykeeperCastleRegion.ts:104` | The roadmap **merges** the Observatory into the Setting Tower and the Trophy Room into the Costume Room, and marks the Secret Chamber as needing approval. See section 6 |
| SC-R01-03 ADR-028 | DONE | **Verified as a recommendation; ADR-028 not accepted** | `DECISIONS.md` row ADR-028 is `Proposed`; `storykeeper_castle_art_direction.md` | Owner acceptance outstanding. Recorded honestly in the tracker already |
| SC-R01-04 contracts | DONE | **Verified** | `storykeeper_castle_contracts.md` (C-1 to C-11); `castleRebootContracts.test.ts` 13 tests pass; `castleTaleClaims.ts` fixes AUD-1 | The Great Storybook runtime does not exist yet. The contracts describe it |
| SC-R01-05 acceptance | DONE | **Verified** | `storykeeper_castle_acceptance.md` (criteria A-1 to A-21, V-1 to V-12) | None |

### Authority and duplication checks

| Check | Result | Evidence |
| --- | --- | --- |
| Django authoritative for content, progress, quests, published assets | Holds. No change to that on this branch | Branch diff touches no backend. Quests reach Django through `content/exported/quests.json` and `manage.py load_content` (CLAUDE.md section 20) |
| Staff authoring and asset management stay in Django Admin | Holds | No admin or asset-management code added |
| No castle-specific asset manager | Holds | `git diff --name-only main..HEAD` has no asset-manager file |
| No castle sound engine | Holds | No sound or audio file added |
| No new content backend | Holds | Same |
| No new Phaser code | Holds | `git diff main..HEAD -U0 -- react/src` has no added `phaser` reference |
| Existing game logic preserved | Holds | Castle interactions, bindings and parity suites are intact (section 4.3) |

## 4. SC-R02 verification

**Status key:** *Implemented and unit-tested*, *Implemented, awaiting owner visual acceptance*,
*Partial*, *Blocked by external assets*, *Not implemented*.

### 4.1 SC-R02-01: reusable visual system

**Verified status: Implemented and unit-tested; awaiting owner visual acceptance.**

| Requirement | Evidence |
| --- | --- |
| Shared material presets, one material and texture per preset | `runtime/visual/materialLibrary.ts` |
| Deterministic procedural textures, eight patterns | `surfacePatterns.ts`, `surfacePatterns.test.ts` |
| World-scaled UVs, one draw call per surface | `surfaceGeometry.ts`, `surfaceGeometry.test.ts` |
| LOW, MEDIUM, HIGH tiers, light budget by `priority`, motes cap | `renderQuality.ts`, `renderQuality.test.ts` |
| Reduced motion | `motes.ts`, `motes.test.ts`; the view passes the preference |
| Unknown or unpaintable preset falls back to a flat colour | `materialLibrary.test.ts` (fallback cases) |
| Disposal | `visualSystem.engine.test.ts` |
| Manifest fields validated | `validateLocationManifest.ts` lines 437 to 506 |
| Gameplay unchanged by tier | `visualSystem.engine.test.ts` |

Test result in this audit: `runtime/visual`, `storykeeperCastleRegion.test.ts`,
`castleRebootContracts.test.ts` and `manifests/storykeeperCastle.test.ts` together: **9 files, 118
tests passed**.

### 4.2 Per-room status

The check applied to every room: (1) scene components exist, (2) materials and textures applied,
(3) interactions still connected, (4) navigation and collision intact, (5) cleanup, (6) assets
resolve through the existing system, (7) fallbacks, (8) non-browser tests.

| Room | Tracker id | Reported | Verified | What exists | What is missing |
| --- | --- | --- | --- | --- | --- |
| Great Library | SC-R02-02 | unchecked | **Not implemented** | Pre-reboot kit: bookshelves, reading tables, clue props. Interactions, colliders, zones and tests all intact | No textured floor, walls or ceiling; no columns, chairs, candles; no Storybook dais; no motes |
| Entry Hall | SC-R02-03 | unchecked | **Not implemented** | Kit floor, ceiling and wall panels, castle doors, carpet | No inlay, banners, columns, mural |
| Story Hall | SC-R02-04a | unchecked | **Not implemented** | Hearth light, lectern, binding table, three tapestries, cushions | No wood floor, plaster and wainscot, hearth surround |
| Character Gallery | SC-R02-04b | unchecked | **Not implemented** | Portrait frames and portraits | No planks, green plaster, plinths |
| Costume Room | SC-R02-04c | unchecked | **Not implemented** | Floor, walls. `COSTUME_RACK_SPOTS` authored but **never placed** | Carpet, plum walls, racks, mirror |
| East Corridor | SC-R02-04f | unchecked | **Not implemented** | Floor and walls | Runner, sconces, map wall |
| Setting Tower | SC-R02-04d | unchecked | **Not implemented** | Three window frames and state-variant views | Stone floor, cool walls, instruments |
| Illustration Studio | SC-R02-04e | unchecked | **Not implemented** | Easel and canvas | Pale planks, cream plaster, paint table |
| Feedback, moods, budgets, asset manifest, hardening, final verification | SC-R02-05 to 09 | unchecked | **Not implemented** | The engine primitives from 01 | All of it |

Checks 3 and 4 hold for every room today because no room geometry changed. Checks 1, 2 and 5 to 8
cannot hold for per-room work that does not exist.

### 4.3 Regression behaviours (preserved, with the test that proves it)

| Behaviour | Test |
| --- | --- |
| Portrait-based hero selection | `storykeeperCastleParity.test.tsx` "answers choose-hero by looking at a portrait"; `castleChoiceBindings.test.ts` |
| Window-based setting selection | parity "answers choose-setting by standing at a window" |
| Story plate ordering | parity "answers order-the-story by seating three plates"; `castleBindingLectern.test.ts` |
| Completed-book shelf | parity "puts the book on the shelf"; engine "builds the castle already changed" |
| Tapestry secret nook | parity "finds the nook"; "never advertises the nook"; region test keeps the secret clear |
| Stars and clues | `storykeeperCastleRegion.test.ts` "authors exactly nine counting stars"; `castleChoiceBindings.test.ts` clue ordering |
| Pattern lock | parity "answers order-the-keys by seating three rods" |
| Secret bookshelf door | parity "offers the arc at the door", "shows the way through once the arc is already finished" |
| Sprouts picture story | parity "answers a Sprouts choice with their own adventure's option id" |
| Session-time calm stop | parity "has Quill look toward the nook once the time has passed" |
| Equivalent card choices | `castleHudEquivalence.test.tsx` |
| Single authoritative chapter progress record (ADR-027) | `StoryChapterRunner.test.tsx`; parity "creates no story progress for a child who only walks through" |

These were verified by reading the test names and bodies. The parity, engine and bindings suites
were **not** re-run in full in this audit (see section 5).

Gap noted: `castleLibraryClues.ts` and `castlePatternLock.ts` have no test file of their own. The
behaviour is covered through the parity suite, so this is a coverage-depth note, not a defect.

## 5. Test evidence for this audit

| Command | Result |
| --- | --- |
| `vitest run runtime/visual storykeeperCastleRegion castleRebootContracts manifests/storykeeperCastle` (two workers) | 9 files, 118 tests passed |
| `vitest run src/features/island-map/three` (default workers) | **Did not complete.** First run: 6 files failed with `Timeout waiting for worker to respond`, 259 of 268 tests passed. Second run (3 workers) was killed at the 900 s limit with no summary. The machine has 8 GB of RAM and `/home` was briefly 100% full during this session. Treated as an environmental blocker, not a test failure. Larger suites are run in smaller batches |

## 6. Decisions the brief and the roadmap disagree on

| Topic | Reboot roadmap (SC-R01-02) | This brief | Handling |
| --- | --- | --- | --- |
| Observatory | Merged into the Setting Tower | New Observatory, "distinct from the Setting Tower **unless the reconciled architecture explicitly merges them**" | The architecture explicitly merges them. Built as the Setting Tower's observatory function |
| Trophy Room | Merged into the Costume Room | New Trophy Room | The brief is the later owner instruction: a new `trophy-room` is added, and the Costume Room keeps its role |
| Secret Chamber | New space, **APPROVAL needed** | Requested explicitly | Treated as the approval for the space only. It is recorded as owner-requested here |
| New Pathfinder mission (roadmap SC-R04-05) | **APPROVAL needed** | "Use existing curriculum objectives" | No new educational content is authored. Age adaptation reuses existing adventures and objectives |

## 7. Outstanding items from Part A

- Owner: accept or amend ADR-028.
- Owner: browser acceptance of SC-R02-01 (textures look right, no shimmer, LOW tier on a weak device).
- Missing assets: none referenced as existing that do not. Commissioned Quill, Ember and Storybook
  art are unfunded, and the kit-wall height decision is open (roadmap section 7).
- Repair commits: see the tracker; SC-R02-02 to 09 follow this audit.
