# NPC Manager implementation plan (LAI-NPC-001 to LAI-NPC-040)

Branch: `feature/npc-manager` (from `main` at `5222b69`). Decision: ADR-050. Frozen contracts:
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
| Sound-manager branch is still Proposed (ADR-047 to 049) | Recorded as a dependency; NPC speech degrades to captions when speech is disabled |
| Unverified runtime visuals | No browser runs here; owner acceptance checklist; engine logic covered by unit tests with a fake loader |
| Live AWS | Fake Polly and fake model only; live checks listed as owner-approval items |

Gates: foundation gate (migrations from a fresh database, model and publishing tests), each
workstream gate (its tests, typecheck when TypeScript changed, Ruff on changed Python), the
Treasure Rush integration gate (no duplicate Pip or rewards), and final regression (full Python
and Vitest suites, typecheck, build, Ruff, Prettier, `adr:check`; no Playwright).
