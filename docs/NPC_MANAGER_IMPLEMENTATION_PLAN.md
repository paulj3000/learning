# NPC Manager implementation plan (LAI-NPC-001 to LAI-NPC-040)

Branch: `feature/npc-manager` (from `main` at `5222b69`). Decision: ADR-054. Frozen contracts:
`docs/NPC_MANAGER_CONTRACTS.md`. Tracker: `tasks/TASK_TRACKER.md`, Phase 30.

Scope rules from the owner's brief: no merge to `main`, no AWS deployment, no browser or
Playwright runs (the owner performs browser acceptance), no live Bedrock or Polly calls without
explicit approval, and no claim that any of those were verified.

## 1. Repository findings (audit, 2026-11-05)

| Area | Found on `main` | Consequence |
|---|---|---|
| NPC identity | `catalog.NpcDefinition` (`npc_id`, display name, role text, home Place, interaction id; dialogue, schedule, quest offers kept in `source`) imported from `content/exported/npcs.json` (6 NPCs: `pirate-pip`, `keeper-quill`, `bolt`, `ember-dragon`, `harbor-master`, `professor-ticktock`) | ADR-033 forbids a second catalog: the NPC Manager extends it (owner decision A) |
| Places and 3D Areas | `catalog.World` (Island), `catalog.Location` (Place), `regions.WorldRegion` (3D Area, one per Place, ADR-041); NPC placement today is a seed-authored `regions.WorldObjectPlacement` (`kind=NPC`) | Spatial administration is LAI-0805: NPC-only exception approved (owner decision B) |
| Relationship state | `progression.NpcRelationship` (points, level, quest memory flags, seen nodes) written by `game_sessions.play.talk_to_npc` | Reused read-only; NPC-local flags kept separately so dialogue can never set a quest flag |
| Treasure Rush | Play API (`docs/PLAY_API.md`): region bootstrap, session start/resume, chest challenge, answer, pickup, talk, quest accept; rewards via `inventory`, world changes via `progression`, quests via `quests` | NPC triggers map onto these; no second reward or quest engine |
| Pirate Pip (React) | Rendered by `createLocationEngine.ts` as a manifest NPC (`npc-pip` glTF, clips Idle/Talk/Wave), reactions in `regionPlayScene.ts`, lines hard-coded in `regionPlayUi.ts` `PLAY_COPY` and `PipDialog.tsx`; clues on chest rows | Pip's lines move into authored NPC dialogue; chest clues stay chest content |
| Storykeeper's Castle | Three.js castle via generic `LocationWorldPage` and `manifests/storykeeperCastle.ts`; Keeper Quill (`keeper-quill`, asset `npc-quill`) talks through client-side `NpcConversation.tsx` (`features/npc`, Amplify state). The Great Storybook is only on unmerged `origin/adventures/storybook` | Integrate Quill on main's castle; the Great Storybook is out of scope (not on this branch) |
| Asset Library | `ContentAsset` + immutable `AssetVersion` (DRAFT to PUBLISHED to RETIRED), resolver `GET children/<id>/assets/?ids=`, signed delivery, admin GLB preview bundle; `validate_asset_ref` checks existence and kind only; retirement does not check usage | NPC releases freeze published versions and record dependencies; retirement gains a dependency guard |
| Sound and speech | `main` has only a silent `playCue` stub. `origin/feature/sound-manager` (23 commits) has the Sound Manager (channels, captions, scopes), Django `audio` (cues, releases) and `speech` (Polly behind a fake, `VoiceProfile`, `npcNode` references) | Merged into this branch first (owner decision C, commit `c2393ad`); reused, not duplicated |
| AI | `apps.ai` pipeline: `run_turn(child, TurnSpec)`, fake/Bedrock/disabled providers, input screening, schema and boundary validation, Guardrail handling, usage limits, `AIInteractionAudit` without text; NPC narration context `load_npc_narration` | NPC hints add one route through `run_turn`; no second client or safety path |
| Tests and checks | pytest (PostgreSQL, `make up`), Vitest, `tsc -b`, Ruff, Prettier, `adr:check`; `docs/TESTING_STRATEGY.md` "When to run which checks" | Development runs targeted tests; full gates at merge readiness |

