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

## Reward rules on world changes (SC-R07-01)

`WORLD_CHANGE` reward rules are paid on the server only by `inventory.services.grant_world_change_rewards`,
which two Django paths call after they record the change themselves: the graded adventure runner's
WORLD_CHANGE step (`game_sessions.services._apply_world_change_step`) and a story's completion
(`progression.stories.complete_chapter`). The helper pays only a **protected** key recorded at its
registered location, so a key the client could write, or a protected key at another place, pays
nothing. The generic `POST world-changes/` never calls it. Each rule fires once per child
(`GrantedRule`). The castle keepsake rules (`reward-three-clues-lens` on
`SECRET_DOOR_CLUES_COLLECTED`, `reward-secret-door-key` on `THE_CASTLES_SECRET_DOOR_COMPLETE`) are
the first such rules; `reward-bridge-world-change` (`BRIDGE_REPAIRED`, unprotected) is still not paid
by the server, as before. A child who recorded a keepsake key before this change receives the item the
next time the server path runs for them (a replayed adventure step); a finished story is not
replayed, so earlier finishers are covered by the owner-run backfill below.
Tests: `lai/apps/inventory/tests/test_castle_keepsakes.py`.

## Castle keepsake backfill (WS-E, owner-approved, NOT yet run on real data)

`python manage.py backfill_castle_keepsakes` (dry run, the default) and `... --apply` (code:
`lai/apps/inventory/backfill.py`). It grants through the existing `grant_reward_rule`, so
`GrantedRule` and the inventory unique constraints keep it idempotent. Output is counts only per
rule (eligible, granted, already had); no names or ids.

Evidence (read only from rows Django writes; a world-change row alone is never evidence):

| Rule | Evidence |
|------|----------|
| `reward-secret-door-key` | A completed `StoryProgress` of a producing story (`the-castles-secret-door`). A `THE_CASTLES_SECRET_DOOR_COMPLETE` row at any location, blank or right, does not qualify without it, so a forged or misplaced copy earns nothing. A story label naming another child's progress earns nothing. |
| `reward-three-clues-lens` | The child's COMPLETED adventure session of the producer template whose action trail reached the producing step (the proof the client POST demands). That session is recorded as the grant source. |
| `reward-painted-words-brush` | The child's COMPLETED adventure session of `the-painted-words`. |

Guarantees: one transaction per child under the child row lock; a child with a `GrantedRule` for the
rule, or who already owns every item it gives (from any path), is skipped; strictly per child
(`for_child` queries); never deletes or edits any record. Tests:
`inventory/tests/test_castle_keepsake_backfill.py`, `progression/tests/test_world_change_audit.py`,
`progression/tests/test_castle_keepsake_backfill_concurrency.py`.

## Endpoint audit: child-scoped writes (`api/v1/children/<id>/...`, WS-E)

Every route sits behind `ChildScopedAPIView` (the parent's own child, otherwise 404 identical to an
unknown id). `test_world_change_audit.py::test_every_child_write_route_has_been_audited` freezes the
list of write routes, so a new one fails until it is reviewed and added here. None lets a child
write an arbitrary protected key, award a rule, or complete a session.

| Group | Routes (method) | Protection |
|-------|-----------------|------------|
| Profile and settings | `/` PATCH DELETE, `photo/`, `companion/`, `audio/settings/`, `audio/speech/`, `ai/*`, `rewards/` DELETE, `quests/` DELETE, `npc-memory/` DELETE, `story-artifacts/` | No progression grant. Deletes only remove the child's own rows. Story artifacts store narration only. |
| Writing Room story (SC-final-B) | `story-artifacts/written/` POST | Only the child's own ACTIVE session of one of the three `castle-writing-room` templates for the child's band (else 404). Sprout and Pathfinder text is composed server-side from authored option labels; an Explorer paragraph passes `screen_untrusted_text` and the unkind-word screen or nothing is stored. Completes the session through `complete_session` (status only: no reward rule, world change, quest or mastery). One artifact per session (unique constraint). |
| Generic world change | `world-changes/` POST | `client_changes.record_client_world_change`: protected keys need proof of play, registered location and type; never pays rewards. |
| World state | `world-state/` PATCH DELETE | Only a known NPC id and a checkpoint id; no world change. |
| Adventure runner | `adventures/<slug>/session/`, `content/adventures/<slug>/start/`, `sessions/<id>/answers/`, `hints/` POST | Server-graded; completion, WORLD_CHANGE steps and rewards run only in the answer transaction. |
| Region play | `regions/<id>/session/`, `sessions/<id>/<action>/`, `chests/.../challenge/`, `attempts/<id>/answer/`, `puzzles/.../solve/`, `pickups/...`, `npcs/.../talk/`, launch points, `game-launches/` | Region sessions only (the `complete` action refuses an adventure session). Chests, puzzles and pickups are server-graded, locked and idempotent. |
| Castle | `castle/rooms/` POST, `castle/director/` POST | A room needs its recorded discovery; the Director writes only a display counter. |
| Discoveries | `discoveries/` POST | Requirements recomputed from the child's own rows (misplaced keys excluded). |
| Stories | `stories/<slug>/start`, `flags`, `chapters/<id>/complete`, `reflections` | Choices must be offered; a chapter needs its embedded adventures completed; story completion records the key and pays its rule on the server. |
| Quests | `quests/<slug>/accept`, `quests/<slug>/` PUT | PUT proves every claimed stage (`claim_is_proven`); otherwise 409. |
| Co-op | `coop-sessions/*` POST | Own children only; `complete` only changes the co-op session status, no world change or reward. |
| NPC dialogue | `npc-memory/<id>/dialogue/`, region and place `interactions/*` | Authored nodes; flags set by the server. |

