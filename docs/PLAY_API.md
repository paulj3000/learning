# Play API (TR-5)

> Since POST-MERGE-03 (ADR-033) these routes are served by `apps/game_sessions/play_views.py`
> over `play.py` on the canonical models; the contract below is unchanged. Quests are catalog
> rows (a quest is offered when `active`), and catalog NPCs carry no model id of their own, so an
> NPC's `assetId` is its placement's.

The Django API a Three.js region uses to load, play, and save. Treasure Rush is its first user;
nothing in it is specific to Treasure Rush except that `chests` is the only interactive
challenge object so far. Implemented in `lai/apps/game_sessions/` (`urls.py`, `views.py`,
`serializers.py`, `play_state.py`), over the TR-4 services in `services.py`.

This is the contract TR-6 (the React client) is written against.

## Conventions

- Base path `/api/v1/children/{childId}/`. `childId` is a `ChildProfile` UUID the signed-in
  parent owns. Every route is child-scoped (LAI-0403): another family's child, a sibling's
  session or attempt, and an id that does not exist all give the same `404 not_found`.
- `Authorization: Bearer <Cognito access token>` on every request; missing or invalid gives
  `401 not_authenticated`.
- JSON in and out. Response keys are camelCase. Timestamps are ISO 8601 UTC.
- Request bodies are **closed**: an undeclared field is `400 validation_error`. A client cannot
  send `correct`, `reward`, `worldChange`, or a status; the server decides all of them.
- Errors use the project envelope (docs/ARCHITECTURE.md, "Django API conventions"):

  ```json
  {"error": {"code": "chest_already_open", "message": "This chest is already open."},
   "request_id": "d78969a05e7e4d1781bce29f5da105a9"}
  ```

- Content is published content only. Assets are ids from the bundled manifest (ADR-030),
  never URLs; an empty `assetId` means "draw a placeholder of `placeholder` size" (TR-7a).
- No response ever contains a challenge's expected answer, its seed, or admin-only fields.
- Child-facing copy in responses (titles, labels, reward messages, quest objective labels) is
  authored content. Feedback is a code (`CORRECT`, `TRY_AGAIN`) the client turns into
  localizable, readable-aloud copy.

### Error codes specific to play

| Status | Code | When |
|---|---|---|
| 404 | `not_found` | Unknown, unpublished, or not this child's region, session, chest, attempt, or quest |
| 409 | `content_unavailable` | The content exists but cannot be used now (retired region on resume, no published challenge for this age band, inactive child) |
| 409 | `session_not_open` | The session is completed, abandoned, or safety-stopped |
| 409 | `invalid_transition` | A lifecycle action not allowed from the session's status, or an unknown action |
| 409 | `chest_already_open` | This child already opened the chest |
| 409 | `attempt_already_answered` | A replayed or duplicate answer; nothing is recorded or granted again |
| 409 | `quest_unavailable` | Not for this age band, or prerequisites do not hold |
| 400 | `validation_error` | Bad body; an answer that is not a possible answer has `details.answer[0].code = "invalid_answer"` |

## Endpoints

### `GET regions/{regionId}/`: region bootstrap

Everything needed to build the region for this child, and the child's state in it.

```json
{
  "region": {"regionId": "treasure-rush-cove", "title": "Treasure Cove",
             "locationSlug": "pirate-builder-bay", "version": 1,
             "scene": {"bounds": {"halfExtentX": 18, "halfExtentZ": 18, "wallThickness": 1},
                       "environment": {"backgroundColor": 10475760},
                       "copy": {"loading": "Sailing to Treasure Cove.", "...": "..."}}},
  "spawn": {"checkpointId": "cove-landing", "label": "the landing", "x": 0.0, "z": 10.0, "yaw": 0.0},
  "npcs": [{"entityId": "cove-pip", "npcId": "pirate-pip", "displayName": "Pirate Pip",
            "label": "Pirate Pip", "x": 3.0, "z": 6.0, "elevation": 0.0, "rotationY": 0.0,
            "scale": 1.0, "assetId": "npc-pip", "interactionId": "meet-pirate-pip",
            "placeholder": {"width": 1.0, "height": 1.6, "depth": 1.0}}],
  "objects": [],
  "chests": [{"entityId": "cove-chest", "label": "Treasure chest", "x": 0.0, "z": -6.0,
              "elevation": 0.0, "rotationY": 0.0, "scale": 1.0, "assetId": "treasure-chest",
              "placeholder": {"width": 1.2, "height": 0.9, "depth": 0.8},
              "openClip": "Open", "isOpen": false, "challengeAvailable": true}],
  "quests": [{"questId": "treasure-rush-cove", "title": "Treasure Rush",
              "summary": "Find the treasure chest in the cove and open it with a number puzzle.",
              "giverNpcId": "pirate-pip", "status": "AVAILABLE", "currentStageId": null,
              "completedAt": null,
              "stages": [{"id": "open-the-chest", "title": "Open the treasure chest", "complete": false,
                          "objectives": [{"id": "treasure-cove-open-chest",
                                          "label": "Open the treasure chest in the cove",
                                          "optional": false, "complete": false}]}]}],
  "session": null,
  "worldChanges": []
}
```

