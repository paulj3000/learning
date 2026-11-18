# NPC Standard

- **Status:** Mandatory policy (in effect once merged to `main` with owner approval; governance decision ADR-072, Proposed)
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-033, ADR-035, ADR-041, ADR-044, ADR-045, ADR-048 (Proposed), ADR-049 (Proposed), ADR-050 (Proposed), ADR-053, ADR-054, ADR-072 (Proposed)
- **Canonical sources:** [`docs/NPC_MANAGER_CONTRACTS.md`](../NPC_MANAGER_CONTRACTS.md), [`docs/NPC_MANAGER_IMPLEMENTATION_PLAN.md`](../NPC_MANAGER_IMPLEMENTATION_PLAN.md), [`docs/NPC_MANAGER_ACCESSIBILITY.md`](../NPC_MANAGER_ACCESSIBILITY.md), [`docs/AI_AND_CHILD_SAFETY.md`](../AI_AND_CHILD_SAFETY.md), [`docs/AI_SERVICE.md`](../AI_SERVICE.md), [`CLAUDE.md`](../../CLAUDE.md) section 6, [`docs/DECISIONS.md`](../DECISIONS.md)

Every character a child meets in an adventure (Pirate Pip, Keeper Quill, Chatty, later ones) is
defined, published and run through the shared NPC Manager. The frozen contract
([`NPC_MANAGER_CONTRACTS.md`](../NPC_MANAGER_CONTRACTS.md), version 1.1) wins on any detail; when
the contract and the code disagree, the code wins and the text is fixed.

State: the NPC Manager (`lai/apps/npcs`, `react/src/features/npc-manager`) is **Implemented
(main)**, development only. Nothing is deployed; no live Bedrock or Polly call has been made; browser
acceptance is the owner's. The legacy client-side `react/src/features/npc` module still serves
characters the NPC Manager does not publish; new adventures do not extend it.

## 1. Rules every adventure follows

| # | Rule | Source |
|---|---|---|
| N1 | Use the NPC Manager. Never build a per-adventure NPC loader, dialogue engine, animation system, persona store or placement table | ADR-054, ADR-033 |
| N2 | One identity: `catalog.NpcDefinition.npc_id` is the stable slug everywhere (API, release, speech, quests, relationships) | ADR-054 item 1 |
| N3 | NPC content is authored in Django Admin and served only from the ACTIVE `NpcRelease` snapshot. Drafts are never served | ADR-054 items 2 and 3 |
| N4 | The server selects and advances dialogue. The client reports triggers and shows what it receives | ADR-054 item 7 |
| N5 | NPCs never award, unlock, complete or write progress. Rewards, quests, world changes and relationships stay with the existing play services | Contract section 7 |
| N6 | The NPC engine module never calls the network, validates answers, awards progress or calls AI; it emits typed events | ADR-020, ADR-054 item 6 |
| N7 | Captions always show; voice is optional and never the only carrier of meaning | ADR-049, ADR-054 item 8 |
| N8 | No child free text reaches any NPC route (contract v1) | Contract section 7 |

## 2. Roles

Roles are a closed vocabulary (`NpcRole`, `lai/apps/npcs/vocabulary.py`, mirrored in
`contracts/vocabulary.ts`; `test_contract_mirror.py` fails on drift).

| Role | Use in an adventure |
|---|---|
| `GUIDE` | Shows the way, explains the goal |
| `COMPANION` | Travels with the child (Chatty) |
| `QUEST_GIVER` | Offers quests through `OFFER_QUEST` |
| `STORYTELLER` | Narrates story beats |
| `TEACHER` | Frames a learning objective; never grades |
| `MERCHANT` | Reserved vocabulary; no real-money or purchase pressure ever (CLAUDE.md section 12) |
| `INTERACTIVE` | Reacts to taps and events |
| `AMBIENT` | Background life; no required interaction |

A new role is a contract change made by the NPC Manager's integrator, not by an adventure.

## 3. Behaviours

Behaviour profiles are global, keyed and validated in Django (`NpcBehaviorProfile`,
`behaviors.py`). Types: `stationary`, `wander`, `patrol`, `follow`, `guide`, `reactive`,
`scripted`. Rules:

- Pick an existing profile or author a new one in Django Admin; never hard-code movement in a
  scene.
- Under reduced motion, wander and patrol stand still and facing turns snap.
- An NPC never blocks the only route to an objective, never chases, and never times the child.
- `follow` and `guide` must leave the child free to stop; there are no play-time limits (ADR-053).

## 4. Dialogues

| Element | Rule |
|---|---|
| Structure | `NpcDialogue` (trigger, mode, age bands, conditions, priority, once per child) > `NpcDialogueNode` (text, emotion, animation state, optional audio, `allowAiHint`, `allowedTopic`) > `NpcDialogueChoice` |
| Triggers | Closed set mapped to existing signals: `on_spawn`, `on_player_near`, `on_interact`, `on_adventure_start`, `on_return_visit`, `on_challenge_start`, `on_correct_answer`, `on_incorrect_answer`, `on_treasure_found`, `on_quest_complete`, `on_adventure_complete` |
| Conditions | Closed set evaluated only on the server (`ALWAYS`, `AGE_BAND`, `WORLD_CHANGE`, `QUEST_STATUS`, `FIRST_VISIT`, `RETURN_VISIT`, `LOCAL_FLAG`, `RELATIONSHIP_AT_LEAST`); malformed conditions fail closed |
| Choice actions | Closed, non-rewarding set: `NONE`, `END`, `SET_LOCAL_FLAG` (NPC-local only), `OFFER_QUEST` (the child accepts by their own tap), `REQUEST_HINT` |
| Copy | Plain text, readable aloud, localizable, no em dashes, no blame words, per-age-band length limits. Unprompted lines are a non-modal ambient bubble with no dismissal timer |
| Incorrect answers | Encouraging and calm; never shaming (CLAUDE.md section 1) |

## 5. Personas and AI-assisted dialogue

| Mode (`DialogueMode`) | Behaviour |
|---|---|
| `AUTHORED` | Never calls a model. Default for adventures |
| `HYBRID` | Authored nodes, plus AI hints on nodes with `allowAiHint` |
| `AI` | A persona may voice a line around authored nodes |

AI requirements (ADR-044, ADR-054 item 9, [`AI_AND_CHILD_SAFETY.md`](../AI_AND_CHILD_SAFETY.md)):

- Every AI call goes through Django's existing pipeline (`apps.ai` `run_turn`) with a mandatory
  Guardrail, input screening, schema validation, the Django output policy, rate limits and
  server-written audit rows. Never from the browser, never a second AI client.
- Context is built by the server: a versioned, staff-approved `NpcPersona`, the node's
  `allowedTopic`, the age band and a maximum length. Personas and dialogue trees are never sent to
  clients.
- Model output is untrusted, validated, and never changes gameplay state.
- Any failure (AI off, rate-limited, invalid output, Guardrail block) returns the persona's
  authored fallback line with `source: "FALLBACK"`, never an error screen.
