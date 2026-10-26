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

**Transport.** Since LAI-0501B, `playApiFor` uses the shared Django client
(`react/src/api/backend.ts`): the same bearer-token handling, one refresh on 401, and a
single `POST me/` retry on `403 account_not_provisioned`. Routes and parsers are unchanged.

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
