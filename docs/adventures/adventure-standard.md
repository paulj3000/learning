# Adventure Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-002, ADR-004, ADR-005, ADR-009, ADR-011, ADR-013, ADR-016, ADR-020, ADR-027, ADR-033, ADR-041, ADR-047, ADR-053, ADR-054

An Adventure is a mission a child plays to help a character and change the world: "Repair the
Moonlight Bridge", "Pip's Missing Treasure", "The Volcano Awakens". This standard is the checklist
every new Adventure meets. Propose one with
[templates/adventure-specification.md](templates/adventure-specification.md); the headings below
follow that template's order.

Core promise: learning makes the island grow. Every Adventure combines a clear child-facing goal,
age-appropriate learning objectives, a visible consequence in the world, safe and constrained AI
personalization, and encouragement without manipulation or shame. **Binding:** CLAUDE.md §1

## 1. Realm association

- An Adventure belongs to exactly one Place (`Adventure.location`) in one Realm
  (`Adventure.world`), and to that Realm's content pack. **Binding:** ADR-009, ADR-041 (decision C)
- In a Place with a 3D Area, the Adventure is launched from an object through an
  `AdventureLaunchPoint` of the same Place. **Binding:** ADR-041 (decision C)
- A new Place or Realm is a scope addition and needs an owner decision. See
  [realm-standard.md](realm-standard.md).

## 2. Identity

| Field | Rule |
|---|---|
| `slug` | Lowercase kebab-case, unique, stable forever (`repair-the-moonlight-bridge`) |
| `title` | Child-facing, short, readable aloud, no em dashes. **Binding:** CLAUDE.md §13 |
| `version` | Bumped by content changes; a session records `template_version` and never changes it |
| `entry_step_id` | First step for a step-based Adventure |
| `skill_domain`, `skill_level` | From the curriculum vocabulary |
| Trello ticket | `LAI-<AREA>-<NNN>` ([../engineering/trello-workflow.md](../engineering/trello-workflow.md)) |

Two shapes exist on `main`:

| Shape | Played as | Example |
|---|---|---|
| Step-based Adventure | `AdventureSession` with `kind = ADVENTURE`, steps from `catalog.AdventureStep` | Repair the Moonlight Bridge |
| 3D Area adventure | `AdventureSession` with `kind = REGION`, a Quest with stages, chests and `AreaPuzzle`s in the 3D Area | Pip's Missing Treasure (Treasure Cove), The Volcano Awakens (Firepeak) |

## 3. Educational objectives

- Name one to four learning objective codes from the curriculum vocabulary. Every graded step or
  Challenge records evidence against one of them.
- The objective must be the point of the activity, not a gate in front of it. Do not insert
  unrelated arithmetic (Firepeak FP-D5, FP-D6).
- Rules for objectives and copy: [educational-content-standard.md](educational-content-standard.md).

## 4. Age bands

| Band | Ages | Decisions | Session length | Skills |
|---|---|---|---|---|
| Sprouts | 3 to 4 | One-step, voice-first, picture-first | about 5 to 8 min | vocabulary, classification, cause and effect, emotions, counting, observation |
| Pathfinders | 5 to 6 | Two or three steps, narrated text | about 8 to 12 min | phonemic awareness, early reading, number sense, sequencing, patterns |
| Explorers | 7 to 8 | Multi-stage, more reading | about 10 to 18 min | comprehension, arithmetic, measurement, science reasoning, creative writing |

**Binding:** CLAUDE.md §3. Session lengths are design targets, never enforced limits.
**Binding:** ADR-053

- Declare `age_bands` on the Adventure (and `WorldRegion.age_bands` for its 3D Area). A band that
  is not supported is not shown (Firepeak excludes Sprouts, FP-D2).
- Band differences live in content parameters, never in engine branches.

## 5. Story progression

- Adventure first: the child experiences a mission, not a lesson menu. **Binding:** CLAUDE.md §4
- A step-based Adventure is a directed graph of typed steps; AI may vary presentation but may not
  create transitions. **Binding:** ADR-002, [../ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md)
- A 3D Area adventure is a Quest whose stages each complete on one server-recorded world change
  ([quest-standard.md](quest-standard.md)).
- Story chapters played inside a 3D Area keep the Story Engine as sole owner of story progress.
  **Binding:** ADR-027
- Use the specification's "Story progression" section to list beats, the consequence of each,
  and where the child goes next.

## 6. Environment design

