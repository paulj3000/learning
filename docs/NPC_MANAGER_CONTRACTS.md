# NPC Manager shared contracts (version 1, frozen)

Status: **frozen for parallel development** on `feature/npc-manager` (2026-11-05). Decision:
ADR-054. Plan and task graph: `docs/NPC_MANAGER_IMPLEMENTATION_PLAN.md`.

A change to anything in this document is a contract change: it is made on the integration branch
`feature/npc-manager` by the integrator, recorded in section 9, and announced to every running
workstream before any workstream relies on it. Workstreams never edit the files listed as
foundation-owned in section 8.

Code that embodies the contract (the code wins if this text and the code ever disagree; then fix
the text):

| Concern | Python | TypeScript |
|---|---|---|
| Vocabularies | `lai/apps/npcs/vocabulary.py` | `react/src/features/npc-manager/contracts/vocabulary.ts` |
| Conditions | `lai/apps/npcs/conditions.py` | (server only) |
| Behaviour parameters | `lai/apps/npcs/behaviors.py` | `contracts/types.ts` `BehaviorParameters` |
| Release snapshot | `lai/apps/npcs/publishing/snapshot.py` | (server only) |
| Published reads | `lai/apps/npcs/published.py` | n/a |
| API routes | `lai/apps/npcs/urls.py`, `api.py` | `contracts/types.ts`, `contracts/parse.ts` |
| Engine | n/a | `contracts/engine.ts` |

`lai/apps/npcs/tests/test_contract_mirror.py` fails when the two vocabularies drift.

## 1. Identity and stable slugs

- A character's identity is the canonical `catalog.NpcDefinition` (ADR-033). Its `npc_id` is the
  stable slug used in every API, release, speech reference, relationship and quest objective.
  Examples: `pirate-pip`, `keeper-quill`.
- `npcs.NpcCharacter` is one-to-one with the definition and adds the NPC Manager profile. An
  export NPC (`origin=EXPORT`) gets a character row by staff action; staff may also create a
  Django-only NPC (`origin=DJANGO`). The content import never creates, updates or claims a
  `DJANGO` row and fails if an export id collides with one.
- Other stable keys: variant `variantKey` (unique per character), placement `placementKey`
  (unique per Place), behaviour profile `key` (global), dialogue `dialogueKey` (per character),
  node `nodeKey` (per dialogue), choice `choiceKey` (per node). All are slugs and never reused
  for a different meaning.

## 2. Model and asset references

- Assets are `catalog.ContentAsset` rows; versions are `assets.AssetVersion` (ADR-035). The NPC
  Manager never stores bytes and never adds a second asset store.
- Kinds: a variant model is `character`; a portrait is `image` or `sprite`; a recorded line is
  `audio`; extras are any kind appropriate to their role.
- A release freezes each reference as `{"assetId": str, "version": int | null}`. `version` is the
  published version number the release resolved at publish time (a pinned version or the asset's
  `default_version`). `null` means a bundled-only export asset (served from `react/public`).
- The client resolves `assetId@version` (or `assetId`) through the existing asset resolver
  (`djangoAssetResolverFor(childId)`, `GET children/<child>/assets/?ids=`); it never builds file
  URLs itself.
- Publishing refuses: a retired asset, the wrong kind, an unpublished pinned or default version,
  or an asset with neither a published version nor a bundled path.
- Every reference a release uses is recorded in `NpcReleaseAsset` (asset and version, PROTECT).

## 3. Published release format (snapshot schema 1)

Only the ACTIVE `NpcRelease.snapshot` is served. Drafts are never served.

