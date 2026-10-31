# Architecture

## System overview

```text
React/Vite client
  |
  | Amplify client libraries
  v
Amplify Auth ---- Cognito parent accounts
Amplify Data ---- AppSync + DynamoDB
Amplify Storage - S3 approved media
Amplify AI Kit -- AppSync AI routes + Amazon Bedrock
Amplify Functions - orchestration, privileged mutations, reports, safety processing
  |
  v
CloudWatch logs and operational metrics
```

## Frontend boundaries

- `app`: providers, routing, bootstrap, global error handling.
- `features/auth`: parent authentication.
- `features/child-profile`: profile selection and parent-managed settings.
- `features/island-map`: the explorable world (Phaser boundary, avatar
  controller, camera, world event bus, interaction/object registry) and
  world state/navigation. See "World engine layering" below.
- `features/adventures`: rendering and adventure state transitions.
- `features/companion`: Chatty presentation, narration queue, AI response display.
- `features/parent-dashboard`: progress summaries and controls.
- `features/safety`: client-safe reporting and fallback UI.
- `lib`: typed clients, runtime validators, logging adapters, utilities.

## Backend boundaries

### Auth
Parent accounts only. Child profiles are application records owned by parent accounts.

### Data
Use owner-based authorization for parent-owned records and explicit group authorization for administrators. Prefer narrow custom operations for actions that update several records atomically or require validation.

### Storage
Use path-based access rules. Store only approved assets and generated artifacts. Do not allow arbitrary public uploads in the MVP.

Defined in `amplify/storage/resource.ts`. Today it holds exactly one kind
of object: the optional photo a parent uploads as a child's profile icon,
under `child-photos/{entity_id}/`, readable and writable only by the
Cognito identity that uploaded it (no guest, blanket-authenticated, group,
or function access). Client-side handling, including the re-encode that
strips EXIF metadata and the deletion guarantees, is specified in
`docs/DATA_MODEL.md` under "Child profile photos".

The second prefix, `assets/*`, holds admin-uploaded game assets for the
Model Asset Manager (ADR-030): Admins group only, one object per version
(`assets/models/<folder>/<assetId>/v<n>/model.glb`), each referenced by an
`Asset`/`AssetVersion` record rather than by path. Runtime resolution goes
through `src/features/assets/assetService.ts`, which falls back to the
bundled `public/models/` file whenever no published S3 asset can be
resolved, so children's regions keep working offline.

### Functions
Potential functions:
- `startAdventureSession`
- `submitAdventureAction`
- `generateCompanionTurn`
- `completeAdventureSession`
- `buildParentSummary`
- `processSafetyEvent`

Functions should be added only when direct Data operations or AI routes cannot safely enforce the workflow.

### AI
Use generation routes for structured, single-turn content such as:
- companion dialogue;
- age-banded hints;
- bounded story variations;
- curiosity-adventure scene content;
- parent-facing summary drafts.

A long-lived conversation route may be evaluated later, but the MVP should favor controlled generation calls tied to explicit adventure steps.

## World engine layering

Per `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 40
and ADR-007 in `docs/DECISIONS.md`:

```text
World Engine (Phaser: movement, maps, animation, collision)
     -> Story Engine (chapters, scenes, narrative state, bounded choices)
     -> Adventure Engine (deterministic challenge progression, validation, hints)
     -> Learning Rules / AI Companion (evaluation / narration, never both)
     -> World State (permanent consequences, unlocks, discoveries)
