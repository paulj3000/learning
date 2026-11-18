# Adventure Standard

- **Status:** Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-002, ADR-005, ADR-011, ADR-020, ADR-027, ADR-033, ADR-041, ADR-045, ADR-047, ADR-050 (Proposed), ADR-051, ADR-053, ADR-054; pending merge: ADR-056 to ADR-060, ADR-063
- **Canonical sources:** [CLAUDE.md](../../CLAUDE.md) (sections 1 to 7, 11 to 15, 19, 20), [docs/ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md), [docs/engine/04_ADVENTURE_AND_STORY_INTEGRATION.md](../engine/04_ADVENTURE_AND_STORY_INTEGRATION.md), [docs/engine/05_QUEST_NPC_DISCOVERY_INTEGRATION.md](../engine/05_QUEST_NPC_DISCOVERY_INTEGRATION.md), [docs/DATA_MODEL.md](../DATA_MODEL.md), [docs/PLAY_API.md](../PLAY_API.md)

An adventure is a structured gameplay and educational experience: a child-facing goal, one or
more learning objectives, a story, and a visible consequence in the world (CLAUDE.md section 1).
This standard lists what every adventure must define. Write it down in the
[adventure specification template](templates/adventure-specification.md) and get owner approval
before building.

## What an adventure is in the code

There is no single "adventure" row. A **primary adventure** is the experience a child chooses as a
destination and plays in a Place's 3D Area. It is assembled from canonical records:

| Part | Record |
|---|---|
| Where | A Place (`catalog.Location`) in a Realm (`catalog.World`), and its 3D Area (`regions.WorldRegion`) |
| Goal and stages | One or more quests (`catalog.Quest`) |
| Activities | Area puzzles, chests and challenge specs, pickups, discoveries, step adventures (`catalog.Adventure`) started from launch points |
| Consequences | `progression.WorldChange` keys |
| Rewards | `catalog.RewardRule`, `ItemDefinition`, `inventory.InventoryItem` |
| Characters | `catalog.NpcDefinition` and NPC releases (ADR-054) |

