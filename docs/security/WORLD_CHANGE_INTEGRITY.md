# World change integrity

Scope: every path that writes a `WorldChange` or awards something from a client-submitted
completion assertion, audited on branch `feature/storykeeper-castle-completion` (see
`docs/regions/prep/storybook_integrity_prep.md` section B). Authorization stays as in CLAUDE.md
section 10: a parent reaches only their own children, deny by default.

## Why it matters

A Great Storybook page, a quest `BUILD` objective and a discovery requirement all match a world
change on its **key**. If a client could write any key, it could restore a page, finish a quest and
collect the seal without playing. The unique constraint is `(child, location_slug, change_key)`,
so the same key at another location is a second row that satisfied the key-only matchers.

## Findings and fixes

| # | Path | Finding | Fix |
|---|------|---------|-----|
| 1 | `POST children/{id}/world-changes/` (`progression/views.py`) | Any location, type and key matching a regex was accepted. `sourceSessionId` only had to be one of the child's own sessions (any template, any status) or a label such as `quest:x`. A client could forge `FIRST_STORY_TOLD` or `STUDIO_PAGE_MENDED`. | `progression/client_changes.py` plus the registry in `progression/protected_changes.py`. A protected key is accepted only with proof of play (below). |
| 2 | `PUT children/{id}/quests/{slug}/` (`quests/views.py`) | The client sent `completedStageIds` and `completedObjectiveIds`. The server only checked the shape, then recorded the stage and completion world changes, NPC memory flags and `QUEST_COMPLETED` rewards. A forged completion of `the-quiet-places` or a Great Storybook quest paid out the reward and `GREAT_STORYBOOK_RESTORED`. | `quests.services.claim_is_proven`: every newly claimed stage needs all its required, server-provable objectives complete (BUILD, FIND, CRAFT, COLLECT, SOLVE, TALK_TO, DISCOVER) and every newly claimed provable objective must hold. A stage's own authored changes count for later stages in the same save. Otherwise 409 and nothing is written. |
| 3 | Great Storybook page match (`regions/great_storybook.py`) | Matched on key only; `source.locationSlug` was never compared. | Pages match `(location, key)` through `world_change_pairs`; a legacy row with a blank location still counts. |
| 4 | `world_change_keys` (shared by quests, discoveries, the learning director, the island home) | Dropped the location, so a forged copy of a protected key at another location satisfied quest and discovery requirements. | `world_change_keys` now excludes a protected key recorded at a location other than its own (`is_misplaced`). The director and island home use it instead of raw key queries. Unprotected keys and blank-location legacy rows behave as before. |
| 5 | Cap and insert race in the POST | The 1000-row cap was checked, then the row written, without a lock. | The whole write runs in `transaction.atomic()` after locking the child row; the unique constraint still makes a replay return the one row (`created=False`). |
| 6 | Step adventure runner (`game_sessions/services.py`) | Reviewed. Sessions complete only through the graded answers route; no client view calls `complete_session`. `_apply_world_change_step`, rewards and quest refresh run in the answer transaction and are idempotent. | No change. |
| 7 | Region play (`play.py`: chests, pickups, puzzles), castle rooms, discoveries, story chapters | Reviewed. All server-graded, locked and idempotent. Castle secret rooms need the recorded discovery. Story completion needs every embedded adventure completed. | No change. Their keys are now protected against the generic POST (castle rooms, quest and discovery keys). |
| 8 | Story artifacts (`education/views.py`) | Saves narration for the child's own session; grants nothing. It does not require the session to be completed. | No change (no reward or world change). Listed as a low risk. |

## Protected keys

Derived in `protected_changes.registry()` from trusted data, never hand-listed:

- every `WORLD_CHANGE` source key of the Great Storybook pages (`great_storybook_pages.json`);
- every key the quests, stories and discoveries of the verified content export record, which
  includes `GREAT_STORYBOOK_RESTORED*` (and any `GREAT_STORYBOOK_RESTORED...` name by prefix);
- the castle rooms (`castle-room:<id>`, `castle_rooms.json`).

Each carries its location, change type and producers: an adventure template slug with the step that
writes the change, a story slug, or a server-only label.

## Accepting a protected key from the client

| Producer | Required proof |
|----------|----------------|
| Adventure (page keys) | `sourceSessionId` is the child's own COMPLETED `AdventureSession` of a registered producer template, whose action trail answered or left the producing step. |
| Story (`THE_CASTLES_SECRET_DOOR_COMPLETE`) | `sourceSessionId` is the child's own completed `StoryProgress` id for a producing story. |
| Quest, discovery, castle room | Never; Django writes them. |

Responses: a missing, labelled or wrong-location source is 400 `protected_change_key`; an unknown
session or another child's or family's session is 404 (identical to unknown); the wrong template is
400 `wrong_producer`; a session not completed is 400 `session_not_completed`; a completed session
that never reached the step is 400 `step_not_reached`. The stored type is the registered one, and
the row's source is the verified session. Rows written by server paths (empty source, `quest:`
labels) and existing legacy rows are untouched and keep working. Unprotected keys behave as before.

The payload for legitimate play is unchanged: adventures, stories, quests and discoveries never
called the generic POST, so no client change was needed.

## Residual risks (not fixed here)

- **Adventure keys that are not page keys** (for example `BRIDGE_REPAIRED`,
  `CLOCKWORK_LIGHTHOUSE_FIXED`) stay forgeable by the generic POST because the island's Three.js
  runtime posts them legitimately. The quest PUT proof counts them. Moving those interactions to a
  server-validated action is the follow-up; until then they cannot restore a page.
- **Quest objectives the server cannot evaluate** (EXPLORE, HELP_NPC, DELIVER, relationship and skill
  goals) are still taken from the client PUT, as before. `helping-at-the-cove` has an EXPLORE stage.
  The server `refresh_quest` path never credits them.
- **Branch reachability** in the quest PUT is not checked; each claimed stage must be proven on its
  own objectives.
- **Client POST label sources** `exploration:`, `travel:` are not in the accepted label regex, so those
  posts are refused with `invalid_source` (pre-existing; failures are swallowed by the callers).
  Not changed here.
- **The client's local Storybook fallback** (`great-storybook/pages.ts isPageRestored`) still
  matches on key only. It is display only (the server read is authoritative and a forged
  protected key can no longer be written), so a pre-existing misplaced row could at most show a
  page offline that the server does not count.
- The registry reads the digest-verified content export file. After administrators edit content in
  Django (ADR-047) a new producer must also appear in the export to be registered.

## Tests

`lai/apps/progression/tests/test_protected_world_changes.py` (forged, wrong template, incomplete, not
reached, cross-child and cross-family, legacy rows, location match, idempotency),
`test_protected_world_changes_concurrency.py` (one row, one creation under four parallel writes),
`test_protected_changes_content.py` (every page source has a producer, keys unique across producers),
and `lai/apps/quests/tests/test_quest_state_api.py` (forged quest completion refused).
`react/src/features/island-map/three/runtime/clientWorldChangeKeys.test.ts` checks the other
direction: no key the island runtime posts (collectible pick-ups, tide trials) is protected, so
the server never refuses a change a child really made.

Merge note: `great_storybook.progress` reads `(location, key)` pairs, so the edition-1 seal check
(`GREAT_STORYBOOK_RESTORED`, SC-R04-08) tests the pairs through `is_misplaced`. Without that,
`test_great_storybook_editions.py` fails twice (a child who finished edition 1 lost
RESTORED_MORE_PAGES).
