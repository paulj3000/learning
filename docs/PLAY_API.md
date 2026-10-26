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

## Step adventures (LAI-0601, LAI-0608)

Ordinary step-based adventures (`repair-the-moonlight-bridge` and the rest of the catalog's
`Adventure` rows) have their own lifecycle routes, separate from region sessions above. They sit
under the adventure because `sessions/{id}/` and `sessions/{id}/{action}/` are the region
contract. Bearer token only: the game runtime's cookie is not accepted. `adventureId` is the
adventure's slug.

| Method | Route (under `/api/v1/children/{childId}/`) | Purpose |
|---|---|---|
| `GET` | `adventures/{adventureId}/availability/` | Can this child start it now, and is there a session to resume |
| `POST` | `adventures/{adventureId}/sessions/` | Start, or resume the ACTIVE session (201 new, 200 resumed) |
| `GET` | `adventures/{adventureId}/sessions/{sessionId}/` | The session and the step to render |
| `POST` | `sessions/{sessionId}/answers/` | Answer the current step (LAI-0601, unchanged) |
| `POST` | `sessions/{sessionId}/hints/` | Ask for the next hint (LAI-0601, unchanged) |
| `POST` | `adventures/{adventureId}/sessions/{sessionId}/complete/` | Finalise a session the engine has brought to its end |

`POST` lifecycle routes take **no body**: anything sent is `400 validation_error`.

### Visibility and availability

An adventure that is unknown, inactive, under an inactive location or world, missing from the
latest content release, or not for the child's age band is `404 not_found` on every route,
exactly like a region or another family's child. A visible adventure is described by
availability:

```json
{"adventureId": "repair-the-moonlight-bridge", "available": true, "reasons": [],
 "status": "IN_PROGRESS", "resumeSessionId": "6f1c..."}
```

- `status` is `AVAILABLE`, `IN_PROGRESS` (an ACTIVE session, `resumeSessionId`) or `COMPLETED`.
- `reasons`, when `available` is `false`:
  - `CHILD_INACTIVE`: the parent turned the profile off.
  - `CONTENT_INCOMPLETE`: the entry step is not in the adventure's latest import.
  - `UNSUPPORTED_STEP_KIND`: a step uses a kind with no reviewed public field list. Today that
    is `matching` and `short-response`, which no exported adventure uses.
  - `PREREQUISITES_NOT_SUPPORTED`: the record names prerequisites. None does today. If one ever
    does, it is refused rather than treated as met.
  - `ACTIVE_SESSION_CONTENT_CHANGED`: the child's ACTIVE session started on content that has
    since changed (see "Content versions").
- Availability is information only. The start route checks the same rules again on its own.
- Rules not applied, because no accepted decision defines them: no extra age gates, no
  learning-path locks, no daily limits.

### Session body

`POST .../sessions/`, `GET .../sessions/{id}/` and `POST .../complete/` all return:

```json
{
  "session": {"id": "6f1c...", "childId": "8d1f...", "adventureSlug": "repair-the-moonlight-bridge",
              "templateVersion": 1, "status": "ACTIVE", "currentStepId": "count-planks",
              "hintLevel": 0, "startedAt": "...", "lastActivityAt": "...", "completedAt": null},
  "step": {"stepId": "count-planks", "type": "NUMBER_INPUT", "objectiveIds": ["count-to-ten"],
           "presentation": {"kind": "number-input", "prompt": "How many planks are missing?"},
           "hintText": null},
  "progress": {"completedStepIds": ["inspect-bridge"]},
  "contentCurrent": true,
  "allowedActions": ["ANSWER", "HINT"],
  "canComplete": false
}
```

- `session` has the same shape the answer and hint routes return (`childId` was added, which
  is an additive change).
