# NPC Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-020, ADR-033, ADR-035, ADR-044, ADR-049, ADR-054

How non-player characters are defined, placed, animated, voiced and given dialogue in any Realm,
Place or Adventure. Every NPC uses the NPC Manager. The canonical detail lives in:

| Topic | Canonical document |
|---|---|
| Decision | ADR-054 in [DECISIONS.md](../DECISIONS.md) |
| Contracts (identity, release snapshot, HTTP API, engine, safety rules) | [NPC_MANAGER_CONTRACTS.md](../NPC_MANAGER_CONTRACTS.md) |
| Plan and workstreams | [NPC_MANAGER_IMPLEMENTATION_PLAN.md](../NPC_MANAGER_IMPLEMENTATION_PLAN.md) |
| Accessibility | [NPC_MANAGER_ACCESSIBILITY.md](../NPC_MANAGER_ACCESSIBILITY.md) |
| Performance | [NPC_MANAGER_PERFORMANCE.md](../NPC_MANAGER_PERFORMANCE.md) |
| AI and Polly acceptance | [NPC_MANAGER_AI_POLLY_ACCEPTANCE.md](../NPC_MANAGER_AI_POLLY_ACCEPTANCE.md) |
| AI safety | [AI_AND_CHILD_SAFETY.md](../AI_AND_CHILD_SAFETY.md), [AI_SERVICE.md](../AI_SERVICE.md) |

Code: `lai/apps/npcs` (Django) and `react/src/features/npc-manager` (client: `contracts`, `api`,
`dialogue`, `engine`, `behavior`, `animation`, `voice`, `host`, `ui`).

Related standards: [adventure-standard.md](adventure-standard.md),
[quest-standard.md](quest-standard.md), [asset-standard.md](asset-standard.md),
[audio-standard.md](audio-standard.md), [accessibility-standard.md](accessibility-standard.md),
[educational-content-standard.md](educational-content-standard.md).

Rules tagged **Binding** already apply through the cited source. Untagged rules are proposals
of ADR-072.

## 1. One NPC system

- **Binding:** ADR-054. `catalog.NpcDefinition` is the one NPC identity; `npc_id` is the stable
  slug used in every API, release, speech reference and quest objective (`pirate-pip`,
  `keeper-quill`). `apps.npcs` adds only what the export does not carry, keyed one-to-one.
- **Binding:** ADR-033, ADR-054. Do not build a per-world NPC loader, dialogue table or talk
  panel. New worlds mount the shared host (`host/useNpcSceneHost.tsx`) and the shared UI.
- Hard-coded character copy in React (for example legacy `PLAY_COPY` lines) is migration debt;
  new characters put every line in the NPC Manager.
- Stable keys (variant, placement, behaviour, dialogue, node, choice) are slugs and are never
  reused for a different meaning.

## 2. Authoring and publishing

**Binding:** ADR-054 items 2 and 3, ADR-045. NPC configuration is authored in Django Admin and
published as immutable, versioned `NpcRelease` snapshots.

| Step | Rule |
|---|---|
| Character | `NpcCharacter` holds role, personality summary, age bands, status (`DRAFT`, `READY`, `RETIRED`), dialogue mode and voice |
| Ready | Only `READY` characters enter a release |
| Publish | Validates structure, assets, dialogue, behaviour, voice and persona; writes nothing on failure |
| Active | Exactly one release is `ACTIVE` (partial unique constraint plus advisory lock) |
| Rollback | Reactivates a `SUPERSEDED` release whose assets are still live |
| Retire | Permanent |

- **Binding:** ADR-054. Children are served only the ACTIVE snapshot. Runtime code never reads
  draft rows. Releases are never edited or deleted.
- A conversation started on an older release ends when the release changes
  (`409 conversation_ended`); clients handle it calmly.
- A ticket that changes a character names the release it expects to publish and who publishes.

## 3. Roles

Roles are a closed vocabulary (`NpcRole` in `lai/apps/npcs/vocabulary.py`):
`GUIDE`, `COMPANION`, `QUEST_GIVER`, `STORYTELLER`, `TEACHER`, `MERCHANT`, `INTERACTIVE`,
`AMBIENT`.

- Pick the role that matches what the child does with the character. A role is descriptive; it
  grants no extra power.
- `MERCHANT` never involves real money or purchases by children (CLAUDE.md §12; ADR-011 rejects
  a coin or XP economy).
- Chatty the Parrot is the companion (CLAUDE.md §6). Other characters do not imitate Chatty's
  companion role.