```

Each layer only talks to its direct neighbors, and only the layer named
"Learning Rules" ever decides correctness. The World Engine communicates
upward through a plain, Phaser-free world event bus (`worldEvents.ts` in
`features/island-map`), not by calling adventure or AI code directly from
inside a Phaser scene.

### Phaser-to-Three.js migration boundary (Phase 31)

`docs/ROADMAP.md` Phase 31 and ADR-008 in `docs/DECISIONS.md` add a second
World Engine presentation, Three.js, alongside Phaser, live at the same
time rather than replacing it (Phaser stays child-facing production until a
Three.js slice reaches parity at Phase 33). Its code lives isolated inside
`features/island-map/three/`, still inside the World Engine's existing
presentation-layer home, and communicates upward through its own
Phaser-free bus, `worldEngineEvents.ts`, mirroring `worldEvents.ts`'s shape
but with its own event vocabulary — the two renderers' event contracts stay
independent for the length of the migration, so neither can accidentally
depend on the other's internals.

Concern-by-concern, each Phase 9-11 Phaser mechanism maps to a Three.js
equivalent:

| Phaser (2D) | Three.js (first-person 3D) |
| --- | --- |
| Tilemaps (`tilemap.ts`) | GLB/glTF kit pieces (`GLTFLoader`, see below) |
| Top-down 8-directional movement | First-person controller (`firstPersonController.ts`) |
| Per-tile collision | 3D collision volumes (`THREE.Box3`, axis-separated resolution) |
| 2D proximity zones (`zones.ts`) | Trigger volumes (`sandboxTriggers.ts`'s `isInsideZone`/`hasApproached`) |
| Sprite animation | `AnimationMixer` clips |

Durable domain state is keyed by the same kind of stable semantic ids on
both sides (`RegionId`, `ZoneId`, `EntityId`, `InteractionId`,
`WorldStateKey` in `worldEngineEvents.ts`), never a Three.js object UUID,
mesh reference, or raw camera transform — the same rule `npcs.ts`/`NpcId`
already follows so a character's identity survives the migration
untouched. Three.js never decides correctness, quest completion, or
rewards, matching Phaser's own constraint above; the one place it reaches
real domain code is `useSandboxBridge.ts`/`npcApproachBridge.ts`, which
call the *existing* `noteCharacterMet`/`recordCharacterMet` rather than
reimplementing it.

**Phase 32** turns this boundary into Welcome Harbor, the first real
Three.js region (`welcomeHarborScene.ts`), and adds one more instance of
the same World Engine/World State direction rule above: checkpoint-based
position saving. A checkpoint's *content* (id, region, x/z, spawn yaw)
lives in `src/features/discovery/checkpoints.ts` — the World State layer,
alongside `ChildWorldState` — not in `features/island-map/three/`, because
a checkpoint is authored persisted state before it is anything about
rendering, and World State must never depend upward on World Engine code.
`welcomeHarborScene.ts` imports that content to place trigger volumes and
resolve a spawn point; `discovery/api.ts`'s `saveCheckpoint` writes
`ChildWorldState.lastCheckpointId` — one authored id, validated on read the
same way `discoveredObjects`/`discoveredCharacters` already are, never a
raw coordinate a client could forge into an out-of-bounds or
inside-a-wall spawn.

**Phase 34** replaces every inline primitive mesh both Phase 32/33 regions
built (`BoxGeometry`, `ConeGeometry`, and so on, constructed directly in the
scene files) with real, external, checked-in `.gltf` assets loaded through
the genuine `GLTFLoader.load()` fetch path, under
`features/island-map/three/assets/` (`primitives.ts`, `gltfAssembler.ts`,
`manifest.ts`, `assetLoader.ts`) and a new `sceneKit.ts` that both region
scene files now share instead of duplicating their camera/renderer/lighting
bootstrap and collider-conversion helper. Full conventions — units, axes,
pivots, collider-proxy decoupling, the animation-clip vocabulary,
LOD/instancing, and why the pack is generated rather than modeled — are in
`docs/THREE_WORLD_ASSET_CONVENTIONS.md`. This is a content/tooling change
inside the existing World Engine presentation layer, not a new
architectural layer: the event bus, semantic-id rule, and World Engine/World
State direction above are unchanged.

## Platform engine boundaries (Phase 18)

`docs/ROADMAP.md` Phases 18-30 name eight platform engines; a ninth,
the Teaching Engine, is introduced by name only at Phase 21, a tenth,
the NPC System, at Phase 23, an eleventh, the Quest Engine, at
Phase 25, and a twelfth, the Discovery Engine, at Phase 26. Each was
added to this list when its phase was
implemented, rather than all at Phase 18. This
section documents each one's responsibility and current implementation
status so that curriculum/mastery/interaction logic and adventure theme
content never bleed into each other (CLAUDE.md's rule that curriculum
logic must never reference theme content, and theme content must never
compute mastery directly).

The "World engine layering" pipeline above (ADR-007) describes one
interaction's data flow through two ends of the same engine: its first
stage, "World Engine," is this engine's presentation half (Phaser today,
Three.js from Phase 31 per ADR-008); its last stage, "World State," is
this engine's persistence half. They are documented separately there
because that diagram is about data flow through *one request*, not about
which engine owns which model.

1. **World Engine** — spatial presentation (movement, maps, camera,
   collision, animation via the world event bus, `features/island-map`)
   and persistent world state (`WorldChange`, `ChildWorldState`,
   `IslandLocation`). Never decides correctness or awards progress; only
   renders and persists consequences other engines hand it.
2. **Story Engine** — narrative structure: chapters, scenes, bounded
   choices, `ChildStoryProgress`. Sits between the World Engine and the
   Adventure Engine. Delivered at Phase 12.
3. **Adventure Engine** — deterministic challenge progression:
   `AdventureTemplate`, `AdventureStepDefinition`, `AdventureSession`,
   `AdventureAction`, `CoopSession`, and step validation
   (`src/features/adventures/engine/validators.ts`). Records raw
   attempt/correctness evidence; never itself decides a skill's mastery
   status.
4. **Learning Engine** — curriculum content. Today, the flat
   `LearningObjective` reference list; from Phase 19, a full
   Subject -> Grade -> Domain -> Skill graph with prerequisites and
   difficulty. Read-heavy: adventures and quests reference its objective/
   skill IDs but never embed their own scoring logic (see confirmation
   below).
5. **Mastery Engine** (`src/features/mastery/`, Phase 20) — `SkillEvidence`
   and `SkillProgress`: turns raw evidence into per-skill status
   (`LOCKED | INTRODUCED | DEVELOPING | PROFICIENT | MASTERED`), an
   error-pattern signal, and prerequisite-unlocking/review-decay rules.
   `upsertSkillProgress` (formerly in `src/features/adventures/api.ts`,
   moved here at Phase 20) is still called only from the Adventure Engine
   (`useAdventureSession.ts`) and the Story Engine
   (`src/features/story/api.ts`) — never from adventure content itself.
   `SkillEvidence`'s own write path (`recordSkillEvidence`) stays in the
   Adventure Engine's `api.ts` for now, not yet moved.
6. **Teaching Engine** (`src/features/teaching/`, Phase 21) — generalizes
   the per-adventure hint ladder (`docs/ADVENTURE_ENGINE.md`,
   `src/features/adventures/engine/hints.ts`) into a reusable, stateless
   lesson-phase and scaffolding-level vocabulary. Owns no data model:
   `deriveTeachingPhase` derives `INTRODUCE | DEMONSTRATE |
   GUIDED_PRACTICE | INDEPENDENT_PRACTICE | APPLICATION | MASTERY_CHECK |
   REVIEW` purely from the Mastery Engine's already-computed
   `MasteryDetail`, and `ScaffoldingLevel` (`CONTEXTUAL_HINT |
   VISUAL_REPRESENTATION | INTERACTIVE_MANIPULATIVE | GUIDED_DEMONSTRATION
   | EQUIVALENT_RETRY_PROBLEM`) is numerically interchangeable with the
   existing 1-5 `hintLevel`/`supportLevel` integers already recorded on
   `AdventureAction`/`SkillEvidence`, verified equivalent in
   `scaffolding.test.ts` against `hints.ts`'s `isGuidedCompletion`/
   `nextHintLevel` rather than duplicating that mechanism. Assistance
   level was already being recorded as mastery evidence before this
   phase (`SkillEvidence.supportLevel`, since Phase 4/17); this phase adds
   the reusable vocabulary on top, not a new recording path.
7. **Interaction Engine** (`src/features/interaction/`, Phase 22) — a
   reusable, adventure-independent interaction contract across six named
   mechanics (`DRAG_SORT`, `SPLIT`, `MEASURE`, `BUILD`, `DECODE`,
   `CONVERSE`), each split into `skillParams` (correctness-only) and
   `presentation` (labels/copy only) rather than one blob, plus themeable
   React components for each and `evaluateInteraction` (deterministic,
   mirrors `validateStepAnswer`). Owns no data model of its own — its
   evidence output (`InteractionEvidence`: attempt, `ScaffoldingLevel`,
   duration, result) is shaped to feed straight into the Adventure/
   Mastery Engines' existing `recordAction`/`recordSkillEvidence`/
   `upsertSkillProgress`. Not yet wired into any live adventure content
   (same "ready for a future phase to consume" precedent as Phases 19-21);
   the existing per-step components (`ChoiceStep`, `OrderingStep`, etc.)
   are unchanged.
8. **NPC System** (`src/features/npc/`, Phase 23) — island characters as
   persistent residents: identity, schedule, dialogue trees, conditional
   dialogue, per-child memory flags, and relationship progression, owning
   `ChildNpcState`. Deliberately split from `src/features/island-map/npcs.ts`,
   which stays the World Engine's *presentation* half (spawn point, palette,
   follow distance): the two are joined only by a stable semantic `NpcId`,
   never a Phaser object reference, so ADR-008's Three.js migration moves
   the body without touching what a character knows. What an NPC says is
   selected deterministically by `selectDialogueNode` from authored content
   and recorded state — never by a model. A node may opt in to Chatty
   re-voicing it via `NpcNarrationHint`, which carries an authored
   `fallbackText` and no child data at all; nothing in this module calls
   Bedrock. `NpcConversation.tsx` is that caller (added after Phase 27): it
   adds age band and length caps, sends only `allowedTopic` and the authored
   line, and re-voices nothing unless the node opted in and the child's own
   profile says AI is on. Which node is shown, which flags are set, and
   whether a quest may be offered are all decided before the call and never
   re-read from it. Quest-giving ships only the offer seam
   (`NpcQuestOffer.questId`); objectives, progression, and rewards belong to
   the Phase 25 Quest Engine, so `QUEST_COMPLETED` conditions stay dormant
   until it exists.
9. **Reward/Economy Engine** (`src/features/rewards/`, Phase 24) — owns
   inventory, item definitions, collectible sets, and reward tables
   (`ChildInventory`), kept distinct from `WorldChange` (a world change is
   not a reward) and from `SkillProgress` (a reward is not proof of
   mastery). Four safety properties hold across the engine, each asserted by
   tests rather than left to convention: **nothing is random** (`resolveRewards`
   is a pure function of trigger and table, so there is no drop chance to
   tune into a compulsion loop — the structural answer to CLAUDE.md pillar
   7's "no loot-box mechanics"); **rarity is descriptive, never a drop rate**
   (it describes how hidden an item is in the authored world, is never read
   during grant resolution, and never ranks children — the explorable-world
   roadmap's section 19 rules out envy and rarity pressure outright);
   **nothing is lost** (no currency, no sink, no consumption, no trading, no
   expiry — the module surface deliberately has no `remove`/`spend`);
   and **not every reward is educational** (`ItemDefinition` has nowhere to
   record a learning objective, per the roadmap's own "some treasure is
   simply treasure" rule). Inventory is a set of owned item IDs rather than
   a quantity map, which rules out duplicate-farming by construction.
   `grantRewards` is idempotent per reward rule, so replaying an adventure
   re-grants nothing.
10. **Quest Engine** (`src/features/quests/`, Phase 25) — owns quest
    definitions, objectives, prerequisites, branching, the journal, and
    `ChildQuestState`. It *composes* the other engines rather than
    duplicating them: the roadmap requires it to complement, not replace,
    `AdventureTemplate`/`AdventureStep`, so a `SOLVE` objective names an
    adventure the Adventure Engine already runs, `COLLECT` names items the
    Reward Engine already granted, `TALK_TO` names a memory flag the NPC
    System already set, and `BUILD` names a `WorldChange` the world already
    recorded.

    The design property that follows: **quest progress is derived, never
    reported.** `isObjectiveComplete` is a pure function of authored content
    and a `QuestContext` snapshot assembled from state that already exists,
    so no call site has to remember to notify the Quest Engine, a child gets
    credit for work done before accepting a quest, and save/resume needs no
    cursor that could drift from the world. `ChildQuestState` therefore
    stores only what cannot be derived: that the quest was accepted, which
    stage it reached, and when it ended.

    Writes to neighbouring engines go through their public APIs only
    (`recordWorldChangeOnce`, `setNpcMemoryFlagsForQuest`, `grantRewards`),
    never their tables, and each is individually failure-tolerant so a
    finished quest cannot revert because a reward write failed. Correctness
    is entirely deterministic; no AI decides whether an objective is done.
11. **Discovery Engine** (`src/features/discovery/`, Phase 26) — owns
    authored secrets (hidden caves, secret passages, locked doors, hidden
    objects), whether one opens for a given child, and the
    `ChildWorldState` record of what has been found and who has been met.

    It composes rather than duplicates, the same way the Quest Engine does:
    a discovery's requirements read the backpack the Reward Engine owns and
    the `WorldChange` log the World Engine owns, and finding one fires
    `grantRewards` (`DISCOVERY` trigger), `recordWorldChangeOnce`, and
    `startQuest`/`syncQuestProgress` through those engines' own public APIs.
    It never writes another engine's table.

    Two properties are structural rather than conventional. **Nothing is
    random**: a secret's requirements and its grants are authored constants,
    so "rare-collectible spawning" means an item that exists in one
    out-of-the-way place, never an item that appears with some probability —
    the Reward Engine's no-loot-box guarantee extends unchanged into
    exploration. **Only authored ids are stored**: both `ChildWorldState`
    columns are closed vocabularies validated on read, so the model cannot
    accumulate child free-text (CLAUDE.md section 13), which is also what
    makes the phase's exploration-telemetry deliverable safe by
    construction — the telemetry record has nowhere to put anything but ids
    and integers.

    It fills the one field `QuestContext` had hard-coded empty since
    Phase 25: `discoveryKeys`, which is what makes the `DISCOVER` quest
    primitive satisfiable.

12. **AI Tutor Engine** (`src/features/companion/` Phase 4,
    `src/features/tutor/` Phase 27) — Chatty's structured generation calls:
    `CompanionProfile`, `AIInteractionAudit`, and the safe-context-builder/
    schema-validation/fallback pipeline (section 7, CLAUDE.md). Never
    determines correctness or mastery; only explains, hints, and narrates.

    Two generation routes, deliberately separate rather than one route with
    more arguments. `generateCompanionTurn` (Phase 4) narrates the island
    and may offer authored choices. `generateTutorTurn` (Phase 27) teaches
    one already-chosen skill with one already-chosen strategy, has no
    `choices` field at all, and carries its own system prompt
    (`amplify/data/tutorPersona.ts`) and its own `promptTemplateVersion` in
    the audit trail. Keeping them apart means neither route's freedoms leak
    into the other.

    Three properties are structural rather than conventional:

    - **The context is the contract.** `TutorContext`
      (`src/features/tutor/types.ts`) is exactly the route's argument list,
      and it has no field for a child profile id, nickname, age, mastery
      status, counts, error pattern, session history, or free text. The
      roadmap's "not a full child profile or history" is therefore a
      property of the schema rather than a promise each caller keeps;
      `buildTutorContext` is the only way to produce one, and a test asserts
      the serialized result contains no mastery status. Prerequisite mastery
      is read (from the Mastery Engine's already-summarized
      `MasterySummary`) only to split prerequisite *titles* into known and
      unknown; the statuses stay behind.
    - **The strategy is not the model's to choose.** `strategyForHintLevel`
      maps the existing 1-5 hint ladder (`docs/ADVENTURE_ENGINE.md`) onto
      the five approved strategies (`ENCOURAGE`, `ASK_GUIDING_QUESTION`,
      `GIVE_HINT`, `SWITCH_REPRESENTATION`, `EXPLAIN`), and
      `validateTutorTurn` rejects any response that answers with a different
      one. There is no `ASSESS`, `SET_GOAL`, or `ADVANCE` strategy to
      reject, because none exists.
    - **The skill boundary is enforced on the output, not just the prompt.**
      A response is rejected if it judges the child (`claimsLearningJudgment`
      in `src/lib/ai/contentSafety.ts` — deciding what a child has learned
      belongs to the Mastery Engine), if it uses a curriculum term outside
      the skill's authored vocabulary (`src/features/tutor/content/`), or if
      it names a representation the curriculum never authored for that
      skill.

    A `SWITCH_REPRESENTATION` turn - the hint ladder's fourth rung - puts an
    authored manipulative from Phase 22's interaction library beside the step
    (`src/features/tutor/content/representationAids.ts`,
    `RepresentationAid.tsx`). It is never graded (no evidence, no progress
    write, no transition) and never AI-authored: the rung and the skill
    choose it, so it appears whether the tutoring call succeeded, fell back,
    or was never made. At most the model names which of the skill's own
    authored representations to use.

    Tutoring is opt-in per skill (`isTutorableSkill`): a skill must be in
    the curriculum graph *and* have an authored vocabulary, so adding either
    one alone never silently opens a new AI surface — the same default as
    `NpcNarrationHint`. Skills outside the seed curriculum keep the Phase 4
    companion path unchanged, and the authored hint ladder is complete
    without either.
13. **Parent/Educator Engine** — the parent-facing reporting surface
    (`features/parent-dashboard`). Has no data models of its own; it
    composes read views over other engines' data (`AdventureSession`,
    `SkillProgress`, `WorldChange`). Expanded with mastery-level and
    next-focus reporting at Phase 30.

14. **World Registry and Travel System** (`src/features/worlds/`,
    Phase 29) — owns the registry of worlds, the rules for which of them a
    child can sail to, the content pack that says what each world contains,
    and the grouped view of one backpack across several islands. Owns **no
    data model**: identity stays `ChildProfile`, inventory stays
    `ChildInventory`, and arriving somewhere is an ordinary `WorldChange`
    written through `recordWorldChangeOnce` (ADR-009).

    It composes rather than duplicates, the same way the Quest and Discovery
    Engines do, and it is the thinnest of the engines on purpose: a world is
    content, so almost everything a new island needs already exists.
    Creature Care Cove, the second world, is three `AdventureDefinition`s, a
    `QuestDefinition`, three `ItemDefinition`s, two `IslandLocation`s, a
    `WorldDefinition`, and a manifest. No engine changed to make it playable,
    though building it did surface two gaps in existing engines that a
    single-world island had never exercised (see
    `docs/IMPLEMENTATION_STATUS.md`, Phase 29).

    Two properties are structural rather than conventional. **A world is a
    package, not a code path**: every id a world owns is listed in its
    `WorldContentPack`, and `packs.test.ts` asserts the union of all packs
    covers every authored registry entry exactly once, so content cannot
    ship belonging to no world or to two. **Reachability is a filter on
    candidates, never a change to ranking**: the Adaptive Adventure Director
    (Phase 28) is handed only adventures on islands the child can reach, so
    `select.ts` keeps its stated boundary ("it ranks, it does not gate")
    while a parent is never shown a suggestion nobody can act on.

`ParentProfile`, `ChildProfile`, and `ParentConsent` belong to none of the
above — they are Account/Platform data (Auth boundary, above), foundational
to every engine rather than owned by one.

### Confirmed: no adventure content embeds mastery-calculation logic

Reviewed for Phase 18: every file under `src/features/adventures/content/`
and `src/features/story/content/` declares steps, validators, and
`learningObjectiveIds` only. The only call sites for `upsertSkillProgress`
in the whole codebase are `src/features/adventures/useAdventureSession.ts`
(Adventure Engine) and `src/features/story/api.ts` (Story Engine), both
passing through the same shared function in
`src/features/adventures/api.ts`. No adventure or story template computes
or writes mastery state itself, so Phase 20 has no template-embedded logic
to migrate.

### Event contracts between engines

Target contracts for the engines above to exchange once each is built.
`WorldStateChanged` already exists today as the `WorldChange` model/event;
the other four are documented now, ahead of their owning engine, so
Phases 19-28 build compatible interfaces instead of inventing this later.

| Event | Producer -> Consumers | Payload (indicative) |
|---|---|---|
| `LearningRequested` | Adventure/Story/Quest Engine -> Learning Engine | `childProfileId`, `domain`/`subject`, `context` (adventure/quest ID) |
| `InteractionCompleted` | Interaction Engine (Phase 22) / Adventure Engine -> Mastery Engine | `childProfileId`, `learningObjectiveId`/`skillId`, `interactionType`, `correctness`, `supportLevel`, `attemptNumber`, `sessionId` |
| `MasteryUpdated` | Mastery Engine -> AI Tutor Engine, Adaptive Adventure Director (Phase 28), Parent/Educator Engine | `childProfileId`, `skillId`, `previousStatus`, `newStatus`, `evidenceCount` |
| `QuestAdvanced` | Quest Engine (Phase 25) -> World Engine, NPC system (Phase 23), Reward/Economy Engine | `childProfileId`, `questId`, `objectiveId`, `questStatus` |
| `WorldStateChanged` | World Engine (persistence half) -> World Engine (presentation half), NPC system, Quest Engine | `changeType`, `changeKey`, `payload`, `sourceSessionId` (today's `WorldChange` fields) |

None of these are implemented as a typed event bus today. `WorldStateChanged`
exists as the `WorldChange` model, and Phase 25 realized `QuestAdvanced`'s
*effects* without the event: `syncQuestProgress` returns the same payload
this row describes (`questId`, newly completed objective IDs, status) and
drives the three consumers directly through their public APIs. The
remaining rows are documentation only, per Phase 18's scope; an actual bus
is still worth introducing if a fourth consumer ever appears.

## State ownership

- Canonical adventure state lives on the server.
- The client may optimistically animate safe presentation changes but cannot award completion or progress without server validation.
- World changes are append-only events where practical, with a derived current world view.
- Learning progress is derived from evidence events, not model opinions alone.

## Environment strategy

- Local developer sandbox through Amplify Gen 2.
- Separate preview environments per branch where practical.
- Production environment with restricted administrator access.
- Secrets stored through Amplify secret management or approved AWS mechanisms, never committed.

## Observability

Track operational metadata without storing unnecessary child content:
- route/function name;
- request correlation ID;
- adventure template and step IDs;
- age band;
- latency;
- model/provider identifier;
- schema-validation result;
- safety disposition;
- fallback reason.

Do not put child names, raw voice, or free-form answers in routine logs.

`AIInteractionAudit` and `SafetyEvent` (`docs/DATA_MODEL.md`) already carry
this metadata as owner-scoped DynamoDB rows, written client-side. Since
that write path has no server-side hook to attach a metric filter to, a
DynamoDB Streams-triggered Lambda (`amplify/functions/operational-metrics/`,
wired in `amplify/backend.ts`) turns each write into a CloudWatch
custom metric, feeding the CloudWatch dashboard and alarms described in
`docs/PILOT_READINESS.md` section 3. This is operational, account-level
visibility, not the per-family admin review workflow
(`docs/AI_AND_CHILD_SAFETY.md` layer 10), which remains a separate, not
yet built, piece.


## Accepted: Three.js is the only gameplay renderer (ADR-020)

Direction in effect; the code has not changed yet. Every playable environment will run on one
Three.js engine in a top-level `game/` package; Phaser and all 2D gameplay rendering will be
removed world by world after parity and visual verification. Today both renderers still
exist, so the "World engine layering" described above remains accurate for the code as it is.
No new Phaser features. React keeps menus, HUD, dashboards, and admin. Detail:
`docs/THREEJS_ENGINE_CONVERSION.md`; decision: ADR-020 in `docs/DECISIONS.md`.

**Engine import boundary (LAI-0203, interim until `game/` exists).** The engine is the `.ts`
modules of `features/island-map/three/` and `features/island-map/scenes/` plus the 2D
geometry modules (`gridGeometry`, `tilemap`, `zones`, `decor`, `*Tilemap`, `*Zones`,
`*Decor`); `.tsx` files there are its React hosts. `src/test/engineBoundary.test.ts`
resolves every import form (static, type-only, re-export, side-effect, `require`, dynamic)
and follows local modules transitively. Packages are deny by default: only `three` (and
`phaser` in `scenes/`) is allowed, so an alias cannot bypass the rule. Forbidden: React,
React DOM and React Router; Amplify and AWS SDKs; `lib/data-client`, `lib/amplify-config`,
`lib/ai/`, `api/` and any feature `api` module; `app/`, `routes/`, `components/`,
`features/auth/`, `features/session/`; any `.tsx` module; anything outside `react/src`. The
host passes the engine plain data and interfaces instead. `KNOWN_VIOLATIONS` is empty since
POST-MERGE-03: every React module in the engine folders is a `.tsx` host file (view extensions,
the view registry, the bridge hooks), the React view registry lives in
`extensions/viewExtensions.tsx` apart from the engine's `extensions/index.ts` (which keeps
only world extensions and the plain id list `viewExtensionIds.ts`), and the region-play
extension's id and config types live in `region-play/regionPlayConfig.ts`, away from the API
types. LAI-2101 applies the same rule to `game/`.

## Proposed backend migration (not in effect)

The architecture above is current and authoritative. A migration from Amplify Gen 2 to
Django + DRF + PostgreSQL, retaining Cognito, S3, React, and the Three.js engine (Phaser is retired by ADR-020), is
**proposed** in ADR-019 (`docs/DECISIONS.md`). Assessment:
`docs/DJANGO_MIGRATION_ASSESSMENT.md`; target: `docs/DJANGO_TARGET_ARCHITECTURE.md`; sequence:
`docs/DJANGO_MIGRATION_ROADMAP.md`. Nothing in this document changes unless ADR-019 is accepted.

## Django API conventions (LAI-0205)

Applies to `lai/` (Django + DRF). The Amplify backend is unchanged until cutover.

**Namespace and versioning.** All routes are under `/api/v1/`, one `include` per app in
`lai/config/urls.py`. Additive changes stay in v1; a breaking change gets a new `/api/v2/` prefix
beside v1. A test fails if a route is added outside `api/v1/`. There is no v2.

**Success responses** are plain JSON, not wrapped (the health body is unchanged).

**Error contract** (all errors, any status):

```json
{
  "error": {
    "code": "validation_error",
    "message": "Invalid request.",
    "details": { "name": [{ "message": "This field is required.", "code": "required" }] }
  },
  "request_id": "d78969a05e7e4d1781bce29f5da105a9"
}
```

`code` is a stable lowercase identifier: `validation_error`, `parse_error`,
`authentication_failed`, `not_authenticated`, `permission_denied`, `not_found`,
`method_not_allowed`, `not_acceptable`, `unsupported_media_type`, `throttled`, `bad_request`,
`server_error`, and `error` for any other DRF error. `message` is a fixed string, never the text of
a raised exception. `details` appears only for validation errors (per-field lists of `message` plus
Django's validation `code`; non-field errors sit under `non_field_errors`). Statuses and the
`Allow`, `WWW-Authenticate`, and `Retry-After` headers are DRF's own. Without any authenticator
installed an unauthenticated request is `403 permission_denied`; once a bearer authenticator exists
(LAI-0402) it becomes `401 not_authenticated` with `WWW-Authenticate`.

**Validation.** Use serializers and `serializer.is_valid(raise_exception=True)`; never hand-build a
400. Reference views are in `apps/core/tests/urls.py`.

**Handler boundary.** `api_exception_handler` covers exceptions raised inside a DRF view. Anything
outside the view lifecycle (unmatched URLs, host validation, middleware errors, unexpected
crashes) is answered by the Django-level JSON handlers (`handler400/403/404/500`) in the same
envelope. Unexpected exceptions are logged with a traceback by `django.request` and return a safe
`500 server_error`. Exception messages are logged server-side, so code must not put child data in
exception text. Limitation: with `DEBUG=True` (local only) Django shows its own HTML debug pages.

**Request IDs.** `X-Request-ID` is accepted from the caller only if it fully matches
`[A-Za-z0-9._-]{8,64}`; otherwise a UUID hex is generated. It is echoed on every response, carried
in the `request_id` of every error body, and attached to every log line. It is for correlation
only and is not an authentication or uniqueness guarantee.

**Logging policy.** One access line per request from `lai.request`: method, matched route pattern
(unmatched requests log `-`), status, duration. Never the raw path, query string, headers,
cookies, tokens, bodies, or user data. `django.request` is limited to ERROR and `django.server`
is discarded so there are no duplicate or query-string-bearing lines. Console only.

**Security defaults.** Deny by default: `IsAuthenticated` is the default permission; only the
health view opts into `AllowAny` (a test fails if any other route becomes public). No session
authentication and no CORS. The one cookie credential is the game session cookie of ADR-036,
accepted only by the game runtime routes ("Native Android clients" below). Cognito bearer-token transport, browser token storage, the CSRF
policy, and XSS considerations are decided in LAI-0402; see ADR-021 on W003. There is no
`docs/SECURITY.md`; security decisions live in ADR-021 and this section.

**Play API (TR-5).** Region-play routes live under `/api/v1/children/<uuid:child_id>/`, are
child-scoped views (`apps/game_sessions/play_views.py`) over `apps/game_sessions/play.py` and
`play_state.py`, and take closed request bodies. The contract is `docs/PLAY_API.md`. Step-based
adventure answers and hints are LAI-0601's (`views.py`, `services.py`); the URL conf lists them
first so the play API's `sessions/<id>/<action>/` route does not shadow them.

## Django identity model (LAI-0301)

Cognito proves identity; `users.ParentAccount` (keyed by the immutable Cognito `sub`) is the
application account and Django's user model; `users.ChildProfile` is a profile a parent manages and
never a login. Child data is reached only through its parent (`apps/users/services.py`). See ADR-022
in `docs/DECISIONS.md` and the mapping in `docs/DATA_MODEL.md`. Django Admin staff are also
`ParentAccount` rows, with an `admin_username` and a local password (ADR-034, "Django Admin" below).

## Authentication architecture (LAI-0401, ADR-024)

Cognito issues tokens; React sends the Cognito **access token** as `Authorization: Bearer`;
Django verifies it against the pool JWKS and resolves `ParentAccount` by the immutable `sub`;
child data is reached only through that parent. No Django sessions, passwords, or cookie
credentials in any AWS environment (local development may use a Django session instead; see
"Environment-selectable provider" below, ADR-038). Today the Amplify SDK keeps tokens in `localStorage` (readable by page JavaScript);
that, onboarding, revocation latency, and the admin design are open gates in ADR-024. Owner decisions of 2026-10-18 approved
explicit `POST /api/v1/me/` onboarding, PyJWT/RS256 verification with a bounded JWKS cache, and
claim-derived administration; sensitive actions stay blocked until LAI-0209.
**Implemented in LAI-0402:** `apps/users/authentication.py` (verifier and DRF authenticator),
`jwks.py` (bounded key cache), `permissions.py` (`IsProvisionedParent` as the API-wide default,
`IsVerifiedPrincipal` for onboarding, `SensitiveActionBlocked`), `views.py` (`/api/v1/me/`). Errors:
401 `not_authenticated` (no credentials) or `authentication_failed` (any invalid token, one
identical body for every cause, `WWW-Authenticate: Bearer`), 503 `authentication_unavailable`
(signing keys unobtainable, fails closed), 403 `account_not_provisioned`, 403
`sensitive_action_unavailable`. Configuration: `COGNITO_REGION`, `COGNITO_USER_POOL_ID`,
`COGNITO_ALLOWED_CLIENT_IDS` (all required in production; empty means every token is rejected).

### Environment-selectable provider (LAI-AUTH-DUAL, ADR-038)

Cognito and Django are interchangeable authentication providers for gameplay APIs, but Django
remains the authoritative application user and authorization system. Django Admin retains Django
session authentication independently.

```text
AWS (AUTH_PROVIDER=cognito)               Local development (AUTH_PROVIDER=django)
React / Android                           React (vite dev, VITE_AUTH_PROVIDER=django)
  -> Amazon Cognito -> access token          -> POST /api/v1/auth/login/ (username, password, CSRF)
  -> Authorization: Bearer                   -> Django session cookie + X-CSRFToken
          \                                       /
           ApiAuthentication (one provider, never a fallback)
                  -> request.user = ParentAccount
                  -> the same permissions, child scoping, play, progress, inventory rules