Defects found and fixed on the way: the sound-manager merge's public-route convention test did not
list the signed speech-file route (`fe9c905`); the ADR-045 registry title regressed in the merge
(`33cdede`).

## 2. Reuse

`NpcDefinition` (identity), `WorldRegion`/`Location`/`World` (hierarchy), `ContentAsset` and
`AssetVersion` with the resolver and signed delivery, the admin GLB preview bundle,
`ChildScopedAPIView` and `GameRuntimeAccessMixin` (authorization), `progression`/`quests`
(authoritative progress), the Sound Manager and `useSpeech` (playback, captions, ducking),
`speech` (voices, Polly, cache), `apps.ai` (`run_turn`, safety, limits, audit),
`createLocationEngine` asset loader and clone helpers, `lib/motionPreference.ts`.

## 3. Models, API and runtime contracts

Defined and frozen in the foundation commit; see `docs/NPC_MANAGER_CONTRACTS.md` sections 1 to 7.
All NPC tables are created by the single foundation migration `npcs/0001_npc_manager_foundation`
(plus `catalog/0006_npc_definition_origin`), so no workstream touches the migration chain.

## 4. Task dependency graph

```text
001 -> 002 -> 006 -> 034 ─┬─> A: 003 -> 004 -> 005, 035; 036
                          ├─> B: 007 -> 008 -> 009; 008 -> 014
                          ├─> C: 011 -> 012 -> 013, 017
                          ├─> D: 019 -> 020 -> 021, 022, 023 -> 024; 025 (after 005)
                          ├─> E: 026 -> 027 -> 028 (needs 011) -> 029 (needs 014, 009)
                          └─> F: 030 (needs 011) -> 031 -> 032 (needs 012) -> 033
Integration (Treasure Rush): 010 (005, 007-009, 012) -> 018; 015 (014, 029); 016 (013, 023)
Production: 037 (008, 009, 021), 038 (014, 029), 039 (007, 008, 012), 040 (all)
```

## 5. Parallel worktree plan

Foundation (serial, integrator): 001, 002, 006, 034 and the frozen contracts, committed on
`feature/npc-manager` before any agent starts.

| Wave | Worktree branch | Tasks | Notes |
|---|---|---|---|
| 1 | `feature/npc-manager/admin` | 003, 004, 005, 035, 036 | Django only |
| 1 | `feature/npc-manager/runtime` | 007, 008, 009, 014 | Django read API and React engine/UI |
| 1 | `feature/npc-manager/dialogue` | 011 (services), 012, 013, 017 | Django dialogue engine and React controller |
| 1 | `feature/npc-manager/behavior` | 019 to 025 | React behaviour engine, Django validation and preview |
| 2 | `feature/npc-manager/voice` | 026 to 029 | After the runtime merge (needs 009, 014 on the branch) |
| 2 | `feature/npc-manager/ai` | 030 to 033 | After the dialogue merge (needs conversation state) |
| 3 | integration (serial) | 010, 015, 016, 018, 039, 037, 038, 040 | Integrator, on `feature/npc-manager` |

Concurrency limit: 4 agents. Each agent works only in its own worktree, owns the files listed in
the contracts (section 8), uses its own PostgreSQL test database name (`POSTGRES_DB=lai_npc_<ws>`,
so `test_lai_npc_<ws>` never collides), and commits on its own branch. The integrator merges in
dependency order: foundation, admin, dialogue, runtime, behavior, then voice and AI, running
migrations checks and targeted tests after each merge.

## 6. Risks and acceptance gates

