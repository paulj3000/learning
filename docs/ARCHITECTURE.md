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

## Platform engine boundaries (Phase 18)

`docs/ROADMAP.md` Phases 18-30 name eight platform engines; a ninth,
the Teaching Engine, is introduced by name only at Phase 21, and a tenth,
the NPC System, at Phase 23. Each was added to this list when its phase was
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
   Bedrock, so a Phase 27 caller adds age band and length caps from its own
   safe-context builder. Quest-giving ships only the offer seam
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
10. **AI Tutor Engine** — Chatty's structured generation calls:
    `CompanionProfile`, `AIInteractionAudit`, and the safe-context-builder/
    schema-validation/fallback pipeline (section 7, CLAUDE.md). Never
    determines correctness or mastery; only explains, hints, and narrates.
    Formalized as a contextual tutor bounded to current quest/skill/hint
    level at Phase 27.
11. **Parent/Educator Engine** — the parent-facing reporting surface
    (`features/parent-dashboard`). Has no data models of its own; it
    composes read views over other engines' data (`AdventureSession`,
    `SkillProgress`, `WorldChange`). Expanded with mastery-level and
    next-focus reporting at Phase 30.

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

None of these are implemented as typed code today except `WorldStateChanged`
(as `WorldChange`); this table is documentation only, per Phase 18's scope.

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