Audit result: no new hole was found. Replay, wrong producer, wrong location, another family's child
and concurrent writes are each covered by a test.

Frozen write-route list (method and path after `children/<id>`):

- `DELETE /`
- `DELETE /ai/history/`
- `DELETE /npc-memory/`
- `DELETE /photo/`
- `DELETE /quests/`
- `DELETE /rewards/`
- `DELETE /story-artifacts/<uuid:artifact_id>/`
- `DELETE /world-state/`
- `PATCH /`
- `PATCH /audio/settings/`
- `PATCH /world-state/`
- `POST /adventures/<slug:adventure_slug>/session/`
- `POST /ai/companion-turns/`
- `POST /ai/tutor-turns/`
- `POST /attempts/<uuid:attempt_id>/answer/`
- `POST /audio/speech/`
- `POST /castle/director/`
- `POST /castle/rooms/`
- `POST /content/adventures/<slug:slug>/start/`
- `POST /coop-sessions/`
- `POST /coop-sessions/<uuid:coop_id>/complete/`
- `POST /coop-sessions/<uuid:coop_id>/presence/`
- `POST /coop-sessions/<uuid:coop_id>/slots/`
- `POST /discoveries/`
- `POST /game-launches/`
- `POST /npc-memory/<slug:npc_id>/dialogue/`
- `POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/`
- `POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/advance/`
- `POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/choose/`
- `POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/end/`
- `POST /places/<slug:place_slug>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/hint/`
- `POST /quests/<slug:quest_id>/accept/`
- `POST /regions/<slug:region_id>/launch-points/<slug:launch_id>/start/`
- `POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/`
- `POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/advance/`
- `POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/choose/`
- `POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/end/`
- `POST /regions/<slug:region_id>/npcs/<slug:npc_id>/interactions/<uuid:conversation_id>/hint/`
- `POST /regions/<slug:region_id>/session/`
- `POST /sessions/<uuid:session_id>/<slug:action>/`
- `POST /sessions/<uuid:session_id>/answers/`
- `POST /sessions/<uuid:session_id>/chests/<slug:entity_id>/challenge/`
- `POST /sessions/<uuid:session_id>/hints/`
- `POST /sessions/<uuid:session_id>/npcs/<slug:entity_id>/talk/`
- `POST /sessions/<uuid:session_id>/pickups/<slug:entity_id>/`
- `POST /sessions/<uuid:session_id>/puzzles/<slug:puzzle_id>/solve/`
- `POST /stories/<slug:story_slug>/chapters/<slug:chapter_id>/complete/`
- `POST /stories/<slug:story_slug>/flags/`
- `POST /stories/<slug:story_slug>/reflections/`
- `POST /stories/<slug:story_slug>/start/`
- `POST /story-artifacts/`
- `POST /story-artifacts/written/`
- `POST /world-changes/`
- `PUT /companion/`
- `PUT /photo/`
- `PUT /quests/<slug:quest_slug>/`


## Residual risks (not fixed here)

- **Backfill is code only.** It has not been run on any real database; the owner runs the dry run first,
  reads the counts, then `--apply`. A key row written by a legacy import without a completed
  `StoryProgress` earns no key; list such children with the dry run (eligible vs already had) and decide
  separately.
- **A forged `StoryProgress` is not possible through the API** (no route sets `completed_at` without the
  chapter gate), but a database import could write one. The backfill trusts imported `StoryProgress`.

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
