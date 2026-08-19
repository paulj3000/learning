# Adventure Engine

## Purpose

The engine turns authored adventure templates into adaptive, replayable experiences. It controls correctness, progression, learning evidence, AI context, and world consequences.

## State-machine approach

Each adventure is a directed graph of typed steps.

Supported MVP step types:
- `NARRATIVE`
- `CHOICE`
- `NUMBER_INPUT`
- `ORDERING`
- `MATCHING`
- `SHORT_RESPONSE`
- `CREATIVE_CHOICE`
- `REFLECTION`
- `WORLD_CHANGE`
- `COMPLETE`

AI may vary presentation inside a step but may not create unauthorized step transitions.

## Step contract

```ts
interface AdventureStep {
  id: string;
  type: AdventureStepType;
  objectiveIds: string[];
  presentation: PresentationSpec;
  allowedActions: AllowedAction[];
  validator: ValidatorSpec;
  transitions: TransitionRule[];
  hintPolicy: HintPolicy;
  aiPolicy?: AIPolicy;
  fallback: FallbackPresentation;
}
```

## Adaptation

Adaptation should be modest and explainable:
- reduce the number of choices;
- add narration;
- show manipulatives or visual groups;
- lower number magnitude;
- break a task into smaller steps;
- increase hint specificity;
- provide a worked example using different values;
- offer a creative route when exact correctness is not necessary.

Do not silently jump children far above or below their selected age band.

## Hint ladder

1. Encouragement and restatement.
2. Attention cue.
3. Strategy hint.
4. Partial scaffold.
5. Guided completion.

Supported completion still counts as participation, but should not be recorded as independent mastery.

## Example adventure: Repair the Moonlight Bridge

### Goal
Help Pirate Pip repair a bridge before the moon rises.

### Skills
- counting sets;
- addition within age-appropriate range;
- comparing lengths;
- following ordered instructions.

### Flow
1. Inspect the broken bridge.
2. Count missing planks.
3. Choose bundles totaling the needed number.
4. Order planks shortest to longest.
5. Read or listen to three repair instructions.
6. Place the final plank.
7. Persist `BRIDGE_REPAIRED` world change.
8. Unlock the path across Pirate Builder Bay.

### AI role
- vary Pirate Pip and Chatty's dialogue;
- produce hints at the requested hint level;
- narrate the visual consequence;
- generate a short parent summary from structured evidence.

### Deterministic role
- calculate correct totals;
- validate order;
- control transitions;
- award completion;
- persist evidence and world change.

## Co-op sessions (household only)

See `docs/DECISIONS.md` ADR-006 and `docs/DATA_MODEL.md` `CoopSession`. Two
children under the same `ParentProfile` can share one adventure instance.
Only step types with an unambiguous, conflict-free merge rule are
coop-eligible in v1: `NUMBER_INPUT`, `ORDERING`, `MATCHING`, and
shared-construction `WORLD_CHANGE` steps (for example, placing a plank in a
specific slot). `CHOICE`, `SHORT_RESPONSE`, `CREATIVE_CHOICE`, and
`REFLECTION` stay single-child even inside a coop session, since they
represent one child's own answer or idea rather than a shared construction —
the other child's client shows a presence signal ("child B is answering"),
never the response itself, and that step's evidence is recorded only against
the child who answered.

**Conflict resolution:** each shared slot is claimed atomically by whichever
child's validated action reaches the engine first. A second child's action
targeting an already-filled slot is rejected server-side; that client
re-renders the already-updated `CoopSession.sharedState` rather than
surfacing an error. No client ever overwrites another child's already-valid
contribution.

**Implementation (Phase 17, `src/features/adventures/useAdventureSession.ts`
+ `src/features/coop/`):** correctness and transitions stay completely
untouched by coop status — `validateStepAnswer`/`getNextStepId` never take a
`coopSessionId`. The only addition is that, whenever a coop-eligible step
(`isCoopEligibleStepType`, `src/features/coop/types.ts`) is answered
`correct` while a `coopSessionId` is present, `useAdventureSession` fires a
fire-and-forget call to `claimCoopSlot` keyed by that step's own `id` —
same "never gates `advance`" invariant as every existing AI/companion call
in that function. `claimCoopSlot` is a function-backed custom mutation
(`amplify/functions/claim-coop-slot/`) rather than a plain
`CoopSession.update()`, specifically so its DynamoDB write can carry a
`ConditionExpression` on that exact slot path — the actual mechanism behind
"first write wins, second write rejected, not surfaced as an error." One
adventure is wired end-to-end as the proof: "Repair the Moonlight Bridge"
(`src/features/adventures/content/repairTheMoonlightBridge.ts`), whose
`count-planks` (`NUMBER_INPUT`), `order-planks` (`ORDERING`), and
`bridge-repaired` (`WORLD_CHANGE`, literally "placing a plank in a specific
slot") steps are the first real coop-eligible slots in the codebase. No
adventure content had to change — the mechanism is generic across any
coop-eligible step type in any adventure once a `coopSessionId` is passed
in.

## World entry points (Phase 9+)

Starting with `docs/ROADMAP.md` Phase 9, an adventure can also start from a
`WorldInteraction` fired inside the explorable world
(`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 8),
not only from a location's card/route. The flow:

```text
Child approaches an interaction zone in a Phaser scene
        -> world event bus emits an interaction-triggered event
        -> React checks WorldInteraction.requirements (pure, Phaser-free logic)
        -> if satisfied, the same startAdventureSession path used by the
           route-based flow begins
```

The Adventure Engine itself does not change: it does not know or care
whether it was entered by tapping a location card or by walking up to an
object in the world. Requirement checks (has the child unlocked this
location, is this adventure already complete) live in the world/object
registry, not inside a Phaser scene, so they stay unit-testable without a
rendering context.