A **step adventure** (`catalog.Adventure`, CLAUDE.md's `AdventureTemplate`) is a step graph played
in the adventure UI. It can be a challenge inside a primary adventure or a card-route activity on
a Place page. Terms and mappings: [realm standard](realm-standard.md#terminology-mapping).

### Examples and their status (2026-11-18)

| Adventure | Shape | Status |
|---|---|---|
| Treasure Rush, "Pip's Missing Treasure" | Pirate Builder Bay's 3D Area `treasure-rush-cove`: Pip's quest, four chests (hidden, locked with a key, rune-stone puzzle), finale, bridge, replay | Implemented (main), development complete and unit tested; browser journey TR-9 not done. |
| Treasure Rush, "Pirate's Leap" | Optional platforming course in the same 3D Area, with an optional riddle | Pending merge (`feature/pirates-leap`) |
| Firepeak Volcano, "The Volcano Awakens" | Place and 3D Area `firepeak-volcano`, Professor Ember, five-stage quest, five area puzzles, Discovery Journal | Implemented (main), Pathfinders and Explorers only (FP-D2); owner played it locally; automated browser scenarios not run. |
| Storykeeper Castle, "the Great Storybook" | Realm-level quest `restore-the-great-storybook`, step adventures per band, derived pages, room discovery | Implemented (main) in part; later SC-R tasks open; jumping not needed (owner, 2026-11-18) |
| North Pole, "The Missing Christmas Star" | New Realm `north-pole` (ADR-080, Reserved on `main`, branch only), Place and 3D Area `north-pole-village`, nine quests | Pending merge (`feature/north-pole-adventure`), in development |

## Required elements

### Realm association
State the Realm and Place, and whether the adventure needs a new Place or 3D Area. A Place has at
most one 3D Area (ADR-041). A new Realm or Place needs the [realm standard](realm-standard.md) and
owner approval (CLAUDE.md section 5: new locations are not MVP scope unless approved).

### Identity
Child-facing title, one-line premise, ticket prefix (TR-, FP-, SC-R, NP- precedent), and ids for
the Place, 3D Area, quests, puzzles, change keys and rewards, following the
[identifier rules](realm-standard.md#identifiers). Check ids are unused before approval.

### Educational objectives
Name existing `LearningObjective` codes, or propose new ones through the
[educational content standard](educational-content-standard.md). Learning must fit the story
(Firepeak: earth science, "no unrelated arithmetic"). Correctness is decided by application code
on the server, never by AI or the 3D engine (ADR-002, ADR-020).

### Age bands
Declare which of Sprouts (3-4), Pathfinders (5-6) and Explorers (7-8) are supported, and what
differs per band: reading volume, response mode, number ranges, steps per stage, session length
guidance (CLAUDE.md section 3). Differences live in content (per-band parameters, specs,
dialogue), never in engine branches. A band that is not supported is not shown the adventure
(Firepeak excludes Sprouts for now). ADR-008's Sprouts validation gate applies to 3D play for
Sprouts.

### Story progression
A beginning (an NPC asks for help), a middle (stages that each change something), and an ending
that changes the world. Stories that run step adventures keep one progress record per story
(ADR-027). Copy is readable aloud, localizable, without em dashes. Fiction and fact are labelled
(Firepeak's Heart Crystal is fiction; North Pole's Star is "island magic").

### Environment design
Zones with a clear purpose, landmarks visible from the spawn point, a default spawn and
checkpoints at each zone entry. Layout is seed- or manifest-authored (LAI-0805); new layout
fields go into the shared manifest or `scene` schema, not into adventure code. Special behaviour
goes behind a registered extension id ([engine doc 03](../engine/03_GENERIC_3D_WORLD_RUNTIME.md)).
Gates are world-change gated solid colliders.

### NPC interactions
Use NPC Manager definitions and releases (ADR-054) and the [NPC standard](npc-standard.md). NPCs
offer quests and step adventures; dialogue is authored with AI only as a constrained,
validated variation with a code fallback (CLAUDE.md sections 6 and 7). No open chat.

### Quest structure
Follow the [quest standard](quest-standard.md). World progress gates the world; quests narrate it.

### Challenges
Follow the [challenge standard](challenge-standard.md). Each stage has at least one learning or
exploration challenge; at least one adaptive hint path per adventure (CLAUDE.md section 11).

### Movement
Shared controller only. Walking speed, footprint and camera come from the shared player stack
(pending merge for running, camera, avatar and footprint). No per-adventure movement code.

### Jumping
Jumping is a shared game-engine capability that an adventure may enable; it is not required
(owner direction 2026-11-18). Storykeeper Castle and the Storybook adventures do not need it. The
specification says whether the adventure uses jumping. Where it does: reuse the shared
controller, keep an accessible non-jump route for all required progress, recover safely, lose no
progress and add no timers. See the [jumping standard](jumping-standard.md); until the movement
branches merge, jumping work stacks on them.

### Exploration
Reward curiosity with discoveries, secrets and optional areas (the castle tapestry nook, North
Pole's ice cave on its branch). A secret is refused by the server like something that does not
exist until it is unlocked (ADR-051). Hidden things never hold required progress.

### Collectibles
Collectibles are `COLLECTIBLE` placements with a pickup change key and optional reward rule,
recorded once on the server. Optional unless a quest objective names them.

### Scoring
No points economy. See the [scoring standard](scoring-standard.md).

### Rewards
Keepsakes, badges and journal entries are catalog items granted once by reward rules. The world
change is the main reward (ADR-005).

### Audio
Sound cues by logical id through the Sound Manager; Django owns cue assignments (ADR-050, Proposed);
speech only from server-approved references (ADR-049, Proposed). Missing audio never blocks play. See the
[audio standard](audio-standard.md).

### Accessibility
Follow the [accessibility standard](accessibility-standard.md): keyboard and touch, non-spatial
equivalents, reduced motion, text for all speech, clear exits, no time limits.

### Failure recovery
Wrong answers: kind feedback, another go, hints that step up. Falls and hazards: back to the
latest checkpoint. Nothing earned is ever removed; no lives, no game over, no timers (ADR-053).

### Replayability
After completion the adventure stays open. Replay activities (`REPLAY` chests, practice replays)
are repeatable and grant nothing permanent. Optional jump routes and secrets give reasons to
return without pressure.

### Progress persistence
All progress is server state on canonical models: `WorldChange`, `WorldState` (last checkpoint,
discoveries), `QuestProgress`, `AdventureSession` (with pinned content revisions),
`ChallengeAttempt`, `PuzzleAttempt`, `InventoryItem`, `SkillEvidence`, `SkillProgress`. Never
persist raw coordinates or Three.js state as the canonical save ([engine doc 05](../engine/05_QUEST_NPC_DISCOVERY_INTEGRATION.md)).
Leaving and returning resumes at the furthest checkpoint with everything kept. No new progress
model for one adventure (ADR-033).

### Parent-facing progress
Parents see skills practised and activities completed, summarised by skill, never transcripts or
child free text (CLAUDE.md section 11 item 10). The spec states which learning objectives the
adventure reports.

### Assets
Placeholder-first with stand-ins; no binaries committed without the asset process. Staff publish
assets in Django Admin (ADR-045); content references assets by id. Licences recorded. See the
[asset standard](asset-standard.md).

### Performance
Runs on a tablet. The spec states its budgets (draw calls, lights, model and texture sizes) and
the device it was checked on. Storykeeper Castle's provisional target is 30 fps in its heaviest
room on a tablet at MEDIUM and under 8 s to the first walkable frame
([castle acceptance](../regions/storykeeper_castle_acceptance.md)); there is no platform-wide
approved budget yet. The runtime disposes renderers, listeners, audio and extensions on exit,
with repeated mount and unmount tests.

## Build rules

- Smallest coherent change; reuse the generic runtime, `region-play`, the quest engine, reward
  service, NPC Manager and Sound Manager.
- Never combine a backend domain change with a world conversion in one task (CLAUDE.md section 19).
- No Phaser features; new playable environments are Three.js (ADR-020).
- Content through the export and `load_content`; Django authoritative after import (ADR-047).
- No deployment, no production data change, no AWS change without explicit owner approval.

## Acceptance criteria checklist

Specification and approval
- [ ] Adventure specification written from the template, reviewed against these standards, and approved by the owner (date recorded on the card).
- [ ] Realm, Place, 3D Area and every id stated and checked for collisions.

Learning and age bands
- [ ] Learning objectives named and fitted to the story; correctness decided on the server.
- [ ] Supported age bands declared, with per-band differences in content only.
- [ ] At least one adaptive hint path; authored fallback for every AI-varied line.

Gameplay
- [ ] Clear child goal, stages, and an ending that records a visible world change.
- [ ] Quests, challenges and rewards use canonical models; no second catalog, loader or progress model.
- [ ] Jumping use stated (yes or no). If yes: shared controller, meaningful jump route named, every required step reachable without jumping, safe recovery, no lost progress, no timers.
- [ ] Exploration, collectibles and secrets are optional and recorded once.
- [ ] Replay available after completion; replay grants nothing permanent.

Safety and wellbeing
- [ ] No timers, lives, loss on failure, streaks, leaderboards, currencies or random rewards.
- [ ] Exits always reachable; no challenge on any exit.
- [ ] No child free text, names or identifiers in logs or analytics.

Accessibility and presentation
- [ ] Keyboard and touch paths for everything; non-spatial equivalents tested.
- [ ] Reduced motion, text for speech, readable and localizable copy without em dashes.
- [ ] Audio optional; assets resolved by id with working stand-ins.
- [ ] Performance budget stated and checked on the stated device, or listed as deferred.

Verification
- [ ] Development checks run per [docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md) and recorded with real results: unit tests for authorization, state transitions, age adaptation, idempotent grants and resume.
- [ ] Anything deferred to merge readiness (browser, Playwright, full suites, build) listed.
- [ ] `docs/IMPLEMENTATION_STATUS.md` and the adventure's roadmap updated.
- [ ] Owner QA completed per age band; status words kept apart (development complete, unit tests passed, owner QA required, accepted, merged, deployed).