## 4. Behaviours

- Behaviour types are closed: `stationary`, `wander`, `patrol`, `follow`, `guide`, `reactive`,
  `scripted` (`BehaviorType`). Profiles are reusable `NpcBehaviorProfile` rows.
- **Binding:** ADR-020, ADR-054 item 6. The NPC engine (`engine/`, `behavior/`) renders, animates
  and moves NPCs from typed spawns and commands and emits typed events. It never calls the
  network, validates answers, awards progress or calls AI, and does not import React, API
  clients, Amplify or AWS SDKs (`npcEngineBoundary.test.ts`).
- Under reduced motion, wandering and patrolling NPCs stand still and procedural placeholder
  motion stops (see [NPC_MANAGER_ACCESSIBILITY.md](../NPC_MANAGER_ACCESSIBILITY.md)).
- NPCs never block a path the child needs, chase the child, or crowd the camera. A `follow`
  NPC keeps a fixed distance and yields.

## 5. Placement

- **Binding:** ADR-054 item 4. `NpcPlacement` is an owner-approved, NPC-only exception to
  LAI-0805: staff place NPCs with numeric position, rotation, scale, interaction radius and spawn
  conditions in Django Admin, validated against the Island (Realm), Place and optional 3D Area.
  There is no visual layout editor.
- **Binding:** ADR-033 item 4, ADR-047 decision H. Every other object's layout stays
  seed-authored. Do not extend the NPC exception to props, colliders or spawn points.
- Placements sit on walkable ground, outside colliders and away from exits, with an interaction
  radius a child can reach. Record coordinates in the adventure specification.

## 6. Animation mappings

- Runtime states are closed (`ANIMATION_STATES`): `idle`, `walk`, `run`, `talk`, `wave`,
  `point`, `celebrate`, `think`, `sad`, `laugh`, `jump`.
- Each `NpcModelVariant` maps states to real clip names in `animation_map`. Unknown states are
  refused at save.
- Missing clips fall back through `ANIMATION_FALLBACKS`, then `idle`; a model with no clips gets
  a procedural placeholder motion that is skipped under reduced motion.
- Clip names follow the asset clip vocabulary and must not be exporter default take names; see
  [asset-standard.md](asset-standard.md) section 8.
- Priority bands: behaviour 0, reaction 1, dialogue 2, scripted 3; a one-shot returns to the
  behaviour's base state (NPC_MANAGER_CONTRACTS.md section 6).

## 7. Dialogue

- Dialogue is `NpcDialogue` with `NpcDialogueNode` and `NpcDialogueChoice` rows, selected by
  trigger (`Trigger`: `on_spawn`, `on_player_near`, `on_interact`, `on_adventure_start`,
  `on_challenge_start`, `on_correct_answer`, `on_incorrect_answer`, `on_treasure_found`,
  `on_quest_complete`, `on_adventure_complete`, `on_return_visit`) and filtered by age band and
  conditions (`CONDITION_TYPES`).
- **Binding:** ADR-054 item 7. The server selects and advances dialogue from the ACTIVE release
  and evaluates conditions against authoritative progress. The client only displays.
- Choice actions are a closed, non-rewarding set: `NONE`, `END`, `SET_LOCAL_FLAG`,
  `OFFER_QUEST`, `REQUEST_HINT`. None awards, unlocks, completes or writes progress
  (**Binding:** ADR-054 item 7, NPC_MANAGER_CONTRACTS.md section 7).
- **Binding:** NPC_MANAGER_CONTRACTS.md section 7 rule 7. No child free text reaches an NPC route
  in contract v1.
- Copy rules (**Binding:** CLAUDE.md §13): short lines readable aloud, localizable, no em dashes,
  calm wording for wrong answers ("Answer not right yet", never shaming). Lines vary by age band
  where reading volume differs.
- Unprompted lines (greetings, reactions) use the non-modal ambient line and never trap focus.

## 8. Quest interactions (offer seam)

- An NPC offers a quest with `OFFER_QUEST`, which returns a `questOffer`. Accepting is the
  child's own tap through `POST quests/<id>/accept/`; the NPC never accepts on the child's behalf.
- Quest progress, completion, rewards, world changes and relationship points stay with the play
  services (`game_sessions.play`, `quests`, `progression`, `inventory`) (**Binding:** ADR-054
  item 7).
- `SET_LOCAL_FLAG` writes only `NpcConversationState.local_flags` (at most 32 booleans), never
  quest memory.
- The quest side is defined in [quest-standard.md](quest-standard.md).

