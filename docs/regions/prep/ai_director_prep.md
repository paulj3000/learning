# SC-R08 event catalog and SC-R09 Castle Director: implementation contract (prep)

Finding: `react/src/features/director` is an adventure ranker (`rankAdventures`, `DirectorContext`, `SelectionRecord`; Django port `lai/apps/education/director.py`). It is not an event selector. Reuse its style (pure, closed-union reasons, no free text, penalties not exclusions) but build a separate castle module. Do not extend the ranker or its golden file (`tests/golden/director-content.json`, which covers `reachableAdventures`).

## 1. Event catalog (SC-R08-01)
Authority: TS content is the initial export (`manage.py load_content`), then Django is authoritative via versioned revisions (ADR-033 as amended by ADR-047). Suggested files: `react/src/features/great-storybook/castleEvents.ts`, export entry `castleEvents` in `content/exported/`, Django `lai/apps/regions/castle_events.py` (model on `castle_rooms.py`) with admin. Layout stays seed-authored.

```
CastleEvent {
  id            string  // stable kebab id, e.g. "ember-flies-past-tower"
  status        "DRAFT" | "PUBLISHED" | "RETIRED"   // only PUBLISHED is eligible
  version       int
  room          roomId | "ANY"          // existing castle room ids
  bands         AgeBand[]               // SPROUT | PATHFINDER | EXPLORER
  requires      Condition[]             // reuse npc.condition_met types: QUEST_COMPLETED, WORLD_CHANGE, MEMORY_FLAG, RELATIONSHIP_AT_LEAST
  repeat        { maxShows: int|null, minVisitGap: int }  // visit based, see section 6
  weight        int 1..5                // deterministic tiebreak only
  npcId         "keeper-quill" | "ember-dragon" | null
  lines         { SPROUT, PATHFINDER, EXPLORER: string[] }  // authored; length capped by MAX_SPOKEN_LENGTH_BY_AGE_BAND
  visual        { kind: ambient cue id }   // typed event the engine plays; never a reward
  fallback      boolean                 // exactly one event per room has fallback=true (quiet ambient)
  secret        boolean                 // hidden from Things to do lists
}
```
Rules: events carry no reward, WorldChange, or progress write. Any NPC memory flag must be in `reachableMemoryFlags` (contracts C-7). Content test: every room and band has at least one fallback event.

## 2. Eligibility (pure, deterministic)
`eligibleEvents(catalog, state) -> CastleEvent[]` (TS) with a Python port `eligible_events` and a golden vector file `tests/golden/castle-events.json` (same digest convention as director-content).
State (no identifiers, no text): `ageBand`, `roomId`, `conditions` snapshot (completed quest ids, world change keys, memory flags, relationship level), `shownCounts: {eventId: n}`, `lastShownVisit: {eventId: visitIndex}`, `currentVisitIndex`.
Filter, in order: status PUBLISHED; band match; room match or ANY; all `requires` pass (`condition_met`; unknown type = false); `shownCounts < maxShows`; `currentVisitIndex - lastShownVisit >= minVisitGap`. Sort by `weight` desc then `id` asc. `defaultEvent` = first eligible by that order, else the room's fallback event (never empty). Same input gives same output; no clock, no randomness.

## 3. Selection contract (SC-R09-01)
Endpoint (new route in `lai/apps/ai`, name e.g. `generateCastleDirectorChoice`, add `RouteName.CASTLE_DIRECTOR`): `POST /api/v1/children/<id>/castle/director/`.
Request (client sends only):
```
{ "roomId": "story-hall", "visitId": "<uuid of open region session>" }
```
The server recomputes everything (age band, conditions, counts, visit index) from the child's rows (as `npc.child_npc_state` does) and builds the eligible set itself. The client never supplies candidates.
Model request (`TurnSpec`, `route="castle"`): trusted context = `{ageBand, roomId, candidates:[{id, tag}]}` where `tag` is an authored one-word mood from a closed list; no names, no history beyond the candidate ids. Persona: "choose one id from candidates". Output schema:
```
{ "eventId": string, "safetyDisposition": "ALLOW"|"REDIRECT"|"STOP" }
```
(`additionalProperties:false`). Validator `validate_castle_choice`: `eventId` must be in the server eligible set (exact string match); disposition ALLOW; anything else is invalid. The model returns no text for events: the dialogue shown is the authored `lines` entry for the band.
Response to client:
```
{ "eventId": "...", "source": "AI"|"FALLBACK", "lines": ["..."], "npcId": "...", "visual": {...} }
```
Server then records `shownCounts`/`lastShownVisit` (the only write; a display counter, not progress). No reward, quest, or WorldChange path exists in this route.
Audit: `run_turn` writes `AIInteractionAudit` (route, schema version, validation status, provider, tokens, latency, `input_category="CASTLE_DIRECTOR"`, `step_id=roomId`). Add `ContextSource.DJANGO_CATALOG`. Store the chosen event id nowhere in free text; no child text exists on this route, `untrusted_context` is empty.