- `quests` lists the region's offered quests (`WorldRegion.offered_quests`) the child has
  started, plus published ones they may accept now (`status: "AVAILABLE"`). Ineligible quests
  are omitted.
- `chests[].isOpen` comes from the child's world changes; `challengeAvailable` is false when no
  published challenge exists for the child's age band (show the chest closed and unusable).
- `session` is the child's open session in this region, if any.
- `spawn` is the region's default spawn point (approved decision: spawn is Django data).

### `POST regions/{regionId}/session/`: start or resume

Empty body. `201` with a new session, `200` with the open one (a paused session is resumed).
Never starts a quest.

```json
{"sessionId": "6f1c…", "kind": "REGION", "regionId": "treasure-rush-cove", "templateSlug": "",
 "locationSlug": "pirate-builder-bay", "status": "ACTIVE",
 "startedAt": "2026-10-24T18:02:11.120Z", "lastActivityAt": "2026-10-24T18:02:11.120Z",
 "completedAt": null}
```

### `GET sessions/{sessionId}/` and `POST sessions/{sessionId}/{action}/`: lifecycle

`action` is `pause`, `resume`, `complete`, or `abandon`; empty body; returns the session.

| From | pause | resume | complete | abandon |
|---|---|---|---|---|
| ACTIVE | PAUSED | no-op | COMPLETED | ABANDONED |
| PAUSED | no-op | ACTIVE | COMPLETED | ABANDONED |
| COMPLETED, ABANDONED, SAFETY_STOPPED | 409 | 409 | no-op if same, else 409 | no-op if same, else 409 |

`resume` also refuses (`409 content_unavailable`) when the region has since been unpublished.
The calm stop (CLAUDE.md section 11) should `complete` the session.

### `POST quests/{questId}/accept/`: accept a quest

Empty body. The child accepts a quest an NPC offered. `201` accepted, `200` already accepted or
finished. Draft, retired, or unknown quests are `404`; wrong age band or unmet prerequisites are
`409 quest_unavailable`. Response: one quest entry, as in the bootstrap, with `status: "ACTIVE"`.

### `POST sessions/{sessionId}/chests/{entityId}/challenge/`: get the chest's challenge

Empty body. `201` with a new challenge, `200` with the one already outstanding for this chest
(a retried request never reshuffles the numbers). The server chooses the challenge from the
chest's spec for the child's age band.

```json
{"attemptId": "b0e9…", "attemptNumber": 1, "sessionId": "6f1c…", "targetEntityId": "cove-chest",
 "ageBand": "PATHFINDER", "issuedAt": "2026-10-24T18:02:30.004Z",
 "challenge": {"skillId": "addition-within-ten", "operation": "ADD", "operands": [2, 3],
               "responseMode": "CHOICE", "choices": [3, 4, 5, 6]}}
```

`operation` is `COUNT` (operands: `[n]`, "how many?"), `ADD`, or `SUBTRACT`. `responseMode` is
`CHOICE` (show `choices` as large buttons) or `NUMBER_INPUT` (`choices` is empty; accept 0 to
100). The client writes the question from these values with its own localizable strings.
Errors: `409 chest_already_open`, `409 session_not_open`, `409 content_unavailable`, `404`.

### `POST attempts/{attemptId}/answer/`: answer it

```json
{"answer": 5, "hintLevel": 1, "durationMs": 8400}
```

`answer` must be a JSON integer (not `"5"`, `5.0`, or `true`) and, for `CHOICE`, one of the
offered choices. `hintLevel` (0 to 10, default 0) is how many hints the child used; it is
recorded as support, never as a penalty. `durationMs` is optional.

```json
{"attemptId": "b0e9…", "correct": true, "feedback": "CORRECT", "canRetry": false,
 "chestOpened": true,
 "newItems": [{"itemId": "golden-doubloon", "displayName": "Golden Doubloon",
               "description": "A shiny gold coin from the treasure chest in the cove.",
               "category": "KEEPSAKE", "assetId": ""}],
 "rewardMessage": "You opened the chest and found a Golden Doubloon!",
 "questUpdates": [{"questId": "treasure-rush-cove", "status": "COMPLETED",
                   "currentStageId": "open-the-chest", "justCompleted": true,
                   "newlyCompletedObjectiveIds": ["treasure-cove-open-chest"]}]}
```

A wrong answer is `200` with `correct: false`, `feedback: "TRY_AGAIN"`, `canRetry: true`, and
nothing opened or granted; ask for the challenge again to get attempt 2. Grading, evidence, the
world change, the reward, and quest progress happen in one transaction on the server. A second
submission of the same attempt is `409 attempt_already_answered` and changes nothing; the
client should re-read the bootstrap or progress instead of retrying. `newItems` lists only items
the child did not own before.