## 9. Educational interactions

- An NPC may introduce a challenge, react to an answer and give a hint. It never grades.
  **Binding:** CLAUDE.md §7, ADR-020: application code grades.
- Triggers `on_challenge_start`, `on_correct_answer` and `on_incorrect_answer` map to existing
  gameplay signals; reactions celebrate effort, not speed.
- Hints follow the challenge's authored hint ladder first; see
  [challenge-standard.md](challenge-standard.md) and
  [educational-content-standard.md](educational-content-standard.md).
- Factual claims in NPC lines follow [CONTENT_SOURCES.md](../CONTENT_SOURCES.md).

## 10. AI-assisted dialogue

- Dialogue modes: `AUTHORED` (never calls a model), `HYBRID` (authored nodes plus AI hints) and
  `AI` (persona lines). Default to `AUTHORED`; choose `HYBRID` only where variation helps
  learning.
- **Binding:** ADR-054 item 9, ADR-044, CLAUDE.md §7. AI runs only through the Django AI pipeline
  (`apps.ai`, `run_turn`), never from the browser, with server-built context (persona, node
  `allowedTopic`, age band), structured output validated against a schema, and no child free
  text.
- **Binding:** ADR-054 item 9. A persona (`NpcPersona`) is versioned and staff-approved; only an
  `APPROVED` persona enters a release. It carries permitted topics, age bands, a maximum response
  length (40 to 400 characters, default 220) and authored fallback lines.
- AI output is untrusted and never changes gameplay state. Personas and dialogue trees are never
  sent to clients.
- **Binding:** CLAUDE.md §6. Every character, not only Chatty, is warm and concise, never claims
  to be human, conscious, lonely or dependent on the child, never asks for private information,
  never encourages secrecy, never diagnoses or disciplines.

## 11. Safety restrictions

**Binding:** NPC_MANAGER_CONTRACTS.md section 7 and ADR-054:
- every NPC endpoint is child-scoped; another family's child is a 404;
- children only see ACTIVE release content;
- choice actions cannot award, unlock or complete;
- AI output never changes gameplay state;
- no child free text in contract v1.

Also:
- **Binding:** ADR-025, CLAUDE.md §13. Do not log dialogue text, child names or identifiers.
  `NpcConversationState` is child-owned and stays out of Django Admin.
- Out of scope (CLAUDE.md §12): open-ended chat, child-to-child messaging, voice cloning, emotion
  inference.

## 12. Authored fallbacks

Every NPC interaction works with AI off, Bedrock unavailable, rate limits hit, audio muted or
speech failing:
- hint failure returns the persona's authored fallback with `source: "FALLBACK"`; never an error
  screen (**Binding:** NPC_MANAGER_CONTRACTS.md section 5.3);
- no matching dialogue returns `node: null, ended: true`; the world continues;
- captions always show; audio is optional (**Binding:** ADR-054 item 8);
- a model that fails to load shows the bundled file or a placeholder and emits `npc.load_failed`.

## 13. Voice

- **Binding:** ADR-054 item 8. Characters speak through the speech app (`lai/apps/speech`,
  ADR-049, which is Proposed) using a `speech.VoiceProfile` and server-approved references only
  (`npcDialogueNode` kind, resolved from the ACTIVE release). Clients never send text to speak.
- Playback is the Sound Manager's `voice` channel; see [audio-standard.md](audio-standard.md).

## 14. Versioning

- `NpcRelease` snapshot schema and contract version are constants in `vocabulary.py`
  (`SNAPSHOT_SCHEMA_VERSION`, `CONTRACT_VERSION`, both 1). The contract is frozen at version 1.
- A breaking change to the snapshot or API needs a new version, a migration note in
  NPC_MANAGER_CONTRACTS.md "Change log", and a coordinated change because NPC systems are a
  shared component (see
  [multi-agent-workflow.md](../engineering/multi-agent-workflow.md)).
- Personas are versioned rows; changing an approved persona means a new version.

## 15. Tests and checks

Follow [TESTING_STRATEGY.md](../TESTING_STRATEGY.md). Targeted examples:

```bash
.venv/bin/python -m pytest -q lai/apps/npcs
cd react && npx vitest run --maxWorkers=2 src/features/npc-manager
```

A new character or dialogue change includes tests for publish validation, age-band filtering,
choice actions and the fallback path. Browser acceptance of NPC scenes is the owner's
([NPC_MANAGER_BROWSER_ACCEPTANCE.md](../NPC_MANAGER_BROWSER_ACCEPTANCE.md)).
