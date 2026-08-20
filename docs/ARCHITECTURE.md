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
the Teaching Engine, is introduced by name only at Phase 21 and added to
this list when that phase was implemented, rather than at Phase 18. This
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
7. **Interaction Engine** — not yet built (Phase 22). Will own the
   reusable cross-adventure interaction contract (drag/sort/measure/
   build/decode/converse) so gameplay mechanics are not re-implemented
   per adventure.
8. **Reward/Economy Engine** — not yet built (Phase 24). Will own
   inventory, collectibles, and reward tables, kept distinct from
   `WorldChange` (a world change is not a reward) and from
   `SkillProgress` (a reward is not proof of mastery).
9. **AI Tutor Engine** — Chatty's structured generation calls:
   `CompanionProfile`, `AIInteractionAudit`, and the safe-context-builder/
   schema-validation/fallback pipeline (section 7, CLAUDE.md). Never
   determines correctness or mastery; only explains, hints, and narrates.
   Formalized as a contextual tutor bounded to current quest/skill/hint
   level at Phase 27.
10. **Parent/Educator Engine** — the parent-facing reporting surface
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