- `step` is the current step, or `null` once the session is not ACTIVE or its content changed.
  Its `presentation` is an allow-list per kind:

  | Kind | Fields |
  |---|---|
  | `narrative` | `speaker`, `text`, `aiNarrated` |
  | `choice`, `creative-choice` | `prompt`, `options` (`id`, `label`, `groups`) |
  | `number-input`, `reflection` | `prompt` |
  | `ordering` | `prompt`, `items` (`id`, `label`) |
  | `world-change`, `complete` | `text` |

  The correct value, option, order and accepted options are never sent. Neither are the hint
  ladder, the authored fallback (which can state the answer) or the transitions (which reveal
  the path). `hintText` is only the rung the child has already reached.
- `allowedActions` is one of:
  - `["ANSWER", "HINT"]` on a playable step;
  - `["COMPLETE"]` when the session sits on a COMPLETE step;
  - `[]` otherwise.
- `canComplete` is true only in the `["COMPLETE"]` case.

### Lifecycle

1. **Start or resume.** One ACTIVE session per child and adventure, guaranteed by a database
   constraint. Repeated starts return the same session with 200. Simultaneous starts race on
   that constraint: the loser resumes the winner's session, so exactly one is created. A
   session starts at the adventure's entry step, on its current version and the latest content
   release.
2. **Answer** through `sessions/{id}/answers/`. The Python engine grades the answer, escalates
   hints and picks the next step. The client sends only `{stepId, answer, requestId}`.
   Narrative, reflection and world-change steps take `{"kind": "narrative"}` and the like.
3. **Finish.** An answer that reaches a COMPLETE step, or the reserved `complete` id, completes
   the session in the same transaction. `POST .../complete/` is the explicit finalise:
   - **200**, unchanged, for a session that is already COMPLETED (idempotent: no second
     effect);
   - **200**, completing it, for an ACTIVE session sitting on a COMPLETE step;
   - **409 `session_not_complete`** before the engine's end;
   - **409 `session_not_active`** for any other state.

   The client cannot finish an adventure by asking.
4. **Afterwards**, a completed session stays readable and takes no more answers
   (`409 session_not_active`). Starting the adventure again creates a new session and leaves
   the old one as history. This is the replay rule `resumeOrStartSession` always had.

No route pauses, abandons or restarts a step session: no accepted policy defines those
transitions.

### Content versions

The catalog keeps one version of each adventure, with no snapshots. A session records the
`templateVersion` and content release it started on and never switches. If the adventure's
version changes, or its current step was not in the latest import:
- reads return `contentCurrent: false`, `step: null` and `allowedActions: []`;
- answers are `409 content_version_changed`;
- a new start is `409 content_version_changed` rather than a silent restart.

Such a session cannot continue until a restart or abandon policy is decided (open).

### Error codes

| Status | `code` | Where |
|---|---|---|
| 404 | `not_found` | Unknown, invisible or retired adventure; another child's or family's session; a region session; a session of another adventure |
| 409 | `adventure_unavailable` | Start refused; `GET availability/` says why |
| 409 | `child_inactive` | Start refused for a profile that is turned off |
| 409 | `content_version_changed` | Start, or an answer, on a session whose content changed |
| 409 | `session_not_complete` | Finalise before the engine's end |
| 409 | `session_not_active` | Answer or finalise on an ended session |
| 400 | `validation_error` | A body sent to a no-body route |

### Not part of completion yet

Completing records only the session's status and time. Mastery is recorded per resolved step by
the answers themselves (LAI-0603, see "Mastery"), never by completion. Rewards (LAI-0604),
quest, NPC and world-change records (LAI-0605) and story artifacts (LAI-0607) are not written by
step sessions. World-change steps advance the session, but the island change itself is
LAI-0605. The hook for all of them is `services.finalize_session` and the completing branch of
`services.submit_answer`, both in one transaction.

## Mastery (LAI-0603)

Mastery is computed only on the server, from answers the engine has graded. There is no write
route: `POST`, `PUT`, `PATCH` and `DELETE` on the mastery routes are `405`.

### When evidence is recorded

