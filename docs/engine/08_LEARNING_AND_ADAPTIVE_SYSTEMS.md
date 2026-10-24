# 08 — Learning and Adaptive Systems

## Preserve Existing Systems

The current source already contains:

```text
src/features/adaptive/
src/features/mastery/
src/features/learning-profile/
src/features/curriculum/
src/features/teaching/
src/features/tutor/
```

Do not create a new Learning Engine simply because the earlier generic roadmap proposed one.

## Integration Goal

Make new Adventures/locations able to reference existing learning content and adaptive selection without embedding educational logic in Three.js.

## Adventure Definition

Continue using current fields:

```text
skillDomain
skillLevel
ageBands
objectiveIds
```

and existing adaptive resolution.

## Spatial Presentation

A world manifest may provide a presentation binding for an existing Adventure step.

Example concept:

```text
Adventure step: NUMBER_INPUT
World presentation: count treasure piles
```

But correctness and evidence remain in the Adventure/Learning systems.

## Hidden Learning Principle

Keep the child-facing experience game-first.

Examples:

- repair machinery instead of "solve multiplication"
- distribute dragon food instead of "division worksheet"
- decode symbols instead of "pattern test"
- navigate based on clues instead of "reading comprehension quiz"

## No Parallel Mastery State

Do not add learning state to location manifests or Three.js entities.

Mastery remains child/domain/skill scoped in the existing system.