- Three.js only for any new playable environment. **Binding:** ADR-020, CLAUDE.md §19
- Layout is seed-authored (`lai/apps/regions/*_seed.py`) or a TypeScript manifest; non-spatial
  copy and environment settings are Django revisions. **Binding:** ADR-033, ADR-047
- Every walkable area has bounds, solid colliders for walls and barriers, and a default spawn
  point (`SpawnPoint`).
- The consequence is visible on return: the world is rebuilt from the child's world changes
  (Treasure Cove's bridge is laid on later visits from `TREASURE_COVE_QUEST_COMPLETE`).
- Placeholder art uses shaped stand-ins until a model is published in the Asset Manager
  (Firepeak FP-3). See [asset-standard.md](asset-standard.md).

## 7. NPC interactions

- Characters are `catalog.NpcDefinition` identities, configured and published through the NPC
  Manager. **Binding:** ADR-054
- Chatty and every NPC follow the companion rules: warm, concise, never requesting private
  information, never claiming to be human. **Binding:** CLAUDE.md §6
- No open-ended child chat. **Binding:** ADR-004, CLAUDE.md §12
- Details: [npc-standard.md](npc-standard.md).

## 8. Quest structure

Offer a Quest from an NPC or object (`WorldRegion.offered_quests`); the child accepts. Use only
objective kinds the Django engine can prove. See [quest-standard.md](quest-standard.md).

## 9. Challenges

Every graded activity is graded on the server, has a hint ladder, an authored fallback and an
accessible alternative. At least one adaptive hint path per Adventure. **Binding:** CLAUDE.md §7,
§11 (item 7). See [challenge-standard.md](challenge-standard.md).

## 10. Movement

- Walking uses the shared first-person controller
  (`react/src/features/island-map/three/firstPersonController.ts`). Do not write per-adventure
  movement or physics.
- Running, sprinting and a third-person camera are pending merge (PR #29, ADR-058 Reserved;
  PR #27, ADR-056 Reserved). Design so the Adventure works in first person.

## 11. Jumping

Every primary free-roaming 3D Adventure meaningfully integrates jumping, with an accessible
alternative for required progress (proposed). The shared jump controller is pending merge
(PR #26, ADR-063 Reserved). See [jumping-standard.md](jumping-standard.md).

## 12. Exploration

- Reward curiosity with optional discoveries (`progression.WorldState` discoveries, `DISCOVER`
  objectives) and optional areas, never required for completion.
- Hidden content is refused by the server exactly like content that does not exist (ADR-051
  pattern for secret rooms).

## 13. Collectibles

Collectibles are `catalog.ItemDefinition` rows, optionally in a `CollectibleSet`; owned or not,
no quantity, no drop chance. **Binding:** ADR-013. See [scoring-standard.md](scoring-standard.md).

## 14. Scoring

No XP, coins, levels, points or leaderboards. Achievement is skill evidence and world change.
**Binding:** ADR-011, CLAUDE.md §4 (pillar 7). See [scoring-standard.md](scoring-standard.md).

## 15. Rewards

- Through `catalog.RewardRule` only: deterministic, idempotent, server-granted.
- At least one persistent world change after the Adventure. **Binding:** CLAUDE.md §11 (item 8),
  ADR-005

## 16. Audio

Sound through logical cue ids in the Sound Manager, speech through server-approved references,
captions always. Missing audio never blocks play. See [audio-standard.md](audio-standard.md).

## 17. Accessibility

Meets [accessibility-standard.md](accessibility-standard.md) in full: exits never gated, no time
limits, readable-aloud copy, keyboard and touch, reduced motion, panel alternatives.

## 18. Failure recovery

- No lives, no game over, no timers. **Binding:** ADR-053 (timers)
- Wrong answers: try again with the next hint rung.
- Hazards and falls: back to the last safe checkpoint, nothing lost (Firepeak FP-D10 on `main`).
- Network or AI failure: the authored fallback is shown. **Binding:** CLAUDE.md §7
- A typed, safe error message for every failure the child can see. **Binding:** CLAUDE.md §13

## 19. Replayability

- A completed Adventure can be played again. Replay records skill evidence and grants nothing
  permanent (Treasure Rush `REPLAY` chest, TR-D29).
- Vary numbers by server seed (`ChallengeSpec`) or question pool (Question Studio) rather than
  repeating the same answer.
- The Director lowers the rank of recently played and completed Adventures (ADR-016).

## 20. Progress persistence

| What | Where |
|---|---|
| Session and current step | `game_sessions.AdventureSession` (pins its content revisions, LAI-0813) |
| Step attempts | `game_sessions.AdventureAction`, `ChallengeAttempt`, `PuzzleAttempt` |
| Quest stage | `quests.QuestProgress` |
| World consequence | `progression.WorldChange` |
| Items | `inventory.InventoryItem`, `inventory.GrantedRule` |
| Learning | `education.SkillEvidence`, `education.SkillProgress` |

- All of it is server state, child-scoped (`ChildOwnedModel`), resumable on any device.
- No new progress model for one Adventure. **Binding:** ADR-033, CLAUDE.md §20
- Do not log child free text, audio, names or identifiers. **Binding:** CLAUDE.md §13

## 21. Parent-facing progress

- The parent dashboard shows the Adventure's skills and status in plain language, not
  transcripts. **Binding:** CLAUDE.md §11 (item 10)
- Explain what was learned and why an AI response appeared. **Binding:** CLAUDE.md §4 (pillar 6)

## 22. Assets

Reference assets by stable id only; binaries live in the Asset Manager. **Binding:** ADR-035,
ADR-045, ADR-047 (decision I). See [asset-standard.md](asset-standard.md).

## 23. Performance

- The target device is a tablet. **Binding:** CLAUDE.md §11 (item 13)
- Proposed: the specification states a draw-call and texture budget and the QA build records
  frame rate on a tablet. Numeric budgets are an owner decision; none are set today (Treasure
  Rush TR-13 lists tablet draw calls as pending browser acceptance).
- Use stand-ins and shared materials; load published models through the asset resolver.

## 24. Implemented examples on `main`

| Adventure | What to copy |
|---|---|
| Repair the Moonlight Bridge (Pirate Builder Bay) | Step graph, hint ladder, `BRIDGE_REPAIRED` world change ([../ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md)) |
| Pip's Missing Treasure (Treasure Cove) | Chests, locked chest and key, ruins puzzle, bridge consequence, `REPLAY` spyglass ([../TREASURE_RUSH_ROADMAP.md](../TREASURE_RUSH_ROADMAP.md)) |
| The Volcano Awakens (Firepeak Volcano) | `AreaPuzzle` kinds, per-band parameters, panel alternative, safe hazard respawn ([../FIREPEAK_VOLCANO_ROADMAP.md](../FIREPEAK_VOLCANO_ROADMAP.md)) |
| Storykeeper Castle | Eight-room Three.js castle, ADR-027 story progress ([../regions/STORYKEEPER_CASTLE_REBOOT_ROADMAP.md](../regions/STORYKEEPER_CASTLE_REBOOT_ROADMAP.md)) |

Not on `main`: Heart of Firepeak (`feature/firepeak-volcano-adventure`), North Pole
(`feature/north-pole-adventure`), Castle Director (`feature/storykeeper-castle-completion`),
Pirate's Leap (PR #38). Do not copy from them until they merge.

Browser acceptance and owner playtesting of these examples are still pending in their roadmaps;
"on `main`" means implemented and unit-tested, not accepted.

## 25. Acceptance criteria

- [ ] Specification complete, owner decisions recorded, Trello card linked.
- [ ] Belongs to one Place and Realm content pack; content-pack tests pass.
- [ ] Learning objectives named; every graded result writes evidence.
- [ ] Age bands declared; band differences in content parameters only.
- [ ] Server grades every Challenge; hint ladder and authored fallback present.
- [ ] At least one persistent world change visible on return.
- [ ] Rewards through `RewardRule`; idempotency tested.
- [ ] Shared controller only; jumping integrated with an alternative (once PR #26 merges).
- [ ] Accessibility standard met; exits ungated; no timers.
- [ ] NPCs, audio and assets through their managers.
- [ ] Authorization tests: another family's child gets 404 on every endpoint used.
  **Binding:** CLAUDE.md §10
- [ ] Tests for state transitions, age adaptation and AI validation where AI is used.
  **Binding:** CLAUDE.md §11 (item 14)
- [ ] Development checks run per [../TESTING_STRATEGY.md](../TESTING_STRATEGY.md); merge gates
  deferred and listed.
- [ ] `docs/IMPLEMENTATION_STATUS.md` updated. **Binding:** CLAUDE.md §14
- [ ] Owner QA with [../engineering/templates/qa-checklist.md](../engineering/templates/qa-checklist.md);
  done per [../engineering/definition-of-done.md](../engineering/definition-of-done.md).