```jsonc
{
  "schemaVersion": 1,
  "characters": {
    "<npcId>": {
      "npcId": "pirate-pip",
      "displayName": "Pirate Pip",
      "role": "QUEST_GIVER",              // NpcRole
      "ageBands": [],                     // empty = every band
      "personality": {"traits": ["cheerful"], "tone": "warm", "catchphrases": ["Ahoy!"]},
      "dialogueMode": "AUTHORED",         // AUTHORED | HYBRID | AI
      "voiceProfile": "pirate-pip",       // speech.VoiceProfile.profile_id or null
      "defaultVariant": "classic",
      "variants": [{
        "variantKey": "classic", "displayName": "Classic",
        "model": {"assetId": "npc-pip", "version": null},
        "portrait": null,
        "scale": 1.0, "rotationOffsetY": 0.0, "positionOffsetY": 0.0,
        "animationMap": {"idle": "Idle", "talk": "Talk", "wave": "Wave"},
        "availability": [],               // conditions (server only)
        "isDefault": true,
        "extras": [{"role": "ACCESSORY", "asset": {...}, "attachPoint": "Head"}]
      }],
      "dialogues": [{                     // SERVER ONLY
        "dialogueKey": "greeting", "trigger": "on_interact", "mode": "AUTHORED",
        "ageBands": [], "conditions": [], "priority": 0, "oncePerChild": false,
        "startNode": "hello",
        "nodes": [{
          "nodeKey": "hello", "text": "Ahoy!", "emotion": "happy", "animationState": "wave",
          "audio": null, "ageBands": [], "conditions": [], "next": null,
          "allowAiHint": false, "allowedTopic": "",
          "choices": [{"choiceKey": "ok", "label": "Okay", "next": "bye",
                       "conditions": [], "action": "NONE", "actionValue": null}]
        }]
      }],
      "persona": null                     // SERVER ONLY: {version, personalityPrompt,
                                          //   permittedTopics, ageBands, maxResponseChars,
                                          //   fallbackLines}
    }
  },
  "placements": [{
    "placementKey": "cove-pip", "npcId": "pirate-pip",
    "island": "<world slug>", "place": "<location slug>", "area": "<region_id>" | null,
    "variant": "<variantKey>" | null, "behavior": "<behaviour key>" | null,
    "position": {"x": 3.0, "y": 0.0, "z": 6.0}, "rotationY": 0.0, "scale": 1.0,
    "interactionRadius": 2.5, "spawnConditions": []   // conditions (server only)
  }],
  "behaviors": {"<key>": {"type": "stationary", "parameters": {"boundsRadius": 15, "reactions": {}}}}
}
```

Server-only keys (`published.SERVER_ONLY_CHARACTER_KEYS` = `persona`, `dialogues`; plus
`availability`, `isDefault`, `spawnConditions`, `island`) never appear in a runtime response.

Publishing lifecycle: `publish(user, notes)` validates and creates release N+1 as ACTIVE (the
previous ACTIVE becomes SUPERSEDED); `rollback(release)` reactivates a SUPERSEDED release whose
assets are all still live; `retire(release)` withdraws one for good (retiring the ACTIVE release
leaves no NPC content served, which every client must treat as "no NPCs here", not as an error
screen). Releases are immutable and never deleted.

## 4. Conditions, triggers and events

**Conditions** (`conditions.py`): `ALWAYS`, `AGE_BAND{in}`, `WORLD_CHANGE{key, present?, place?}`,
`QUEST_STATUS{quest, status}`, `FIRST_VISIT`, `RETURN_VISIT`, `LOCAL_FLAG{flag, equals?}`,
`RELATIONSHIP_AT_LEAST{level}`. AND semantics; malformed never holds (fail closed). Evaluated
only on the server, against `conditions.context_for(child, npc_id, local_flags=, prior_visits=)`.

**Triggers** (LAI-NPC-013), each mapped to an *existing* gameplay signal. The client reports a
trigger; the server only selects dialogue for it and never writes progress because of it.