| Risk | Mitigation |
|---|---|
| Two NPC truths (export `source` dialogue and NPC releases) | The NPC Manager wins at runtime for published characters; export dialogue untouched; content authoring cutover decides later |
| Pip regression in Treasure Rush (duplicate Pip, duplicate rewards, lost resume) | Pip keeps one entity; rewards stay in play services; integration tests assert one Pip and unchanged reward counts |
| Sound-manager branch is still Proposed (ADR-048 to 050) | Recorded as a dependency; NPC speech degrades to captions when speech is disabled |
| Unverified runtime visuals | No browser runs here; owner acceptance checklist; engine logic covered by unit tests with a fake loader |
| Live AWS | Fake Polly and fake model only; live checks listed as owner-approval items |

Gates: foundation gate (migrations from a fresh database, model and publishing tests), each
workstream gate (its tests, typecheck when TypeScript changed, Ruff on changed Python), the
Treasure Rush integration gate (no duplicate Pip or rewards), and final regression (full Python
and Vitest suites, typecheck, build, Ruff, Prettier, `adr:check`; no Playwright).

## 7. Treasure Rush integration (LAI-NPC-010, 015, 016, 018)

**Pip as content.** `lai/apps/npcs/pip_content.py` holds Pip's character, `classic` variant
(`npc-pip`, animation map limited to the model's clips Idle/Talk/Wave), the stationary
`pip-landing` behaviour with reactions, the `cove-pip` placement on Treasure Cove's legacy Pip
spot, and twelve dialogues migrated from `PLAY_COPY`/`PipDialog` (greet, mission with
`OFFER_QUEST`, hints, find, quest and adventure completion, return visit, a condition-free
fallback). Since SM-P8-LIVE, `seed_speech_voices` creates a `pirate-pip` voice profile (Justin, neural):
run it before `seed_npc_pip` and a new Pip is voiced; an existing voiceless Pip gets it with
`seed_npc_pip --attach-voice` (never replacing a voice staff chose). Seed and publish locally:

```bash
cd lai
python manage.py load_content
python manage.py seed_treasure_rush
python manage.py seed_npc_pip --publish          # create-only; a rerun reports unchanged
python manage.py seed_npc_pip --hybrid-hints     # optional, first run only: persona + AI hints
```

**Scene host.** `react/src/features/npc-manager/host/useNpcSceneHost.tsx` is world-agnostic: a
world passes `{childId, scope, scene: NpcHostScene, reducedMotion, suspended, onInteract,
onQuestOffer, onSound}` and renders the returned `prompt` and `panel`; it calls `notifyPlay` with
play outcomes and reads `managedNpcIds`, `interact(npcId)` and `positionOf(npcId)`.
Storykeeper's Castle can reuse it unchanged (scope `{kind: 'place'}` or its Area).

**One Pip, with a fallback.** When the host serves `pirate-pip` for `treasure-rush-cove`, the
manifest Pip is handed over (`RegionPlaySceneApi.setNpcProxy`: hidden, its focusable root follows
the managed Pip so focus, taps and the "Things to do here" list still reach him) and `PipDialog`
is not used. When it serves nothing (no active release: `200` with `release: 0`, a retired release, Django off, any
load failure), the legacy Pip and `PipDialog` keep working unchanged. A managed Pip whose model
fails to load stands as the runtime placeholder.

**Play outcomes.** `useRegionPlay` reports every outcome (`onOutcome`, observation only);
the companion forwards them, plus new world changes, to `notifyPlay`. The calm stop's session
completion is not treated as the adventure's completion. Ambient lines wait while any other panel
is open and only the most important trigger of an outcome is asked for (`host/triggerQueue.ts`).
Talking to the managed Pip still makes the play API's `talk` call first (it may finish the quest),
and `OFFER_QUEST` accepts through the existing `POST quests/<id>/accept/` flow.

**Sound.** Voice through `useNpcVoice` (voice channel, captions always, mute and interruption
honoured, disposed on unmount). NPC moments (`npcGreet`, `npcInteract`, `npcTalk`, `npcLeave`)
play whatever staff assigned to that NPC's `on_approach`, `on_interact`, `on_dialogue_start` or
`on_exit` event in the region's audio manifest; silent without an assignment.


## 8. Storykeeper's Castle integration (LAI-NPC-039)

**Scope.** The castle has no 3D Area in Django (no `regions.WorldRegion`); it is the Place
`storykeeper-castle`. Keeper Quill is therefore a Place-level placement (`area: null`) and the
client uses the host's `{kind: 'place', placeSlug: 'storykeeper-castle'}` scope. The Great
Storybook stays out of scope (unmerged branch).

**Quill as content.** `lai/apps/npcs/quill_content.py` (reusing Pip's `Dialogue`/`Node`/`Choice`
specs) holds Quill's character on the canonical `keeper-quill` NpcDefinition (role
`STORYTELLER`, authored mode), the `storykeeper` variant (`npc-quill`, animation map limited to
the model's clips: idle, talk, wave, point, celebrate, and `sad` -> `ReactConcerned`), the
stationary `quill-story-hall` behaviour (faces the child; wave on tale start/resume, celebrate on
completion), the `castle-quill` placement on the manifest spot (x -4.5, z 0, facing the entry
hall), the existing `keeper-quill` voice profile from `seed_speech_voices` when present, and six
dialogues migrated from Quill's current lines: the first meeting with the
`tell-a-story-together` offer (`OFFER_QUEST`, Pathfinders and Explorers), a Sprout greeting, what
every story needs, a return visit, the "story told" line on `on_adventure_complete`, and a
condition-free fallback. `seed_npc_quill` has `seed_npc_pip`'s guarantees (create-only, staff edits
survive, validates, rerun `unchanged`). Releases are global, so publishing carries Pip too:

```bash
cd lai
python manage.py load_content
python manage.py seed_speech_voices            # optional, so Quill keeps his voice
python manage.py seed_treasure_rush            # only if Pip is wanted in the same release
python manage.py seed_npc_pip                  # optional, idem
python manage.py seed_npc_quill --publish      # one release with every READY character
```

**Wiring (castle files only, the host unchanged).** `castleTaleScene.ts` gains the same optional
`npcHostScene` / `setNpcProxy` / `isNpcProxied` members as Treasure Cove's scene.
`useCastleNpcs.tsx` mounts `useNpcSceneHost` for the Place; while it serves `keeper-quill`, the
manifest Quill is handed over (hidden, its root following the managed Quill, so focus, taps and
his positional voice still reach him) and `castle-tale` claims his `TALK_TO`
(`castleNpcHandover.ts`), so the host's conversation opens instead of the generic panel's
`NpcConversation`. Exactly one Quill. With no release, Django off or any load failure nothing is
handed over or claimed and the legacy Quill is unchanged.

**Progression kept.** Talking to the managed Quill first records the opening node the legacy
conversation would have shown (`recordDialogueNode`: `metQuill`, friendship), and his
`OFFER_QUEST` accepts through the castle's existing quest flow (`startQuest` +
`syncQuestProgress`), only for the giver and the quest's bands (`castleNpcProgress.tsx`). The tale,
the secret door story, their sessions, hints and world changes are untouched. The tale starting
or resuming and completing are passed to `notifyPlay` as play outcomes; Quill's lines wait while
the tale or story card (or another panel) is open, and a tap on Quill mid-tale is let go.

**Deferred.** The castle's own gestures (`playQuillClip`: Talk/Point after a chat, pointing at the
mantel on hint rung 3, the calm-stop look at the nook, concern after a wrong plate order) still
target the manifest Quill, which is hidden while handed over; the managed Quill only reacts
through behaviour reactions. Forwarding them needs a host API (for example
`animate(npcId, state, facing?)`), owned by the host workstream. Wrong-answer reactions are not
forwarded (the castle's answers are Adventure Engine results, not play API outcomes). Quill's
dialogue conditions cannot read the castle's Amplify quest or world-change state, so the quest
offer is once per child rather than "until started".

The castle host hook and progress module are `.tsx` files: under `island-map/three/`, `.ts` files are
engine modules that may not import React or API clients (ADR-020, `src/test/engineBoundary.ts`),
the same convention as the castle speech hook.
