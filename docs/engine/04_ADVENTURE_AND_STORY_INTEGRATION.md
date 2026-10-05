# 04 — Adventure and Story Integration

## Preserve the Current Adventure Engine

Current `AdventureDefinition` already provides:

- slug
- version
- title
- locationSlug
- ageBands
- entry step
- typed steps
- optional skill domain/level

Keep it.

## Problem to Solve

Some 3D regions currently contain direct bindings between physical world objects and specific Adventure steps.

Examples should be identified during implementation by searching region-specific Three.js files for:

- adventure slugs
- step IDs
- choice IDs
- direct calls into Adventure/session APIs

## Target Binding Model

Move these relationships into declarative bindings.

Example:

```ts
interface AdventureBinding {
  entityId: string;
  adventureSlug: string;
  stepId?: string;
  action:
    | 'START'
    | 'SUBMIT_CHOICE'
    | 'SUBMIT_NUMBER'
    | 'ADVANCE'
    | 'OPEN_ADVENTURE_UI';
  value?: string | number;
}
```

Use the actual Adventure Engine API rather than inventing duplicate transitions.

## Story Engine

Do not merge Story Engine into Adventure Engine.

Story remains the narrative arc/orchestration layer.

A manifest may reference:

```text
storySlug
adventureSlug
```

but execution remains in existing engines.

## Dual Entry Points

Preserve existing decisions about an Adventure/chapter being reachable from both:

- spatial world
- story/library UI

Both must use the same canonical progress/session records where current architecture requires it.

## Adventure UI

Not every educational interaction must become an in-world 3D widget immediately.

Phase 1 may:

- trigger existing Adventure UI from the world
- preserve current accessible React step components

Later, specific step types may gain spatial presentations.

## Critical Rule

The 3D renderer must not reimplement correctness, hints, mastery, or Adventure transitions.

Those remain in existing deterministic systems.