| Trigger | Existing source |
|---|---|
| `on_spawn` | engine `npc.loaded` |
| `on_player_near` | engine `npc.approached` (and `WorldEngineEventBus` `NpcApproached`) |
| `on_interact` | engine `npc.interact_requested` (tap, click, Enter/Space, touch) |
| `on_adventure_start` | `POST regions/<id>/session/` answered 201 |
| `on_return_visit` | `POST regions/<id>/session/` answered 200 (resumed), or prior NPC relationship |
| `on_challenge_start` | `POST sessions/<id>/chests/<entity>/challenge/` answered |
| `on_correct_answer` / `on_incorrect_answer` | `POST attempts/<id>/answer/` `correct` |
| `on_treasure_found` | answer outcome with a reward, or `pickups/` with new items |
| `on_quest_complete` | any outcome with `questUpdates[].justCompleted` |
| `on_adventure_complete` | world change `TREASURE_COVE_QUEST_COMPLETE` (or the adventure's completion change) / session `complete` after the adventure was finished. A calm stop (session time limit) also ends the session as `complete` but is **not** `on_adventure_complete`, so an NPC never celebrates a time-out |

**Adventure events** (`ADVENTURE_EVENTS`) drive engine reactions only (`react` command); the
client emits them from server outcomes it already has. **Dialogue events** (`DIALOGUE_EVENTS`)
are emitted by the React dialogue controller.

## 5. HTTP API (all under `/api/v1/`, error body `{"error": {"code", "message"}}`)

Every response carries `"contractVersion": 1`. All routes are child-scoped: the parent's bearer
token resolves `child_id` (another family's child is 404). The game runtime cookie
(`GameRuntimeAccessMixin`) is accepted on 3D Area routes only, for its own child and region.

### 5.1 Runtime reads (workstream B, LAI-NPC-007)

- `GET children/<child>/npcs/` -> `{contractVersion, release, characters: [RuntimeCharacter]}`:
  the ACTIVE release's characters eligible for the child's age band.
- `GET children/<child>/regions/<region_id>/npcs/` and
  `GET children/<child>/places/<place_slug>/npcs/` ->
  `{contractVersion, release, scope: {place, area}, characters: {npcId: RuntimeCharacter},
  placements: [RuntimePlacement]}`. Placements are filtered by scope (a Place route returns only
  placements with `area: null`), the character's age bands, and `spawnConditions` evaluated for
  this child. `variant` is resolved: the placement's variant if available to this child, else the
  first available variant by order, else the default. `behavior` is inlined as
  `{key, type, parameters}` or null. `characters` holds exactly the characters placed.
- No active release (never published, or the active release retired): these three reads answer
  `200` with `release: 0` and nothing in them (`characters: []` for the catalog;
  `characters: {}, placements: []` for a scene, `scope` as requested). Clients show no managed
  NPCs, never an error screen. Child and scope checks still apply first (another family's child,
  an unknown Place or Area: 404). Changed from `404 no_active_release` after QA finding F-A,
  because browsers log every 4xx as a failed resource on every visit; clients still accept the
  old 404 as the same empty answer. Interaction, speech and hint routes keep
  `404 no_active_release`.
- RuntimeCharacter = snapshot character minus server-only keys and minus each variant's
  `availability` and `isDefault`.

### 5.2 Interactions (workstream C, LAI-NPC-012/013/017)

Prefix: `children/<child>/regions/<region_id>/npcs/<npc_id>/` or
`children/<child>/places/<place_slug>/npcs/<npc_id>/`. The NPC must be placed in that scope and
eligible for the child, else `404 npc_not_found`.

- `POST interactions/` body `{"trigger": Trigger, "placementKey"?: str}` -> InteractionResponse.
  Selects the highest-priority active dialogue for the trigger whose age bands and conditions
  hold and which is not a `oncePerChild` dialogue already seen; starts it at its start node (the
  first node whose own bands/conditions hold, following `next` past nodes that do not). Records
  the cursor in `NpcConversationState` (one per child and NPC; starting a new conversation
  replaces the old cursor). No matching dialogue: 200 with `node: null, ended: true,
  conversationId: null`. Unknown trigger: `400 invalid_trigger`.
- `POST interactions/<conversation_id>/choose/` body `{"choiceKey": str}` -> InteractionResponse.
  The choice must belong to the current node and its conditions must hold, else
  `409 invalid_choice`. Applies the choice action (section 7), then moves to `next` or ends.
- `POST interactions/<conversation_id>/advance/` body `{}`: for a node without choices; moves to
  `next` or ends. A node with choices refuses (`409 invalid_choice`).
- `POST interactions/<conversation_id>/end/` body `{}`: ends; `ended: true`. Idempotent: ending a
  conversation that is already over (ended, replaced by a newer one, or started on an older
  release) is `200` with `node: null, ended: true` (QA finding F-A follow-up: a client's
  best-effort end can race its next start).
- For `choose` and `advance`: a conversation id that is not this child's current one:
  `404 conversation_not_found`; one that already ended: `409 conversation_ended`. A conversation started on an older release is ended
  when the release changes (`409 conversation_ended`).
- InteractionResponse: `{contractVersion, release, npcId, conversationId, dialogueKey,
  node: RuntimeNode | null, choices: [{choiceKey, label, action}], ended, questOffer}`.
  RuntimeNode: `{nodeKey, text, emotion, animationState, audio: AssetRef|null,
  speech: {kind: "npcDialogueNode", npcId, release, dialogueKey, nodeKey} | null, allowAiHint}`.
  `speech` is set when the character has a voice profile, else null. Choices and nodes are
  filtered by the child's age band and conditions; text is authored text only.
- Updates `NpcConversationState.last_interaction_at`, `visit_count` (once per new conversation),
  `seen_dialogue_keys`. Never writes `NpcRelationship`, quests, world changes or inventory.

### 5.3 Hybrid AI hint (workstream F, LAI-NPC-030/032/033)

- `POST interactions/<conversation_id>/hint/` body `{}` -> `{contractVersion, hint: {text,
  source: "AI"|"FALLBACK", speech: {kind: "utterance", id} | null}}`. Allowed only when the
  current node has `allowAiHint` and the character's mode is HYBRID or AI; otherwise
  `409 dialogue_unavailable`. No child free text is accepted. Runs through the existing
  `apps.ai` pipeline (`run_turn`) with server-built context (persona, node `allowedTopic`, age
  band); model output is untrusted and validated; any failure returns the persona's authored
  fallback with `source: "FALLBACK"`. AI off or rate-limited: fallback, never an error screen.
  Nothing here changes gameplay state.

### 5.4 Speech (workstream E, LAI-NPC-028/029)

The existing speech API (ADR-049) gains one reference kind:
`{"kind": "npcDialogueNode", "npcId", "release", "dialogueKey", "nodeKey"}`, resolved from the
named *published* release's snapshot (never draft rows), voiced by the character's
`voiceProfile`. Cache key over text, voice, engine, language, rate (existing `cache_key`).
Publishing may pre-generate clips for every node of a voiced character (fake client in tests).

## 6. Engine contract (React, `contracts/engine.ts`)

- Events out: `npc.loaded`, `npc.load_failed`, `npc.approached`, `npc.left`,
  `npc.interact_requested`, `npc.waypoint_reached`, `npc.behavior_changed`,
  `npc.animation_finished`.
- Commands in: `animate`, `stop_animation`, `face`, `react`, `interrupt_behavior`,
  `resume_behavior`, `set_visible`.
- Animation: state -> clip through the variant's `animationMap`, then `ANIMATION_FALLBACKS`,
  then idle; if the model has no clips at all, a procedural placeholder motion that is skipped
  under reduced motion. Priority bands: behaviour 0, reaction 1, dialogue 2, scripted 3; a
  higher band preempts; a one-shot returns to the behaviour's base state; crossfade 0.2 s.
- Lifecycle and disposal: as documented on `NpcRuntime` in `engine.ts`.
- Engine modules live in `react/src/features/npc-manager/engine/` (and `behavior/`) and must not
  import React, API clients, Amplify or AWS SDKs (ADR-020).

## 7. Child authorization and gameplay safety rules

1. Every NPC endpoint is child-scoped (`NpcScopedView`); another family's child is 404.
2. The game cookie only reaches 3D Area routes for its own child and region.
3. Children only ever see ACTIVE release content; draft rows are never read by runtime code.
4. Choice actions are a closed set: `NONE`, `END`, `SET_LOCAL_FLAG` (writes only
   `NpcConversationState.local_flags`, at most 32 boolean flags), `OFFER_QUEST` (returns
   `questOffer`; accepting is the child's own tap through `POST quests/<id>/accept/`),
   `REQUEST_HINT` (the client then calls the hint route). None awards, unlocks, completes or
   writes progress.
5. Rewards, quest completion, world changes and relationship points stay with the existing play
   services (`game_sessions.play`, `quests`, `progression`, `inventory`).
6. AI output never changes gameplay state; personas and dialogue trees are never sent to clients.
7. No child free text reaches an NPC route in contract v1.

## 8. File ownership for parallel work

Foundation-owned (integrator only): `lai/apps/npcs/{models,vocabulary,conditions,behaviors,
published,api,urls,admin}.py`, `publishing/`, `validation/__init__.py`, `tests/helpers.py`,
`migrations/0001_*`, `react/src/features/npc-manager/contracts/`, this document.

| Workstream | Owns |
|---|---|
| A Admin and assets | `npcs/admin_characters.py`, `npcs/apps.py` (`ready()` hooks), `npcs/management/` (except E's command), `npcs/templates/`, `npcs/validation/assets.py`, `npcs/dependencies.py`, hooks in `apps/assets/services.py` retire paths |
| B Runtime | `npcs/views_runtime.py`, `npcs/runtime.py`, `npcs/serializers_runtime.py`, `react/src/features/npc-manager/{api,engine,animation,ui}/` |
| C Dialogue | `npcs/views_dialogue.py`, `npcs/dialogue.py`, `npcs/triggers.py`, `npcs/state.py`, `npcs/validation/dialogue.py`, `react/src/features/npc-manager/dialogue/` |
| D Behaviour | `npcs/admin_behavior.py`, `npcs/validation/behavior.py`, `npcs/preview_behavior.py`, `react/src/features/npc-manager/behavior/` |
| E Voice | `apps/speech/` NPC additions, `npcs/speech.py`, `npcs/validation/voice.py`, `react/src/features/npc-manager/voice/` |
| F AI | `npcs/admin_persona.py`, `npcs/views_ai.py`, `npcs/ai.py`, `npcs/validation/persona.py`, the NPC route in `apps/ai/` |

Each workstream adds tests only under its own names (`lai/apps/npcs/tests/test_<area>_*.py`,
co-located `*.test.ts`). A workstream that needs a schema or contract change stops and asks the
integrator; it does not add migrations to `npcs`.

## 9. Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-11-05 | Initial freeze (foundation commit). |
| 1 | 2026-11-05 | Before any workstream started: `admin.py` split into `admin_characters` (A), `admin_behavior` (D), `admin_persona` (F); `BehaviorController` interface added to `engine.ts` (D implements, B consumes). |
| 1.1 | 2026-11-05 | Integrator, after wave 1 (additive, backward compatible): `BehaviorControllerArgs.reducedMotion?`, `BehaviorFrame.animation?` (scripted `play`), `BehaviorController.cancel()`; interaction routes use `path()` converters (`<uuid:conversation_id>`; `choose`, `advance`, `end`, `hint` as fixed segments); Place and catalog NPC routes are bearer-only (`api.bearer_only`), so the game cookie gets 401/403 there instead of 404; `SpeechReference` gains `npcDialogueNode`; publish and rollback schedule speech pre-generation after commit; `npcs/management/` added to workstream A. |
| 1.1 | 2026-11-05 | Clarified (no code change): a calm-stop session completion is not `on_adventure_complete` (Treasure Rush integration). |