```

- `AUTH_PROVIDER` (`cognito` or `django`; anything else fails at start-up). Local settings default
  to `django` while `DEBUG` is on. Production requires `cognito` explicitly, and the EC2 release
  fixes it (compose file and image; never from the parameter store).
- `apps/users/authentication.py`: `ApiAuthentication` dispatches to `CognitoJWTAuthentication`
  (unchanged) or `LocalSessionAuthentication`. The local provider accepts only sessions made by the
  local sign-in (`LocalParentPasswordBackend`), never an admin session, and runs Django's CSRF check
  on unsafe methods (403 `csrf_failed`). `request.auth` is a `VerifiedToken` or a `LocalSession`;
  `IsVerifiedPrincipal` accepts either.
- `apps/users/local_auth_views.py`: `GET auth/csrf/`, `POST auth/login/` (400
  `invalid_credentials`), `POST auth/logout/` (204). All three are 404 unless
  `AUTH_PROVIDER=django`. `GET me/` answers "who am I" in both modes.
- Local parents are ordinary `ParentAccount` rows with `cognito_sub = "django-local:<username>"`
  and a Django password, created only by `manage.py create_local_parent` (refused under
  `cognito`). No new model, no migration; Cognito parents keep their `sub` mapping.
- React: `react/src/api/authMode.ts` (`VITE_AUTH_PROVIDER`, default `cognito`; `django` needs
  `VITE_BACKEND=django` and `vite dev`, and a build with it fails), `features/auth/authAdapters.ts`
  (Cognito and Django adapters behind the one `AuthProvider`), `api/session.ts` (CSRF token in
  memory), `api/client.ts` (bearer or session credential, never both).
- Local setup: `docs/TREASURE_RUSH_LOCAL_DEV.md`.

## Tenant isolation (LAI-0403)

One parent is the ownership boundary (no households, no sharing). `apps/users/scoping.py`:
`ChildScopedMixin` (and `ChildScopedAPIView`) resolves `self.child` from `<uuid:child_id>` **through the
authenticated parent** after authentication and permissions, so the order of answers is 401, then
403 (`account_not_provisioned`), then 404. A foreign child and an unknown child take the same code
path and give the same `not_found` response (same status, body, and headers; the same number of
queries). Child-owned records are fetched only with `self.scoped(queryset)` or
`self.get_scoped_object(queryset, pk)`, which add `child=self.child`; a nested id from the URL is never
looked up alone. An `Admins` claim changes nothing here: cross-family administration is a separate,
audited path that does not exist yet (Django Admin registers no child data, ADR-034). The helpers do not secure an endpoint that does not use them; see the
checklist in `docs/TESTING_STRATEGY.md`.

## Logging and privacy (LAI-0208, ADR-025)

**Policy.** Logs say what kind of failure happened and where, never which data was involved. Never in an
application log or error report: tokens (access, ID, refresh), Authorization headers, cookies, Cognito
`sub` values or JWT claims, child nicknames, interests, reading settings or photo paths, parent email,
request or response bodies, query strings, raw URL paths (they contain child ids), database credentials
or statements with parameters, and exception messages. Allowed: method (standard set), matched route
pattern, status, duration, request id, exception type, `file:line:function`, coarse reason codes.

**Paths audited (repository code only).**

| Path | Finding | State |
|---|---|---|
| Access log | Route pattern only; method not sanitized | Method now limited to the standard set |
| DRF exception handler | Fixed messages; logs nothing | Unchanged. Note: some DRF messages echo the submitted value back to the same caller (for example an invalid choice); not logged |
| Django JSON error handlers | Fixed messages | Unchanged |
| Authentication and JWT failures | Reason codes only | Unchanged; tested through the real handler |
| JWKS failures | Exception type name only | Unchanged |
| Model validation | Not yet exposed by any API | Future endpoints must map Django `ValidationError` to the API error contract (LAI-0502) |
| Database exceptions | **Leaked**: PostgreSQL quotes values in the message | Fixed by the formatter |
| Unexpected exceptions | **Leaked**: message in traceback, raw path in Django's line | Fixed |
| Dev server | `runserver` logs query strings | Discarded |
| Logging configuration | **Exposure**: default `django` logger emails reports to `ADMINS` and bypasses our formatter | Handlers removed; `ADMINS` empty |
| Framework reports | Debug pages showed local variables and cookie values | Hidden |
| SQL logging | Would log statements with parameters at DEBUG | Pinned off; root cannot go below INFO |

**Not covered.** Local `DEBUG=True` pages still show the exception message, the URL, and GET parameters, so a
developer running real family data locally can expose it; use synthetic data. Output of management
commands and pytest, Python `warnings` text (a database connection warning names host and user), and any
future third-party library that writes its own logs are outside these controls. Developers can still bypass
them by printing (a test forbids `print(`) or by writing private data into a log *message*; a rule and a
review, not code, prevents that. Not inspected, because no such system exists in the repository: web or
ASGI server access logs, load balancer, CDN, CloudWatch, PostgreSQL server logs, monitoring vendors.
Those are gate G10 (LAI-0210), required before production.

## Content export (LAI-0302)

TypeScript content is exported read-only to `content/` (schema, 11 data files, manifest). The export
runs the existing typed content modules at build time in plain Node: a trusted boundary guarded by a test
that no module it imports reaches React, Amplify, Three.js, Phaser, or an `api.ts`. Django (LAI-0304) and
the future Three.js world loader are the intended consumers; neither exists yet. Details, the hierarchy
mapping, and gaps: `docs/DATA_MODEL.md`.

## Content catalog (LAI-0304)

`lai/apps/catalog` holds World, Location, Adventure, AdventureStep, Quest, ContentAsset, LocationAsset
and ContentRelease, loaded from the export by `manage.py load_content` (idempotent, transactional,
digest-verified, never deletes, never overwrites `active`/`sort_order`). Django becomes the content
authority at the authoring cutover; until then the export is authoritative for content fields. The
catalog admin (`apps/catalog/admin.py`) is registered on the one Django Admin site (LAI-0404, below).
Permissions resolve through `apps/catalog/admin_access.py`, deny by default: active staff and superusers
view everything and edit only `active` and `sort_order`; nobody adds; deletion is superusers only and
closed until the cutover. Spatial layout is not in the catalog (LAI-0805). Model and field detail:
`docs/DATA_MODEL.md`, "Django content catalog".

## Django Admin (LAI-0404, ADR-034)

**Shape.** Django's default `admin.site`, the only admin site, at `/admin/` (`settings.ADMIN_URL_PATH`,
env `DJANGO_ADMIN_URL_PATH`). It is an internal tool for staff. Product admin views (progress
summaries, safety review) stay in the React admin. The admin stack (`admin`, `auth`,
`contenttypes`, `sessions`, `messages`, `staticfiles`) and the session, CSRF, authentication and
message middleware exist for the admin only. The API is unchanged: DRF authenticates with Cognito
bearer tokens alone and never reads a session.

**Who gets in.** Staff sign in with an admin username and a Django password
(`apps/users/backends.py`, the only authentication backend). `AdminSite.has_permission` admits
active staff only; anonymous visitors are sent to the login page and non-staff are refused.
Cognito parents cannot sign in: they have no admin username and a password hash that never
matches. A Cognito group, including `Admins`, never grants access.

| Role | Flags | Can |
|---|---|---|
| Staff | `is_staff` | View every registered catalog page; edit `active` and `sort_order` on worlds, locations, adventures, quests and NPCs |
| Superuser | `is_staff` and `is_superuser` | All of the above, plus the admin-accounts page (activate, deactivate, grant or remove staff and superuser) |

Nobody adds catalog rows (the importer does) or deletes them (closed until the authoring
cutover). Changes are recorded in Django's admin log (`django_admin_log`), which stores object
ids, not names.

**Registered models.** Catalog: World, Location (with scene-asset and adventure inlines),
Adventure (with step inline), AdventureStep, Quest, NpcDefinition, ContentAsset (3D models and
shared assets, with "used by" locations), LearningObjective, ItemDefinition, CollectibleSet,
RewardRule, ContentRelease. Users: Admin accounts (staff rows only, superusers only).
**Not registered, on purpose:** ChildProfile and every child-owned progress model (sessions,
answers, skills, stories, world changes, inventory, quest progress), until an audited
cross-family read path exists (ADR-024 A4). Parent accounts are not listed. Region layouts and
`ChallengeSpec` are seed-authored until LAI-0805 (ADR-033). Things still only in Amplify (the
React admin's uploaded `Asset` records, ADR-030; the island/adventure overlay, ADR-031; safety
review) have no Django models yet and are not in Django Admin; LAI-0801/0802 own them.

**How accounts come to exist.**
1. *Cognito account:* the browser signs up and confirms directly with Cognito (`SignUpForm`,
   `ConfirmSignUpForm`, Amplify Auth). Neither Django nor a Cognito trigger is involved.
2. *Django account:* in a build with the Django API on, `DjangoAccountProvider`
   (`react/src/features/auth/DjangoAccountContext.tsx`) sends `POST /api/v1/me/` once after every
   sign-in. The first call creates the `ParentAccount` from the verified token's `sub`, with no
   admin rights; later calls return it unchanged. The same response carries `django_admin`.
3. *Admin rights:* an operator gives that account an admin login (`create_admin_account
   --cognito-sub`), then sets its role (`set_admin_role`), below.

**Creating the first superuser** (run where `manage.py` reaches the database: locally, or as a
one-off task in the deployed container):

```sh
cd lai && python manage.py migrate
python manage.py create_admin_account <username> --superuser
# prompts twice for the password; it must pass AUTH_PASSWORD_VALIDATORS (12+ characters, not common)
```

- More staff: the same command without `--superuser`.
- **Upgrade a parent who signed up:** they sign in to the app once (step 2), then
  `create_admin_account <username> --cognito-sub <their Cognito sub>` gives that same row an admin
  login (staff), and `set_admin_role <username> superuser` makes it a superuser. Find the sub in the
  Cognito console (user pool, Users, the user's "sub" attribute) or with
  `aws cognito-idp list-users --user-pool-id <pool> --filter 'email = "<email>"'`.
- Change a role later: `set_admin_role <username> superuser|staff|none`, or a superuser edits the
  account on the Admin accounts page. Neither will demote or deactivate the last active superuser.
- Non-interactive, for a container task: `--no-input` with `DJANGO_ADMIN_PASSWORD` set from Secrets
  Manager for that one run only.
- New password: `create_admin_account <username> --reset-password`. This signs out existing sessions.
- Remove access: a superuser clears `is_staff` (or `is_active`) on the admin-accounts page. The change
  applies on the account's next request. `manage.py createsuperuser` deliberately fails and points here.

**Signing in.** Open `https://<django host>/admin/`, enter the admin username and password. Sessions
last at most 8 hours and end when the browser closes. Cookies (`lai_admin_session`,
`lai_admin_csrftoken`) are scoped to the admin path, HttpOnly, SameSite=Lax, and Secure in production.

**React link.** `POST /api/v1/me/` (the sign-in call above) returns `django_admin: true` for active
staff. The account menu's "Admin" item goes to `VITE_DJANGO_ADMIN_URL` only when the build sets that
variable and has the Django API on (`VITE_BACKEND=django`) and Django returns true. Otherwise the existing `/admin` link for the
Amplify `Admins` group is unchanged. Django Admin checks its own sign-in either way.

**Known limitations.** Separate credentials from Cognito, with no MFA on the Django login yet (a
Cognito-backed admin sign-in is the upgrade path, TR-D5 option a). No throttling of failed admin
logins in the application (add WAF rate limiting at the load balancer, or a lockout, before exposure). There is no Django deployment yet;
hosting and approvals are in `docs/DJANGO_TARGET_ARCHITECTURE.md`, "Django Admin hosting".

## Shared asset manager (LAI-2200, ADR-035)

Upload a 3D model once, publish an immutable version, and every island, region, adventure or quest
uses it by its stable asset id. Detail and the full contract: `docs/ASSET_MANAGER.md`.

- **Definition** is `catalog.ContentAsset` (one identity; CLAUDE.md section 20), now creatable in
  Django. **Versions** are `assets.AssetVersion`: immutable once published, unique per asset,
  stored under server-made keys (`assets/models/<id>/<version uuid>/model.<glb|gltf>`).
- **Validation** (`apps/assets/validation.py`) checks GLB or self-contained glTF from the bytes,
  with bounded reads, no external URIs, no decoder-only compression, structural bounds, clips and
  dimensions. It runs on upload and again on publish (with a checksum re-check).
- **Storage** (`apps/assets/storage.py`) is S3 in production (private, checksummed, never
  overwritten), local disk in development, memory in tests.
- **Admin**: definitions and versions in Django Admin, gated by Django permissions through the
  "Asset editors" and "Asset publishers" groups (`manage.py ensure_asset_roles`).
- **Resolution**: `GET /api/v1/children/<child_id>/assets/?ids=` (child-scoped; published only;
  `resolved`, `unavailable` or `retired`). **Delivery** is a self-authorizing URL: a signed Django
  route that re-checks publication on every fetch, or an S3 presigned URL. It is the second route
  without a bearer token, and it carries a signed capability for one published version.
- **Frontend**: `react/src/api/assets/djangoAssetResolver.ts`, an `AssetResolver` for the LAI-2106
  loader that falls back to the bundled manifest. It is not wired into a scene yet (TR-10).
- **Admin 3D preview** (AM-10): a read-only Three.js viewer on each version's admin preview page,
  for validated, published and retired versions. The file comes from a separate admin route that
  needs a staff session and a short-lived token sent in a header, so the gameplay route stays
  published-only. The viewer source is `react/src/features/assets/preview/`, bundled into the
  `assets` app's static files (`docs/ASSET_MANAGER.md` section 17).

## Child progress (LAI-0305)

`game_sessions`, `education`, `progression`, `inventory` and `quests` hold child progress, every
record owned by one child through `core.ChildOwnedModel` and read only through `for_child` or the
`ChildScopedMixin` helpers. Progress points at retained catalog rows (PROTECT) and records the
adventure version and content release it started on, so imports never reset it. Python owns the
transitions (ADR-019 sub-decision 8): the `services` modules accept rule results from server code
only, and no endpoint exists yet. Detail: `docs/DATA_MODEL.md`, "Django child progress".

## Authoritative adventure answers (LAI-0601)

The first child-data endpoints. `apps/adventures/engine.py` is the Python adventure engine
(`validate_step_answer`, `next_step_id`, `next_hint_level`, `hint_text`, `decide_submission`,
`is_step_answer`), a port of the TypeScript engine that passes every case in
`tests/golden/adventure-engine.json`, including the JavaScript semantics a port must keep
(`undefined === undefined`, no bool-number coercion, JS truthiness and array indexing).
`apps/game_sessions/services.submit_answer` grades and applies an answer on one row-locked session
in one transaction.

- `POST /api/v1/children/{child_id}/sessions/{session_id}/answers/` with
  `{stepId, answer, requestId}` returns `{correctness, supportLevel, action, nextStepId,
  attemptNumber, replayed, session}`; the first four fields keep `submitAdventureAnswer`'s shape.
- `POST /api/v1/children/{child_id}/sessions/{session_id}/hints/` with `{stepId, fromLevel}`
  returns `{hintLevel, hintText, session}`.
- The roadmap's `/sessions/{id}/answers` became child-scoped so LAI-0403's rule (the child comes
  from the URL, resolved through the parent) holds. Bodies are camelCase, matching the Lambda.
- The client sends what the child did. Correctness, hint level, next step and completion are the
  server's: the hint level is the server's per-step record (`AdventureSession.hint_levels`), so the
  Lambda's weakness, where a client-supplied `hintLevel` of 4 reached guided completion on any
  wrong answer, does not exist here. Reaching a COMPLETE step or the reserved `complete` id
  completes the session in the same transaction.
- `requestId` (ADR-015's design, stored on `AdventureAction` with a per-session unique constraint)
  makes retries safe: a repeat returns the stored outcome with `replayed: true`; a reused id with a
  different answer is `409 request_conflict`; a fresh request after the step moved is
  `409 step_not_current`. A hint request moves the level only from `fromLevel`, so it cannot
  escalate twice.
- No content snapshots exist: a session whose adventure version changed, or whose current step is
  not in the adventure's latest import, is refused with `409 content_version_changed` and left
  intact rather than graded against different content.

**G6 verification (2026-10-24), from the code and its tests, for these endpoints:** authentication
is required (401 with no or a bad token; `IsProvisionedParent` default); parents reach only their own
children (`ChildScopedMixin` resolves the child through the parent); another family's child, a
sibling's session and an unknown session all give the same 404 and write nothing; unauthenticated
and unprovisioned requests cannot mutate; an `Admins` group token gets no cross-family access, and
the scoping helpers never read group claims; `is_staff` is unused; LAI-0403's route checker
(`test_every_real_route_is_public_parent_scoped_or_child_scoped`) covers the new routes. Outcome:
**satisfied for these child-owned endpoints**. G6 stays a per-endpoint obligation: every future child
endpoint must use the same helpers and pass the same checklist.

## Consolidated Django backbone (POST-MERGE-03, ADR-033)

One implementation per responsibility, from the Storykeeper Castle line, with Treasure Rush
adapted onto it:

| App | Owns |
|---|---|
| `core` | API conventions, privacy logging, `ChildOwnedModel` (with the cross-child link check), `content_schema` validator, `ContentStatus` |
| `users` | `ParentAccount`, `ChildProfile`, Cognito authentication, child scoping |
| `catalog` | Imported content: World, Location, Adventure, AdventureStep, Quest, ContentAsset, LocationAsset, LearningObjective, NpcDefinition, CollectibleSet, ItemDefinition, RewardRule, ContentRelease; the one importer (`load_content`); asset references (`asset_refs.py`); the catalog admin (mounted by LAI-0404); ContentAsset is also the asset definition (LAI-2200) |
| `assets` | Asset manager (LAI-2200, ADR-035): AssetVersion, validation, storage, publication services, the published-asset resolver and delivery routes, the import and audit commands. No identity of its own: versions attach to `catalog.ContentAsset` |
| `regions` | Seed-authored play regions: WorldRegion, SpawnPoint, WorldObjectPlacement, TreasureChest; `seed_treasure_rush` |
| `adventures` | The Python adventure engine (pure module, LAI-0601) |
| `game_sessions` | AdventureSession (ADVENTURE or REGION), AdventureAction, ChallengeAttempt, CoopSession; answers and hints (LAI-0601); region play (TR-5); native home, discovery and inventory reads, game launch tickets and the game session cookie (LAI-ANDROID-API-001, ADR-036) |
| `education` | SkillEvidence, SkillProgress, StoryArtifact, ChallengeSpec; Treasure Rush challenge generation and grading (`challenges.py`) |
| `progression`, `inventory`, `quests` | World changes and state, story and NPC progress; items owned and rules granted; quest progress, with the server-side quest engine (`quests/engine.py`) |

**Temporary source-of-truth boundary for spatial data.** Location manifests for the shipped 3D
regions stay in TypeScript (`runtime/manifests/*.ts`, ADR-032). The Treasure Cove layout is
authored in `lai/apps/regions/treasure_rush_seed.py` and applied as `regions` rows that the play
API serves; the client builds a manifest from them (TR-D15). Neither is Django layout
administration: LAI-0805's ADR decides that. Everything non-spatial, including Treasure Rush's
quest, item and reward rule, is exported and imported like all content.

## Native Android clients and the game-only WebView (LAI-ANDROID-API-001, ADR-036)

The Kotlin app is a client of the same Django API as the React app. There is no Android backend
and no Android data model. Its native screens use the Cognito bearer contract (LAI-0402) and
these client-neutral routes: `POST /me/` provisioning; child profile list, create, read and
update (`apps/users/views.py`; deletion stays blocked); child `home/`, `regions/`,
`regions/<id>/adventures/` and `inventory/` (`apps/game_sessions/native_views.py` over
`discovery.py`). All of them read the canonical catalog, region and progress rows.

The standalone Three.js game runs in a WebView with **no Cognito token**. The native app gets a
single-use, 60-second ticket (`children/<id>/game-launches/`), then redeems it with its bearer
token (`game-launches/redeem/`) for an HttpOnly, Secure, SameSite=Strict cookie scoped to
`/api/v1/`, which it copies into the WebView. That cookie (`apps/game_sessions/runtime_auth.py`)
authenticates only the runtime's own routes (`game-session/`, `game-session/end/`) and the play
and asset routes that mix in `GameRuntimeAccessMixin`, and only for one child and one region.
Writes need the `X-LAI-Game-CSRF` header. It never reaches account, child, launch, progress or
discovery routes. A structural test in `apps/users/tests/test_tenant_isolation.py` pins the route
list. Contract: `docs/android/ANDROID_API_CONTRACT.md`, `ANDROID_AUTH_FLOW.md`,
`ANDROID_GAME_LAUNCH.md`. The `/game/` bundle itself is a frontend deliverable that does not exist
yet.

## Content export contract (post-merge note)

The content export is at `schemaVersion: 3` (version 2 added adventure skill metadata and `START_STORY`; version 3 adds `locationAssets`). It reads the `ALL_NPCS` registry, not a single region's cast. Details: `docs/DATA_MODEL.md`. ADR numbers 027 to 030 are the Storykeeper Castle / Wonderwild / Clockwork decisions (formerly 019 to 022 on that line).