- If AI is off (the parent's setting or the service kill switch), the authored fallback is used and
  no AI text is spoken.

## 6. Chatty and every AI-voiced character (CLAUDE.md section 6)

Chatty and every NPC whose lines an AI can shape:

- is warm, curious, playful, concise, and never sarcastic to young children;
- is a guide and co-adventurer, not an authority, parent or teacher replacement;
- may explain, hint, ask learning questions, narrate consequences and celebrate effort;
- never requests private information, encourages secrecy, creates dependency, diagnoses,
  disciplines, or discusses inappropriate topics;
- never says it is human, conscious, lonely, or emotionally dependent on the child;
- never judges what the child has learned (that is the mastery engine's job);
- follows the full boundary list in [`AI_AND_CHILD_SAFETY.md`](../AI_AND_CHILD_SAFETY.md) "Companion boundaries".

These rules apply to authored lines too: staff review authored copy against them before publishing.

## 7. Quest and educational interactions

- An NPC offers a quest with `OFFER_QUEST`; acceptance is the child's tap through the quests API.
  Quest stages, completion and rewards stay in `quests`, `game_sessions`, `inventory` and
  `progression` (see [`quest-standard.md`](quest-standard.md)).
- An NPC may introduce a challenge or react to its outcome (`on_correct_answer`,
  `on_incorrect_answer`), but correctness is decided by Django application code, never by the NPC
  or a model (see [`educational-content-standard.md`](educational-content-standard.md)).
- An NPC hint uses the authored hint ladder first; an AI hint is an optional variation with an
  authored fallback.
- `on_adventure_complete` fires only for a real completion. The contract text still mentions a
  "calm stop" time-out; that path is retired by ADR-053 and no adventure may reintroduce it.

## 8. Animation mappings

- Runtime states: `idle`, `walk`, `run`, `talk`, `wave`, `point`, `celebrate`, `think`, `sad`,
  `laugh`, `jump`. Looping: `idle`, `walk`, `run`, `talk`, `think`.
- Each model variant maps states to its real clip names (`animationMap`). Missing states fall back
  through `ANIMATION_FALLBACKS`, then `idle`. A model with no clips gets a procedural placeholder
  motion, skipped under reduced motion.
- Priority bands: behaviour 0, reaction 1, dialogue 2, scripted 3; crossfade 0.2 s.
- Clip names in the model itself follow the asset vocabulary ([`asset-standard.md`](asset-standard.md) section 7).

## 9. Models and assets

Variants, portraits, recorded lines and extras reference `ContentAsset` rows. A release freezes each
reference to a published version (or a bundled path) in `NpcReleaseAsset` (PROTECT); retiring an
asset an ACTIVE or rollback-able release depends on is refused with a dependency report. The client
resolves through the shared asset resolver and never builds URLs.

## 10. Placement (owner-approved exception to LAI-0805)

ADR-054 item 4 approves an **NPC-only** exception: staff place NPCs with numeric fields in Django
Admin (`NpcPlacement`: Island, Place, optional 3D Area, position, rotation, scale, interaction
radius, spawn conditions), validated against the hierarchy. There is no visual layout editor.
Every other object's layout stays seed-authored (ADR-033 item 4); LAI-0805 stays open. An adventure
must not use this exception to place non-NPC objects.

## 11. Voice

Voiced characters speak through the speech app (ADR-049, Proposed): a `speech.VoiceProfile`, a
server-approved reference only (`npcDialogueNode` from the ACTIVE release), the shared cache and
the Sound Manager's `voice` channel. "Hear it again" appears only when a voice is audible. Muted,
blocked or failed audio shows text only. See [`audio-standard.md`](audio-standard.md).

## 12. Accessibility

Minimums from [`NPC_MANAGER_ACCESSIBILITY.md`](../NPC_MANAGER_ACCESSIBILITY.md): 56 px touch
targets, one-tap activation, modal panel only for a conversation the child starts, labelled
dialog with a polite atomic caption region, focus return, no focus theft, no dismissal timers,
icon plus text prompts for pre-readers, keyboard (Enter, Space, Escape, arrows). Screen reader and
switch access checks on a tablet are owner manual QA.

## 13. Safety restrictions and authored fallbacks

| Situation | Required behaviour |
|---|---|
| No ACTIVE release, or it was retired | Runtime reads answer 200 with no NPCs; the scene plays without managed NPCs, never an error screen |
| Model fails to load | Placeholder box, then animations skipped |
| Dialogue route fails | Calm copy ("Hmm, that did not work. Let us try again.") from `npcUiCopy.ts`; play continues |
| AI unavailable or rejected | Persona's authored fallback line |
| Speech unavailable | Caption only |
| Another family's child | 404 on every child-scoped NPC route |

## 14. Checklist for an adventure's NPCs

- [ ] Every NPC is a `catalog.NpcDefinition` with an NPC Manager character in a published release.
- [ ] Roles, behaviours, triggers, conditions and actions from the closed vocabularies only.
- [ ] No NPC writes progress, rewards, quests or world changes.
- [ ] Authored fallback for every AI-enabled node and persona; AI-off path tested.
- [ ] Chatty rules (section 6) reviewed for every authored and AI-shaped line.
- [ ] Placement through `NpcPlacement` only for NPCs.
- [ ] Animation map set; placeholder and reduced-motion behaviour checked.
- [ ] Captions always shown; voice optional.
- [ ] Empty-release and failure states tested.