## 4. Failure paths (all return the deterministic `defaultEvent`, `source=FALLBACK`)
| Failure | Mechanism | Fallback |
|---|---|---|
| `child.ai_enabled` false (parent AI off) | `run_turn` early return, no audit | defaultEvent |
| `LAI_AI_PROVIDER=disabled` / `AIServiceControl.model_calls_enabled` false | same | defaultEvent |
| Rate limit / budget (`usage.admit`) | `Status.RATE_LIMITED` | defaultEvent |
| Provider config missing, timeout, throttle, any `ProviderError` | `FailureCategory.*` | defaultEvent |
| Unexpected provider exception | `FailureCategory.UNKNOWN` | defaultEvent |
| Malformed JSON / schema mismatch | `InvalidModelResponse` -> `INVALID_SCHEMA` | defaultEvent |
| `eventId` not in eligible set, or empty eligible set | validator invalid -> `INVALID_CONTENT` | defaultEvent / room fallback event |
| Guardrail intervened | `BLOCKED_GUARDRAIL` + SafetyEvent `castle-guardrail` | defaultEvent |
| Disposition REDIRECT/STOP | SafetyEvent | defaultEvent |
| Network failure / non-2xx on the client | client catch | client computes the same `eligibleEvents` locally and uses `defaultEvent`; castle is fully playable offline of AI |
Note `pipeline.run_turn` post-validates `result.turn["spokenText"]` with `boundary_violations`; the castle route has no spokenText for events, so make that check conditional or have the castle validator return a turn dict whose `spokenText` is the authored line (the check then passes trivially and still guards authored-copy regressions).

## 5. Reuse
`pipeline.run_turn` (kill switches, admit/release, audit, safety event, metrics); `providers.get_model_client` and `FakeModelClient`; `ModelRequest.fake_hints`; `auditing.record`; `AIServiceControl`; `safety.screen_untrusted_text` (kept for SC-R09-02 only); `fallbacks.py` pattern; `limits.MAX_SPOKEN_LENGTH_BY_AGE_BAND`; `npc.condition_met` / `child_npc_state`; Guardrail from ADR-044.
SC-R09-02 (Quill flavour): do not build a new route. Use `npc_hint` (`RouteName.NPC_HINT`) with a published Quill NPC release: `allowed_topic` per event, `authored_base_text` = the event line, persona `fallbackLines`, `max_response_chars` capped to band limit, empty untrusted context, no choices, no flags set. Output is one short line; fallback is the authored line.

## 6. Repetition without real-world pressure
No wall-clock cooldowns, no "come back tomorrow", no streaks. `visitIndex` = count of the child's completed or open castle region sessions (`AdventureSession` kind REGION for the castle), so waiting never changes eligibility and absence is never penalised. `minVisitGap` and `maxShows` are in visits. Ambient events are never counted-down UI, never announced as missed, and the "Things to do" list excludes them. Events that end a visit gap simply become eligible next visit.

## 7. Unit tests (fake provider, no live Bedrock)
Eligibility (pure, TS and Python golden parity): band filter; room filter and ANY; DRAFT/RETIRED excluded; each `requires` type pass/fail and unknown type fails; `maxShows` exhausted; `minVisitGap` boundary; weight/id ordering stable; empty set returns room fallback; no clock dependence (same output across `Date` mocks).
Route (`FakeModelClient`): valid id in set returns AI and the authored line; id not in set -> FALLBACK + `INVALID_CONTENT`; id eligible-in-another-room rejected; extra fields rejected; malformed JSON; `ProviderError` timeout; guardrail intervened (+SafetyEvent); REDIRECT/STOP; `ai_enabled=False` (no model call, `client.requests` empty); provider disabled; kill switch off; rate limited; client cannot supply candidates (request with extra `candidates` ignored or 400); other parent's child 403/404; audit row contains no event text or child data; `shownCounts` updated once only; response never contains reward, quest, or WorldChange keys; model prompt contains only candidate ids and tags; Quill flavour (npc_hint): over-length line, URL, personal-information request -> authored line + SafetyEvent; flag outside `reachableMemoryFlags` impossible.
Client: server error yields local `defaultEvent`; Sprouts get voice-first line only.
