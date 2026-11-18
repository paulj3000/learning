# Accessibility Standard

> **Status:** Proposed
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-049, ADR-053, ADR-054

Every Realm, Adventure, Quest and Challenge meets this standard. It builds on the product-wide
requirements in [../UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md) and the findings in
[../ACCESSIBILITY_AUDIT.md](../ACCESSIBILITY_AUDIT.md); read those first and do not duplicate
them here.

Users are children aged 3 to 8, many of whom cannot read yet, using a tablet, a phone, a
keyboard or a gamepad, often with a parent nearby.

## 1. Clear exits

- A child can always leave. "Leave island" is on every child-mode screen and goes straight to the
  sailing dock with no question (LAI-0807).
- The adult exit to the parent space has no arithmetic check; it uses the normal exit path
  (flush saves, a plain confirm only mid-encounter). **Binding:** owner decision AP-04,
  2026-11-10, recorded as an accepted risk in [../THREAT_MODEL.md](../THREAT_MODEL.md)
- Exits stay visible and reachable while a game panel, NPC dialogue or full screen is open, at
  every width from 320 px. Implemented on `main` by PR #33 (Trello fOwy8OIb) and covered by the
  browser spec `react/e2e/acceptance/portal-adult-exit.spec.ts`; keep that spec passing.
- Never gate an exit behind a Challenge, a quest step, a confirmation quiz or an arithmetic
  question. Never put a new panel above the exits' layer.
- Profile deactivation and other sensitive parent actions keep their `ParentGate`
  ([../UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md), "Parent gate").

## 2. No mandatory time limits

- No countdown, stop note, lockout, cooldown, or session completion triggered by elapsed time.
  **Binding:** ADR-053
- No Challenge has an answer timer. Moving or vanishing platforms are timing elements, so a
  required path never depends on them ([jumping-standard.md](jumping-standard.md)).

## 3. Child-friendly instructions, read aloud

- All child-facing text is readable aloud and localizable; no em dashes. **Binding:** CLAUDE.md §13
- Respect the child's reading mode (`ChildProfile.reading_mode`: `VOICE_FIRST`, `READ_ALONG`,
  `INDEPENDENT`) and the age band's reading volume. **Binding:** CLAUDE.md §3
- Spoken lines always have visible text; captions always show and audio is optional.
  **Binding:** ADR-054 (decision 8). Audio is never the only carrier of meaning
  ([../audio/SOUND_MANAGER_USAGE.md](../audio/SOUND_MANAGER_USAGE.md)).
- The child can replay, interrupt or mute narration ([../UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md)).
- Instructions are one short step at a time for Sprouts; icon plus text, never icon alone.

## 4. Keyboard

- Every supported child activity and every parent surface is keyboard operable with a visible
  focus indicator ([../UX_AND_ACCESSIBILITY.md](../UX_AND_ACCESSIBILITY.md)).
- Use real `<button>` and `<a>` elements; no clickable divs. **Binding:** CLAUDE.md §13
- 3D movement: W A S D or arrows; interact with E or Enter. Jump with Space once the shared
  controller merges ([jumping-standard.md](jumping-standard.md), PR #26).
- Typing in a text field never moves the player.

## 5. Touch and responsive layout

- Tablet-first and responsive on phone and desktop. **Binding:** CLAUDE.md §11 (item 13)
- Large interaction targets with generous spacing. Touch controls (move drag, look drag, action
  prompt, Jump button when merged) never overlap exits, Hint or Backpack.
- Check 320, 375, 768, 1024 and 1440 px, portrait and landscape.
- No long scrolling pages in child mode.

## 6. Typography and contrast

- Use the shared tokens (`react/src/styles/tokens.css`, ADR-052 theme); do not hard-code colours.
- Text meets WCAG AA contrast (4.5:1); controls and focus rings meet 3:1 non-text contrast, as
  fixed in [../ACCESSIBILITY_AUDIT.md](../ACCESSIBILITY_AUDIT.md).
- Never rely on colour alone (for example a correct answer shows a shape or icon too).

## 7. Reduced motion and flashing

- Honour `prefers-reduced-motion` (`react/src/lib/motionPreference.ts` and the engine's own
  check): no camera shake or landing dip, gentler easing, a fade instead of a long animation
  (Firepeak's crystal discovery uses a reduced-motion fade on `main`).
- No flashing content. Warnings that blink switch to a steady change under reduced motion.

## 8. Audio

- A child's audio mix (master, five channels, per-channel mute, reduced intensity) is saved per
  child (`audio.ChildAudioSettings`) and applied through the Sound Manager.
- Every meaningful sound has a visual equivalent. Missing audio never blocks play. See
  [audio-standard.md](audio-standard.md).

## 9. Accessible challenge interactions

- Every spatial or physical Challenge has a panel alternative that grades the same way (Firepeak
  `PLACE_PLATFORMS` on `main`: carry stones in the scene, or use the full panel).
- Answers are tap or click targets; no drag-only, double-tap-only, timing-only or precision-aim
  interaction. Treasure Rush puzzles are answered by touching objects (TR-D23).
- Feedback for a wrong answer is kind and specific, never shaming; the hint ladder follows
  ([challenge-standard.md](challenge-standard.md)).

## 10. Jumping alternatives

Required progress never depends on jumping alone. Proposed alternatives (tap-to-hop, auto-jump
assist, alternate route) are in [jumping-standard.md](jumping-standard.md), section 8; they are
proposals for owner decision, not shipped features.

## 11. Adjustable difficulty, where supported

- Age band sets difficulty, reading volume and response mode. **Binding:** CLAUDE.md §3
- Band differences live in content parameters (`ChallengeSpec`, `AreaPuzzle.parameters`), which
  staff tune in Django Admin. **Binding:** ADR-047
- The hint ladder lowers difficulty inside a step; supported success still counts as
  participation.
- Platform speeds and timings are tunable per 3D Area once PR #37 merges.

## 12. Forgiving gameplay

- No lives, no game over, no lost items or progress on a mistake or a fall. Hazards return the
  child to the last safe checkpoint after a short fade (Firepeak FP-D10 on `main`).
- Wrong answers can be tried again; a child can leave and resume at the same place.
- A child never gets stuck: every stage tells them where to go, and a hint is always available.

## 13. Acceptance criteria

- [ ] Exits reachable on every screen, every panel, full screen, 320 px and up; no gate.
- [ ] No timers anywhere in the adventure.
- [ ] All copy readable aloud, captioned, localizable, no em dashes.
- [ ] Keyboard, touch and (when merged) gamepad paths work; focus visible.
- [ ] Every spatial Challenge has a panel alternative; tested.
- [ ] Reduced-motion behaviour checked.
- [ ] Contrast checked against tokens.
- [ ] Owner QA with [../engineering/templates/qa-checklist.md](../engineering/templates/qa-checklist.md),
  "Accessibility" section.
