# Accessibility Standard

- **Status:** Mandatory policy (merged to `main` at the owner's direction on 2026-11-18; formal acceptance of ADR-072 pending). Rules restated from CLAUDE.md and accepted ADRs bind through those sources.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-008, ADR-020, ADR-052, ADR-053; pending merge: ADR-056, ADR-058, ADR-059, ADR-063
- **Canonical sources:** [docs/UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md), [docs/ACCESSIBILITY_AUDIT.md](../ACCESSIBILITY_AUDIT.md), [CLAUDE.md](../../CLAUDE.md) sections 3, 11 and 13, [docs/THREAT_MODEL.md](../THREAT_MODEL.md) (adult exit), [react/src/features/island/IslandLayout.tsx](../../react/src/features/island/IslandLayout.tsx)

Every adventure must be playable by children aged 3 to 8 with different abilities, devices and
reading levels. This standard applies the canonical UX and accessibility requirements to
adventures. It does not replace them.

## Controls

**Keyboard.** Every interaction in an adventure has a keyboard path. In 3D Areas on `main`:
W A S D or arrows to move, mouse to look, E or Enter to interact. Jump is Space on the pending
movement branches (see the [jumping standard](jumping-standard.md#controls-as-built-on-the-branches)).
Panels and dialogs use real buttons with visible focus. Space and arrows never scroll the page
during play; inside a text field they type as usual.

**Touch.** Tablet-first (CLAUDE.md section 11 item 13). Drag on the left half to move and the
right half to look; on-screen buttons for actions. Targets are large and spaced generously.
On-screen controls never cover each other, the exits or the action prompt, in portrait or
landscape, at phone and tablet widths.

**Gamepad.** Keyboard and touch required; gamepad checked where the shared input supports it
(standard mapping, pending merge on the movement branches).

**Equivalent routes.** Every 3D interaction has a non-spatial equivalent: the "Things to do here"
list, panel buttons for answers chosen by touching objects (Treasure Rush's rune stones), and the
HUD equivalence test pattern (`castleHudEquivalence.test.tsx`). An adventure that adds a spatial
interaction adds its equivalent and a test.

## Presentation

- **Responsive.** Works from 320 px phones to desktops with no horizontal scroll; tablet is the
  primary target.
- **Typography.** Short lines, plain words, generous size; icon plus text, never icon alone.
  Minimal text for Sprouts. All child-facing text is readable aloud and localizable, with no em
  dashes (CLAUDE.md section 13).
- **Contrast.** Use the `tokens.css` theme (ADR-052); `tokens.test.ts` checks the palette pairs.
  Text on 3D scenes sits on a solid or scrimmed panel. Never rely on colour alone (pair it with
  text, shape or position).
- **Reduced motion.** Respect `prefers-reduced-motion`: no camera dips or shakes, gentler easing,
  fades instead of flashes, slower platforms. No flashing content in any mode.
- **Reading modes.** Respect the child's reading mode: Voice First, Read Along, Independent.

## Audio and text alternatives

- Everything spoken is also shown as text; everything meaningful in audio has a visual cue.
- Narration and music can be muted or interrupted; nothing requires hearing.
- Audio is optional for progress: a missing sound never blocks play.
- Images and models that carry meaning have a text label (crosshair label, panel text); purely
  decorative images use empty `alt`.
- Dynamic companion and panel text uses polite live regions; errors use `role="alert"`.

## Accessible challenge interactions

- No challenge needs precise aim, fast reactions, holding a button, or two simultaneous inputs.
- Ordering and matching use buttons, not drag-only gestures.
- Answers may be given by tapping a large option, not only by walking or jumping to an object.
- Hints are always available and never cost anything.
- The [challenge standard](challenge-standard.md) requires each challenge spec to state its
  accessible alternative.

## Jumping alternatives

- All required progress has a walking route. Jump routes are optional.
- Jump is a single press on keyboard, touch button, gamepad or switch.
- Platforms are wide, slow and predictable, with warnings before they vanish.
- Details: [jumping standard](jumping-standard.md#accessibility-alternatives).

## Adjustable difficulty, where supported

What exists: per-band content (parameters, reading volume, response mode), the hint ladder and
adaptation rules ([docs/ADVENTURE_ENGINE.md](../ADVENTURE_ENGINE.md)), staff platform tuning per
3D Area (pending merge), running and sprinting settings (pending merge). A per-child difficulty or
jump assist control does not exist; adding one is a proposal for the owner.

## Forgiving gameplay

- No lives, no game over, no punishment, no lost items or progress after a wrong answer or a
  fall. Falls and hazards return the child to a nearby checkpoint.
- Wrong answers get kind, specific feedback and another go.
- Leaving and coming back resumes from server state (last checkpoint, quest stage, world
  changes).

## Clear exit

- **A child can always leave.** "Leave island" returns to the Realm Explorer; it saves first and
  only confirms, with two plain buttons, when an encounter is open
  ([IslandLayout.tsx](../../react/src/features/island/IslandLayout.tsx),
  [portal/exit/copy.ts](../../react/src/features/portal/exit/copy.ts)).
- **Never put a learning challenge, arithmetic question or quiz on the way out** of a Realm,
  Place, 3D Area, adventure or panel. Leaving is navigation, not a learning check (AP-04).
- **The adult exit is a separate parent feature.** "Adults: exit to parent space" opens the
  parent space; by the owner's decision of 2026-11-10 it has no arithmetic check (accepted risk in
  [docs/THREAT_MODEL.md](../THREAT_MODEL.md)). The arithmetic `ParentGate` remains only for
  sensitive parent actions such as deactivating or reactivating a profile. Adventures do not add
  their own gates.
- Exits stay reachable and unobscured while a game panel is open, on phones and in full screen
  (the adult-exit panel fix, in `main`).
- Every panel and dialog closes with a visible button and with Escape where it is a dialog.

## Child-friendly instructions

- One instruction at a time, as an action ("Walk to the glowing chest").
- Shown and spoken; repeatable on demand.
- The next step is always visible (HUD cue, beacon, or companion line) and comes from server
  state.
- Error copy never blames the child; when an adult is needed it says so plainly ("Please ask a
  grown-up to sign in again").

## No arbitrary time limits

No countdown, timed challenge, session clock, stop note, lockout or cooldown, and no session ended
for elapsed time (ADR-053; CLAUDE.md section 11 item 11). A moving or vanishing platform on an
optional route is a movement mechanic, not a time limit, and must never gate required progress.

## Verification

- Development: component tests for labels, roles, keyboard paths and the non-spatial equivalent
  of each 3D interaction; contrast through `tokens.test.ts`.
- Owner QA: keyboard only, a touch tablet, reduced motion, audio muted, and each supported age
  band. Browser and screen-reader passes run at merge or release readiness when requested
  ([docs/TESTING_STRATEGY.md](../TESTING_STRATEGY.md)); the live screen-reader pass recommended by
  [docs/ACCESSIBILITY_AUDIT.md](../ACCESSIBILITY_AUDIT.md) is still open.

## Acceptance checklist

- [ ] Every interaction works by keyboard and by touch; focus is visible.
- [ ] Every 3D interaction has a non-spatial equivalent, with a test.
- [ ] Text is readable aloud, localizable, icon plus text, sufficient contrast, no colour-only meaning.
- [ ] Reduced motion respected; nothing flashes.
- [ ] Everything spoken is also shown; audio is never required.
- [ ] Required progress needs no jump, no precise aim and no fast reaction.
- [ ] No lives, no loss on failure, kind retry copy.
- [ ] Exits always visible and reachable; no challenge on any exit; no adventure-specific gate.
- [ ] No time limits of any kind.
- [ ] Owner QA done on a tablet and by keyboard, with audio muted and reduced motion on.