**Retired content.** A challenge issued before an administrator retires the region or the spec
can still be answered while its session is open, and opens the chest: the child is not punished
for an edit made mid-play. Nothing new starts in retired content (no new session, no resume, no
new challenge). If the chest itself is deleted, the answer is `409 content_unavailable` and
nothing is recorded.

### `GET progress/`: the child's progress

```json
{"sessions": [{"sessionId": "6f1c…", "status": "ACTIVE", "...": "..."}],
 "worldChanges": [{"locationSlug": "pirate-builder-bay", "changeType": "UNLOCK",
                   "changeKey": "TREASURE_RUSH_COVE_CHEST_OPENED",
                   "payload": {"regionId": "treasure-rush-cove", "entityId": "cove-chest"},
                   "createdAt": "2026-10-24T18:02:41.310Z"}],
 "openedChests": [{"regionId": "treasure-rush-cove", "entityId": "cove-chest"}],
 "inventory": [{"item": {"itemId": "golden-doubloon", "...": "..."},
                "grantedAt": "2026-10-24T18:02:41.310Z"}],
 "quests": [{"questId": "treasure-rush-cove", "status": "COMPLETED", "...": "..."}],
 "practice": [{"objectiveCode": "addition-within-ten", "attempts": 2, "correct": 1}]}
```

`sessions` is the 20 most recent. `practice` is counts per learning objective, for gameplay
pacing; it is not a mastery level or a label (docs/DATA_MODEL.md, "SkillProgress").

## 3D Area puzzles, authored content and the catalog (ADR-047, LAI-0812, Firepeak)

Additive changes to the region bootstrap. A client written before them ignores the new keys,
and a server from before them sends none (the client treats them as empty).

| Key | Shape | Notes |
|---|---|---|
| `puzzles[]` | `{puzzleId, kind, title, entityIds[], solved, locked, failedAttempts, parameters}` | Published puzzles that have parameters for the child's age band. `parameters` is the kind's own shape, for this band only. `locked` means an earlier stage's change key is missing. |
| `npcs[].dialogue[]` | `{nodeId, text, followUpOnly, choices[{choiceId, label, nextNodeId}]}` | Authored nodes whose conditions the server can prove now (`ALWAYS`, `WORLD_CHANGE`, `QUEST_COMPLETED`). Others are left out, never guessed. |
| `catalog` | `{worldSlug, assets[{assetId, kind, clips[], deliverable}]}` | What the layout names, so the client validates a served 3D Area against Django. `deliverable` is false until a version is published or a bundled file exists. |
| `region.title`, `region.scene.copy`, `region.scene.environment` | as before | Read from the version this visit pinned (LAI-0813). |

Items (`progress.inventory[].item`, reward `newItems[]`) gain `setId` and `journal`:
- `journal` is `{subject, questId, illustrationAssetId}`, or null.
- These are the Discovery Journal entries (FP-10).

### `POST sessions/{sessionId}/puzzles/{puzzleId}/solve/`: one attempt at a puzzle

- **Body:** `{"submission": {...}}`, and nothing else.
- **Submission shape by kind:**

  | Kind | Submission |
  |---|---|
  | `OBSERVE_FEATURES` | `{"observed": [featureId...]}` |
  | `PLACE_PLATFORMS` | `{"placements": {slotId: stoneId}}` |
  | `VALVE_SEQUENCE` | `{"sequence": [valveId...]}` |
  | `COLLECT_OBJECT`, `RETURN_TO_NPC` | `{}` |

- **Response:** `200` with
  `{attemptId, correct, feedback, solvedNow, alreadySolved, failedAttempts, newItems, rewardMessage, questUpdates}`.
- **Grading:** the server grades against the puzzle version the session pinned. A correct
  answer records the puzzle's world change (`PUZZLE_SOLVED`), grants its reward rule once, and
  advances active quests, all in one transaction.
- **Replays:** an already-solved puzzle answers `alreadySolved: true` and grants nothing.
- **Errors:**
  - `400 invalid_submission`: a malformed submission; nothing is recorded.
  - `404`: an unknown or unpublished puzzle, or another child's session.
  - `409 puzzle_locked`: an earlier stage is not done yet.
  - `409 session_not_open`.
  - `409 content_unavailable`: no parameters for this age band, or the 3D Area is not published.
- **Game runtime cookie:** accepted for the cookie's own region only (ADR-036).

## Pip's Missing Treasure (TR-14): locks, pickups, puzzles, talking

All additive: a client from before TR-14 keeps working, and the TypeScript reader defaults
every new field when an older server leaves it out.

