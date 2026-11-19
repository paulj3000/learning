# UX and Accessibility

## Experience principles

- Tablet-first, responsive on desktop and mobile.
- Large interaction targets and generous spacing.
- Minimal text for younger age bands.
- Narration controls always visible during child experiences.
- Clear distinction between parent space and child island.
- No advertising, social pressure, or manipulative countdowns.
- No play-time limits: children are never counted down, nudged to stop, or cut off for time
  (ADR-053). Save progress at narrative checkpoints so a child who leaves at any moment can
  resume.

## Child mode

- Use icon plus text, not icon alone.
- Keep primary choices to a small number.
- Provide replay narration and pause controls.
- Avoid long scrolling pages.
- Use consistent placement for companion, progress path, help, and exit.
- Do not show account details or administrative navigation.

## Parent gate

Sensitive parent actions (such as deactivating or reactivating a profile, consent, deletion, and
purchasing in the future) must require a parent gate appropriate to the product and reviewed
before launch. Deletion also needs a recent Cognito sign-in (ADR-043).

Leaving child mode is navigation, not a gated action. By the owner's decision of 2026-11-10
(AP-04), the adult exit ("Adults: exit to parent space") has no arithmetic gate, and no learning
challenge, arithmetic question or quiz is ever placed on the way out of a Realm, Place, 3D Area,
adventure or panel (`docs/adventures/accessibility-standard.md`). The accepted risk is recorded in
`docs/THREAT_MODEL.md`.

## Reading modes

### Voice First
Narration leads. Text may be hidden or shown in small chunks.

### Read Along
Narration highlights words or phrases as spoken.

### Independent
Text leads, with narration available on demand.

## Accessibility requirements

- Keyboard operability for parent surfaces and supported child activities.
- Visible focus indicators.
- Semantic labels.
- Captions or text equivalents for meaningful audio.
- Reduced-motion support.
- Do not rely on color alone.
- Contrast suitable for essential controls.
- Avoid flashing content.
- Screen-reader testing for parent workflows and core child navigation.

## Companion presentation

Chatty should occupy a stable area, not cover activity content. Spoken text must also be available visually. The child must be able to interrupt or mute narration.