An answer to `sessions/{sessionId}/answers/` that **resolves** its step (`action: "ADVANCE"`)
records one `SkillEvidence` row for each of the step's objectives, then moves the child's
`SkillProgress` row for each. This happens in the answer's own transaction, under the session's
row lock. The rule is the one the Amplify client applied (`recordEvidenceForStep` and
`upsertSkillProgress`):

- `result` is the engine's correctness and `supportLevel` the server's hint level.
- A `RETRY` is not evidence. Only the step's final outcome counts, so a step solved after two
  hints is one supported success, not three exposures.
- Guided completion, where the ladder tops out at 5, is a `correct` result with support 5: a
  supported success, never an independent one.
- Ungraded steps record nothing: narrative, reflection, world-change, complete, and
  creative-choice (all `not_applicable`).
- An objective code the catalog does not hold is skipped, and a code listed twice on one step
  counts once. A step with no objectives records nothing.
- Completing a session (`complete/`, or an answer that reaches the end) records no mastery of
  its own. Finishing is not evidence.

### Counters and status

The Mastery Engine rules are ported from TypeScript and pinned by the golden vectors in
`tests/golden/mastery.json`. Their thresholds are the TypeScript ones, documented there as
"initial deterministic thresholds, not a pedagogically validated model". The counters move as
follows:

- every piece of evidence is one more exposure;
- `correct` with support 0 is an independent success and extends the streak;
- `correct` with support above 0 is a supported success;
- anything else only breaks the streak.

`status`, in order of precedence:

| `status` | When |
|---|---|
| `INTRODUCED` | No independent success yet |
| `MASTERED` | Streak of at least 3 and at least 5 independent successes |
| `PROFICIENT` | At least 3 independent successes, and at least 60% of exposures independent |
| `DEVELOPING` | Otherwise |

`errorPattern`, in order of precedence:

| `errorPattern` | When |
|---|---|
| `STALLED` | At least 3 exposures and no independent success |
| `NEEDS_SUPPORT` | At least 2 exposures and supported successes at least half of them |
| `INCONSISTENT` | Both kinds of success |
| `NONE` | Otherwise |

Review decay applies at read time only: `PROFICIENT` and `MASTERED` show one level lower after
21 days without practice. The stored row is never rewritten by time.

### `GET mastery/` and `GET mastery/{objectiveId}/`

```json
{"objectives": [{
  "objectiveId": "addition-within-ten", "title": "Addition within ten", "domain": "numeracy",
  "hasEvidence": true, "status": "PROFICIENT", "rawStatus": "MASTERED", "errorPattern": "NONE",
  "exposureCount": 6, "independentSuccessCount": 5, "supportedSuccessCount": 1,
  "consecutiveIndependentCorrect": 3, "lastPracticedAt": "2026-09-20T10:00:00+00:00"}]}
```

- **The list** holds every objective the child has evidence for, most recently practised
  first.
- **One objective** returns the same entry. For a catalog objective with no evidence yet it
  returns `hasEvidence: false` with a `status`, `rawStatus` and `errorPattern` of `null`, and
  zero counts. That is "no evidence", not a low score. The server cannot say `LOCKED` or
  `INTRODUCED` without the curriculum's prerequisite rule, which it does not evaluate yet.
- **An unknown objective** is `404`.
- **Status fields:** `status` is after review decay; `rawStatus` is as stored.
- **Failed attempts:** there is no separate incorrect count. It is `exposureCount` minus both
  success counts, and that difference includes partial answers.
- **What is never returned:** answer content and individual evidence rows.

`GET progress/` gains `"mastery": [{"objectiveId", "status"}]`. This is the status-only summary
(the Mastery Engine's `MasterySummary`), and it is an additive field.

### Treasure Rush

Treasure Rush challenge answers already write a `SkillEvidence` row per attempt
(`challenge_attempt`), retries included, but they do not move `SkillProgress`. Per-attempt
evidence is not the step rule (one piece of evidence per resolved step). Feeding it into the
same counters would count differently, so that waits for a decision (LAI-0610). The reward
behaviour is unchanged.

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