**Region bootstrap, chests.** Each chest also carries `presentation` (`CHEST`, `HIDDEN`: not
drawn until it may be opened, or `PUZZLE`: answered by touching objects, no chest drawn),
`sortOrder` (the encounter order; the list comes sorted by it), `locked` and `lockReason`
(`null`, `PROGRESS`: an earlier encounter first, or `ITEM`: a key the child lacks),
`requiredItemId`, `answerEntityIds` (a puzzle's answer objects, one per choice, in choice order)
and `clue` (Pip's line that sends the child there; child-facing).

**Region bootstrap, objects.** Each object also carries `pickup` (a collectible picked up
through the API) and `collected` (this child has picked it up).

**Challenges for a locked chest** are `409 chest_locked`: nothing is issued or recorded. A
puzzle's challenge is an ordinary `CHOICE` challenge whose choices go on its answer objects,
graded by `POST attempts/{attemptId}/answer/` like any other.

**Answer outcome.** Adds `completionRewards`: `[{ruleId, items, message}]`, the rewards for a
quest this answer completed (reward rules triggered by `QUEST_COMPLETED`), only those granted now.

### `POST sessions/{sessionId}/pickups/{entityId}/`: pick something up

Empty body. Records the placement's pickup world change and fires its reward rule (the item),
once each, then walks the child's quests forward. `201` picked up now, `200` already picked up
(nothing new: `pickedUp: false`, `newItems: []`). A placement that is not a pickup, or another
child's session, is `404`; a closed session is `409 session_not_open`.

```json
{"entityId": "cove-brass-key", "pickedUp": true, "collected": true,
 "newItems": [{"itemId": "old-brass-key", "category": "QUEST_ITEM", "...": "..."}],
 "rewardMessage": "You found an Old Brass Key! It is in your backpack.",
 "questUpdates": [], "completionRewards": []}
```

### `POST sessions/{sessionId}/npcs/{entityId}/talk/`: the child talked to an NPC

Empty body; always `200`. For every active quest whose *current* stage has a `TALK_TO`
objective naming this NPC, sets that memory flag on the child's `NpcRelationship`, walks the
quests forward, and fires the rewards of any quest just completed. Talking too early changes
nothing (`{"flagsSet": [], "questUpdates": [], "completionRewards": []}`), and so does talking
again after the quest is done. Not an NPC here: `404`.

```json
{"flagsSet": ["cove-treasure-returned"],
 "questUpdates": [{"questId": "pips-missing-treasure", "status": "COMPLETED",
                   "currentStageId": "return-to-pip", "justCompleted": true,
                   "newlyCompletedObjectiveIds": ["cove-return-to-pip"]}],
 "completionRewards": [{"ruleId": "reward-pips-missing-treasure-complete",
                        "items": [{"itemId": "treasure-cove-explorer", "...": "..."}],
                        "message": "You are a Treasure Cove Explorer!"}]}
```

**Accepting a quest** now also walks it forward at once, so a chest opened before accepting
counts immediately.

## Lookout Point and the replay activity (TR-17, TR-20)

Additive again. A chest's `presentation` may now also be **`REPLAY`** (the Lookout spyglass). A
replay is an ordinary entry in the bootstrap's `chests`, with these differences, all decided by
the server:

- It is **never open**: `isOpen` stays `false` and it is not counted in `chestsTotal` or
  `chestsOpened` (the region list, the native API and the quest all keep reporting the real
  chests).
- It is **locked behind an earlier encounter** (`required_world_change_key`, here the quest's
  completion, `TREASURE_COVE_QUEST_COMPLETE`): `lockReason: "PROGRESS"` and `409 chest_locked`
  on `POST .../chests/{entityId}/challenge/` until the child has it. The unlock persists, like
  any world change, and is the same one `worldChanges` already reports, which is how the client
  knows to lay the bridge.
- **`POST .../chests/{entityId}/challenge/` issues a new challenge every time** once an attempt has
  been answered (there is no `chest_already_open`). Asking while one is outstanding returns that
  one (`200`), as for any chest.
- **`POST attempts/{attemptId}/answer/`** grades as usual and records the attempt and its skill
  evidence, then stops: a right answer returns `chestOpened: false`, `newItems: []`,
  `rewardMessage: null`, `questUpdates: []` and `completionRewards: []`. Nothing permanent is
  written, so repeating the activity cannot award anything twice. A wrong answer is the usual
  `correct: false, canRetry: true`; a replayed answer is `409 attempt_already_answered`.

A client built before TR-20 sees an unknown `presentation`; the TypeScript reader of this
repository accepts `REPLAY` and refuses nothing else.

## Islands, Places and Adventure launch points (LAI-0806, ADR-041)

**Region bootstrap: `launchPoints` (additive).** The objects in this 3D Area that start one of its
Place's Adventures, already filtered for the child: the launch point is published, its Adventure
is active, belongs to this Place, and is for the child's age band. An older client ignores the
key; a newer client reads a missing key as `[]`.

```json
"launchPoints": [{
  "launchId": "signpost-repair-the-moonlight-bridge",
  "entityId": "cove-bridge-signpost",
  "objectKind": "SIGN",
  "label": "Help Pip repair the Moonlight Bridge",
  "prompt": "The sign points to the broken bridge.",
  "adventure": {"adventureId": "repair-the-moonlight-bridge",
                "title": "Repair the Moonlight Bridge", "placeSlug": "pirate-builder-bay"}
}]
```

`objectKind` is one of `NPC`, `CHEST`, `DOOR`, `SIGN` or `OTHER`. It is presentation only. The
object's position is that of the placement named by `entityId` (in `npcs` or `objects`).

**`POST /children/{id}/regions/{regionId}/launch-points/{launchId}/start/`**, body `{}` (closed).
It requires a bearer token; the game runtime cookie gets 401. The server checks every condition
above again, then starts or resumes the child's one ACTIVE session for that Adventure.

```json
201 (started) or 200 (resumed)
{"launchId": "...", "regionId": "treasure-rush-cove", "adventureId": "repair-the-moonlight-bridge",
 "placeSlug": "pirate-builder-bay",
 "session": {"id": "...", "adventureSlug": "...", "templateVersion": 1, "status": "ACTIVE",
             "currentStepId": "...", "hintLevel": 0, "startedAt": "...",
             "lastActivityAt": "...", "completedAt": null},
 "returnTo": {"regionId": "treasure-rush-cove"}}
```

| Status | Meaning |
|---|---|
| 404 `not_found` | The 3D Area is not visible to the child, or the launch point is unknown, unpublished or in another 3D Area |
| 409 `content_unavailable` | The Adventure is inactive, in another Place, or not for this child's age band |

`session` uses the LAI-0601 shape (`views.session_state`).

**`GET /children/{id}/islands/`.** Island > Place > 3D Area for this child.
- Islands appear when active and for the child's age band; their Places appear when active.
- `area` is the Place's published 3D Area (a region entry, as in `GET regions/`), or `null`.
  With `null` the Place is still usable through its Adventures.
- `autoSelectIslandId` is set when exactly one Island is available.

## Published content reads and the step runner (LAI-0503, LAI-0816, ADR-047 K)

All routes are under `/api/v1/children/{id}/`, child-scoped (another family's child is a 404),
bearer only. Reads are `GET`, bounded (200 entries), and serve only **published, active content
for the child's age band**; an unknown, unpublished, inactive or other-band record is a 404 with
no way to tell which. Drafts, submitted and returned versions are never visible. Every entry
carries `"revision": {"id": "<uuid>", "number": n}`, the published version it came from.

| Route | Returns |
|---|---|
| `content/adventures/` | `{"adventures": [{slug, title, locationSlug, ageBands, skillDomain, revision}]}` |
| `content/adventures/{slug}/` | the above plus `entryStepId` and `steps`: each `{id, type, objectiveIds, presentation, hasHints, revision}` with **no answers, no hint text, no transitions** (an ordering's items are shuffled the same way for everyone and never in the answer order; a matching splits into `left` and `right`) |
| `content/quests/`, `content/quests/{id}/` | quests for the band; detail adds `entryStageId`, `stages`, `adventureSlugs` |
| `content/items/` | non-hidden items (`id, displayName, description, category, rarity, setId`) |
| `content/reward-rules/` | rules whose granted items are all visible: `id, message, itemIds, triggerType` |
| `content/learning-objectives/` | `code, domain, title` |
| `content/stories/`, `content/stories/{slug}/` | stories for the band; detail has chapters and scenes without the completion world change |
| `content/npcs/`, `content/npcs/{id}/` | NPCs; detail adds `dialogue`: the nodes this child's band hears now (conditions evaluated for the child, authored text only) |

**Step runner.** Django grades; the client sends what the child did.

- `POST content/adventures/{slug}/start/`, body `{}`. Starts (201) or resumes (200) the child's
  one ACTIVE session for a published adventure, pinned to the published versions. The response is
  the step view below with `"created": true|false`.
- `GET sessions/{sessionId}/step/` returns the step view, to resume after a disconnection:

```json
{"session": {"id": "...", "adventureSlug": "...", "status": "ACTIVE", "currentStepId": "count",
             "hintLevel": 0, "...": "..."},
 "step": {"id": "count", "type": "NUMBER_INPUT", "objectiveIds": ["count-10"],
          "presentation": {"kind": "number-input", "prompt": "How many planks?"},
          "hasHints": true},
 "stepRevision": {"id": "...", "number": 1}, "adventureRevision": {"id": "...", "number": 3},
 "doneStepIds": [], "hintLevel": 0}
```

  A finished session returns its authored closing step (`presentation.kind` is `complete`).
  A publication during a visit changes nothing here: the step comes from the pinned version.
- `POST sessions/{id}/answers/` and `.../hints/` are unchanged, and the answer response gains
  `"worldChangeKeys": []` (the consequence of a WORLD_CHANGE step the child continued past) and
  `"completion": null | {"rewards": [{ruleId, message, granted, newItemIds}], "questsCompleted": []}`.
  In the answer's own transaction Django records skill evidence per graded objective, the world
  change once, and on completion grants the configured `ADVENTURE_COMPLETED` reward rule once per
  child and moves active quests forward. A replayed `requestId` records and grants nothing.

## Storykeeper Castle room discovery (SC-R03-06)

Which rooms of the castle a child has been in, so the castle map can show what is explored. It is
not a play route: the castle's layout is a TypeScript manifest (ADR-033), and this endpoint only
records and returns a durable, child-scoped fact. Implemented in
`lai/apps/game_sessions/castle_views.py` over `lai/apps/regions/castle_rooms.py`.

A discovery is an ordinary `WorldChange` (`locationSlug` `storykeeper-castle`, `changeType`
`ROOM_DISCOVERED`, `changeKey` `castle-room:<roomId>`), written through the existing idempotent
`record_world_change`. There is **no new model**, and nothing here grants a reward or advances a
quest.

### `GET castle/rooms/`: the rooms this child has discovered

```json
{"rooms": ["entry-hall", "story-hall"]}
```

Room ids in the castle's own order, whatever order they were found. A secret room is never listed
unless the child has made the discovery it depends on.

### `POST castle/rooms/`: record that the child has been in a room

Body (closed; an undeclared field is `400 validation_error`): `{"roomId": "story-hall"}`.
`201 {"roomId": "story-hall", "newlyDiscovered": true}` the first time, `200` with
`"newlyDiscovered": false` after. Idempotent and safe under concurrency.

The server decides which ids it accepts (`castle_rooms.json`, shared with the client's
`CASTLE_ROOM_IDS`, and a test fails if the two differ). An unknown room is `404 not_found`.

**A secret stays secret.** A secret room (today only `secret-chamber`) is recorded only once the
discovery it names (`castle-tapestry-stair`) is on the child's world state. Before that, asking to
record it gives **exactly** the `404 not_found` that an unknown room gives, so the endpoint cannot be
used to learn that a secret exists. The client treats any refusal as "not saved", never as an error
a child sees.

Child-scoped and bearer-only like every route here: another family's child and an unknown child
give the identical `404`, and a parent or child id in the body or query is ignored.

## The Great Storybook (SC-R04-02)

The child's Great Storybook as the server derives it from its own records. Implemented in
`lai/apps/game_sessions/castle_views.py` over `lai/apps/regions/great_storybook.py` and
`great_storybook_pages.json`.

**A page is derived, never stored.** Each page names a record the castle's existing,
server-validated content already writes (a world change a finished adventure or story records, or
the nook discovery), so there is no page table: a page is back exactly when its record exists, it
cannot be recovered twice, and a different challenge's record cannot restore it.

### `GET castle/storybook/`: this child's book

Read-only: no INSERT, UPDATE or DELETE runs, asking twice is asking once, and nothing is granted,
recorded or changed. The age band is the child's own, from their profile, and is never read from the
request.

```json
{"band": "PATHFINDER",
 "pages": [{"id": "page-first-story", "title": "The First Story", "required": true,
            "restored": false, "roomId": "story-hall",
            "text": "Tell a story with Keeper Quill in the Story Hall."}],
 "restoredRequired": 0, "totalRequired": 1, "restoredBonus": 0, "complete": false,
 "quest": {"questId": "restore-the-great-storybook-pathfinders", "status": "NOT_STARTED"}}
```

`text` is the page's own words: what it says once it is back, or where to look while it is missing
(never how to solve it). Each band's book is whole when its **required** pages are back. The hidden
nook page is a bonus in every band and is **listed only once it is restored**: a slot for a secret the
child has not found would be a signpost, so nothing in this response names it before then. The quest
`status` is `NOT_STARTED`, `ACTIVE` or `COMPLETED`.

`great_storybook_pages.json` mirrors the client's `STORYBOOK_PAGES` and quest ids; a Vitest test fails
if they differ.

## Discoveries (SC-R04-00)

The server's record of which secrets a child has found, and the authority for whether one opens.
Implemented in `lai/apps/game_sessions/discovery_views.py` over `lai/apps/progression/discoveries.py`.

Before this, Django had a `WorldState.discovered_objects` column and nothing that wrote it, so in
Django mode a discovery lived only in the Amplify client's row and the server could prove nothing
(the quest engine's own docstring: discoveries "evaluate as not yet complete, so the server never
credits progress it cannot prove"). The Secret Chamber's access and the Great Storybook's page
recovery both rest on this record.

**No new model.** The record is the existing `WorldState.discovered_objects`. Definitions are the
digest-verified content export's `discoveries` collection, read with `read_export`. A discovery's
world change goes through the existing idempotent `record_world_change`, and its rewards through the
existing `grant_reward_rule` for each `DISCOVERY` rule, one fire per rule.

### `GET discoveries/`: what this child has found

`{"discoveries": ["castle-tapestry-stair"]}`: ids in the content's own order; an id the export does
not know is never listed.

### `POST discoveries/`: find a secret

Body (closed): `{"discoveryId": "castle-tapestry-stair"}`.

| Result | Body | Meaning |
| --- | --- | --- |
| `201` | `{"discoveryId", "status": "FOUND_NOW", "rewardMessages": [...], "newItemIds": [...]}` | First find. The record, the world change and the rewards were written. |
| `200` | `{"discoveryId", "status": "ALREADY_FOUND"}` | A replay. Nothing was written or granted. |
| `200` | `{"discoveryId", "status": "LOCKED", "message": "..."}` | The requirements do not hold. Nothing was written. The message is the authored locked line. |
| `404` | `not_found` | An id the export does not know. |

The requirements the server evaluates are the ones the export's schema allows (`ALWAYS`,
`WORLD_CHANGE_PRESENT`, `ITEM_OWNED`, `DISCOVERY_PRESENT`); any other type is treated as not met, so
the server never opens a secret it cannot prove. The child's `WorldState` row is locked for the write:
of two simultaneous finds exactly one is `FOUND_NOW`, and the world change and reward are written
once (tested with four parallel transactions).

Child-scoped and bearer-only like every route here. The client treats the server as the authority in
Django mode and falls back to the Amplify path when the API is off or fails, so a child is never
blocked by it (`react/src/features/discovery/api.ts`).

## Next learning activity (AMP-05)

### `GET next-learning-activity/`: the Director's suggestions

Read-only. Up to three adventures, best first, with adult-facing reasons:
`{"suggestions": [{"adventureSlug", "title", "score", "reasons": [{"kind", "skillId", "status",
"weight", "storyId", "penalty"}]}], "hasPersonalizedSignal": bool}`. `kind` is one of
`PRACTISES_SKILL`, `CONTINUES_STORY`, `ALREADY_COMPLETED`, `PLAYED_RECENTLY`,
`NO_SKILLS_NEEDED`; unused fields are null. Only adventures for the child's band, at an
island the child can reach (or a story-only place), are candidates. Rules:
`lai/apps/education/director.py`. A child surface shows the order, never a reason.

## Household co-op (AMP-05, ADR-006)

The child in the path is the one acting. A session another family hosts, or one this child is
not in, is `404 not_found`. Session shape: `{"id", "templateSlug", "templateVersion",
"participantChildProfileIds", "status", "sharedState": {"slots": {stepId: childId},
"presence": [childId]}, "startedAt", "lastActivityAt", "completedAt"}`.

| Route | Body | Answer |
|---|---|---|
| `POST coop-sessions/` | `{"adventureSlug", "partnerChildId"}` | `201` session; `400 partner_invalid` or `adventure_invalid` |
| `GET coop-sessions/{coopId}/` | | session; clients poll this (2 s) instead of a subscription |
| `POST coop-sessions/{coopId}/slots/` | `{"slotKey"}` (a co-op-eligible step id) | `{"outcome": "claimed" \| "already_held" \| "held_by_partner", "session"}`; `400 slot_invalid`; `409 coop_session_not_active` |
| `POST coop-sessions/{coopId}/presence/` | `{"present": bool}` | session |
| `POST coop-sessions/{coopId}/complete/` | | session (idempotent); `409 coop_session_not_active` if abandoned |

## Per-child state outside region play (AMP-03)

The routes that replaced Amplify Data for the classic adventures and the per-child state writers
(`react/src/features/{adventures,story,quests,rewards,npc,discovery,mastery,island,catalog}/api.ts`).
All are under `children/{childId}/`, child-scoped and bearer-only (`ChildScopedAPIView`): another
family's child, or a nested record of another child, is `404 not_found`, and nothing is written.
Request bodies are closed. The React side calls them through `react/src/api/djangoClient.ts`.
Every model is a canonical one (ADR-033): no new table except two columns on `ChildProfile`.

| Route | App | What it does |
| --- | --- | --- |
| `GET sessions/` | game_sessions | The child's step-adventure sessions, newest activity first |
| `GET`, `POST adventures/{slug}/session/` | game_sessions | The ACTIVE session or `null`; start (201) or resume (200). `409 content_unavailable` when the adventure, its Place or its Island is out of play |
| `GET adventure-actions/` | game_sessions | The child's recorded attempts (the parent dashboard's independent-vs-hinted report) |
| `GET availability/` | game_sessions | Release flags only: `{"places": [{slug, active}], "adventures": [{slug, placeSlug, active}]}` (ADR-031); inactive rows are listed, not hidden |
| `GET`, `POST world-changes/` | progression | Every world change; record one, once (201 new, 200 already there). Keys are format-checked; a `sourceSessionId` is the child's own session or a `quest:`/`discovery:`/`story:`/`world:` label; at most 1000 per child |
| `GET`, `PATCH`, `DELETE world-state/` | progression | Discoveries (read only; written by `discoveries/`), characters met (an NPC the catalog has), the last checkpoint (`<region>:<spot>`) |
| `GET stories/`, `POST stories/{slug}/start/`, `.../flags/`, `.../chapters/{id}/complete/`, `.../reflections/` | progression | Story progress from the export's story definitions: entry chapter, authored flag values only, the current chapter only and only after its embedded adventures are completed, the completion world change, reflection evidence once per story and objective |
| `GET`, `DELETE npcs/`, `POST npcs/{npcId}/dialogue/` | progression | NPC relationships; a shown dialogue node's authored flags and first-time points, the level derived from points |
| `GET skill-progress/` | education | Mastery rows, derived on the server from graded evidence. There is no write |
| `GET`, `POST story-artifacts/`, `DELETE story-artifacts/{id}/` | education | Saved stories: one per session, steps of that session's adventure only, text at most 600 characters that passes the AI output boundary checks, title from the catalog |
| `GET`, `DELETE rewards/` | inventory | `{"ownedItemIds", "grantedRuleIds"}`. There is no grant route: rewards are granted by the server code that decided they were earned |
| `GET`, `DELETE quests/`, `PUT quests/{slug}/` | quests | Quest states; a validated save of the client-projected state (`save_quest_state`). On completion the server applies the quest's own stage and completion world changes, NPC memory flags and `QUEST_COMPLETED` rewards, once |
| `GET`, `PUT companion/` | users | The companion choice (`CHATTY_PARROT`); the display name is authored on the server |

Two behaviours moved to the server with this:

- Answering a WORLD_CHANGE step (`{"kind": "world-change"}` on `sessions/{id}/answers/`) records the
  step's authored world change, once. Reaching a COMPLETE step completes the session in the same
  request, so the client no longer writes a session, an attempt, evidence or mastery at all.
- `DELETE me/` (users) deletes the parent account: each child exactly as `DELETE children/{id}/`
  does, then the account. It needs a recent sign-in. `503 account_deletion_incomplete` keeps the
  account when photo storage could not be cleaned up (safe to retry); `409
  staff_account_not_deletable` refuses a Django Admin staff account. The client deletes the
  Cognito user afterwards (`react/src/features/child-profile/deletion.ts`).

Tests: `lai/apps/game_sessions/tests/test_classic_adventure_api.py`,
`lai/apps/progression/tests/test_child_state_api.py`,
`lai/apps/education/tests/test_story_artifacts_api.py`,
`lai/apps/quests/tests/test_quest_state_api.py`, `lai/apps/users/tests/test_account_deletion.py`.

## Reuse by later regions

Nothing here branches on Treasure Rush: a later region needs a `WorldRegion` with its
placements, spawn points, offered quests, and (if it has puzzles) chests with challenge specs.
A new kind of interactive challenge object would add one issue route beside `chests/` and reuse
`attempts/{id}/answer/` and the lifecycle routes unchanged.

## Frontend client (TR-6)

`react/src/api/play/playApi.ts` has one typed function per route above;
`react/src/api/play/types.ts` mirrors the responses field for field. Change them together with
`lai/apps/game_sessions/serializers.py`; the parsers reject a response that drifts
(`ApiError` kind `invalid_response`, with the path).

```ts
const api = playApiFor(childId);             // childId from /island/:childId
const region = await api.getRegion('treasure-rush-cove');
const { value: session } = await api.startSession('treasure-rush-cove');
const { value: issued } = await api.requestChestChallenge(session.sessionId, 'cove-chest');
const outcome = await api.submitAnswer(issued.attemptId, { answer: 5, hintLevel: 1 });
```

In React, use `useRegionPlay(childId, regionId, { onUnauthenticated })` rather than the API
directly: it owns loading, the in-flight action, stale-reply protection, and re-reading after an
answer or conflict. `toRegionSceneModel(state.bootstrap)` gives the scene plain entities by id.

**Configuration.** `VITE_BACKEND=django` enables the client; without it every call fails with
kind `disabled`. `VITE_DJANGO_API_BASE` is empty for same-origin (deployed) or an `http://`
origin in `vite dev`.

**Error handling.** Every failure is an `ApiError`:

| kind | Status | Client behaviour |
|---|---|---|
| `invalid_request` | 400 | A client bug or an impossible answer; `details` has per-field codes |
| `unauthenticated` | 401 twice | Retried once with a refreshed token first; then `onUnauthenticated` (wire to `AuthContext.refresh()`) |
| `forbidden` | 403 | Shown as an error; no sign-out |
| `not_found` | 404 | Unknown, retired, or another family's content; show "not here right now" |
| `conflict` | 409 | `code` is a `PlayConflictCode`; stale-view codes trigger a re-read |
| `unavailable` | 503 | Retryable; never a sign-out (ADR-024) |
| `server` | other 5xx | Retryable |
| `network` | none | Retryable |
| `invalid_response` | any | The response broke this contract |
| `aborted` | none | A newer request replaced it; never shown |
| `disabled` | none | This build has no Django API |
