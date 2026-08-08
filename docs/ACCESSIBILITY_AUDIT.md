# Accessibility Audit (Phase 8)

A source-level pass over the current UI against `docs/UX_AND_ACCESSIBILITY.md`'s
"Accessibility requirements" and CLAUDE.md section 13's "Prefer accessible
buttons over clickable divs", by reading every route/component and the
design-token/global CSS, not by running an automated scanner against a
live-rendered page (no browser automation available in this pass beyond
the existing Playwright smoke test, which only covers unauthenticated
routes).

## 1. What was checked

- Every `onClick` handler in `src/` (grepped and read in context) to
  confirm it is attached to a real `<button>` or `<Link>`, never a
  clickable `<div>`/`<span>`.
- `<img>` usage for missing/incorrect `alt` text.
- Focus-visible styling, reduced-motion support, and skip-link wiring in
  `src/styles/global.css` and `src/app/App.tsx`.
- Color contrast for every color token in `src/styles/tokens.css` against
  the two backgrounds they're actually used on (`--color-surface` /
  `--color-background`), computed with the WCAG 2.x relative-luminance
  formula, then cross-referenced against where each token is actually
  used in component CSS to judge real-world severity (body text vs. a
  rarely-seen decorative border).
- `aria-live`/`role="alert"` usage on dynamically-updating regions
  (`CompanionBubble.tsx`, `ParentGate.tsx`, error states across routes).
- Form label association (`htmlFor`/`id` pairing) in the auth and
  child-profile forms.

## 2. Findings

### 2.1. Color contrast failures - fixed this session

Four of `tokens.css`'s color tokens failed WCAG AA when computed against
the backgrounds they're actually rendered on:

| Token | Old value | Contrast (old) | New value | Contrast (new) | Real-world impact |
|---|---|---|---|---|---|
| `--color-primary` | `#1e88a8` | 4.08:1 on white (fails AA text, needs 4.5:1) | `#166a82` | 6.14:1 on white | Every link (`global.css`'s `a` rule) and many buttons across ~13 stylesheets. |
| `--color-accent` | `#2fb673` | 2.61:1 on white (fails badly) | `#1c7a4b` | 5.34:1 on white | **Chatty's speaker name and every AI-companion choice button text** (`CompanionBubble.module.css`) and the adventure-complete heading (`AdventureRunner.module.css`) - the most child-facing text in the product. |
| `--color-focus-ring` | `#ffd166` | 1.44:1 on white (fails WCAG 1.4.11's 3:1 non-text minimum badly) | `#a35400` | 5.49:1 on white | The global keyboard focus outline (`global.css` `:focus-visible`, plus two route-local duplicates) - was barely visible against white surfaces, undermining "Visible focus indicators" (`docs/UX_AND_ACCESSIBILITY.md`), a keyboard-operability requirement. |
| `--color-border` | `#d8e3e8` | 1.31:1 on white (fails 3:1) | `#6f8794` | 3.77:1 on white | Text-input borders on every parent-facing form (`AuthForm.module.css`, `ChildProfileForm.module.css`) - inputs were nearly boundary-less against a white page. |
| `--color-warning` | `#c77a1f` | 3.37:1 on white (fails 4.5:1 text) | `#93570d` | 5.82:1 on white | Currently unused anywhere in the app (grepped - only its own declaration). Fixed anyway so it's safe the first time it's used. |

All new values keep the same hue family as the originals (teal primary,
green accent, amber focus ring, blue-grey border) so this is a contrast
correction, not a redesign - consistent with `tokens.css`'s existing
"Placeholder values pending final visual design direction" framing
(`docs/IMPLEMENTATION_STATUS.md` "Decisions pending"). Every token above
now clears the relevant WCAG threshold against **both**
`--color-surface` and `--color-background`, not just one.

Not changed: `--color-text` (14.29:1), `--color-text-muted` (6.61-7.01:1),
`--color-danger` (6.16-6.54:1) - all already comfortably pass AA.

### 2.2. Everything else checked: no findings

- **Clickable divs**: none found. Every interactive element in the app is
  a real `<button>` or `<Link>` (confirmed by reading every `onClick` call
  site in context, not just grepping for the pattern in isolation).
- **`<img>` alt text**: the one `<img>` in the app (`Home.tsx`'s favicon
  badge) is correctly marked `alt=""` as decorative.
- **Focus indicators**: present and global (`global.css`'s
  `:focus-visible` rule applies everywhere; two routes duplicate an
  equivalent rule locally, redundant but not wrong). Fixed for contrast
  above.
- **Reduced motion**: handled at both the token level
  (`--transition-fast: 0ms` under `prefers-reduced-motion: reduce`) and
  globally (`global.css` additionally zeroes all animation/transition
  durations under the same media query) - belt-and-suspenders, no gap.
- **Skip link**: present (`App.tsx`) and every route's main landmark
  carries `id="main-content"` to match it (spot-checked `ParentDashboard`,
  `ChildDashboard`, `StoryKeepsakes`, `WelcomeHarbor`).
- **Live regions for dynamic AI content**: `CompanionBubble.tsx` already
  uses `aria-live="polite"` for loading/response states and
  `role="alert"` for the error state - a screen-reader user is notified
  when Chatty's text changes without needing to be refocused on it.
- **Parent gate dialog semantics**: `ParentGate.tsx` uses
  `role="dialog"`, `aria-modal="true"`, and `aria-labelledby`. (oxlint's
  `jsx-a11y/prefer-tag-over-role` warning here - "prefer a native
  `<dialog>`" - is a pre-existing, deliberate deviation already recorded
  in `docs/IMPLEMENTATION_STATUS.md`'s Phase 4 verification notes, not a
  new finding.)
- **Ordering step keyboard operability**: `OrderingStep.tsx`'s up/down
  reordering uses real `<button>` elements with descriptive
  `aria-label`s (`Move {item} up`/`down`) rather than drag-and-drop -
  already documented as a deliberate Phase 3 choice
  (`docs/IMPLEMENTATION_STATUS.md`) and confirmed keyboard-operable by
  construction.
- **Form label association**: spot-checked `ChildProfileForm.tsx` and the
  auth forms - every input has a matching `htmlFor`/`id` pair, and the
  existing component tests for these forms already query by label text
  (React Testing Library's `getByLabelText`), which only passes when the
  association is correct - an existing regression guard, not something
  this review needed to add.
- **Color-only meaning**: status information (session active/deactivated,
  adventure status, safety-event severity) is always paired with text
  labels, never conveyed by color alone (spot-checked
  `ChildProfileList.tsx`, `ChildDashboard.tsx`'s `SESSION_STATUS_LABELS`
  and the new `SAFETY_SEVERITY_LABELS`).

## 3. Not covered by this pass

- **No live screen-reader testing** (`docs/UX_AND_ACCESSIBILITY.md`
  explicitly calls for "screen-reader testing for parent workflows and
  core child navigation") - this review is a source-level check for
  structural correctness (labels, roles, live regions), not a substitute
  for an actual VoiceOver/NVDA pass. Recommend before a real pilot.
- **No automated contrast/axe scan against rendered pages** - the
  contrast numbers above were computed directly from the token hex
  values and the WCAG formula, not measured from a rendered DOM. This is
  exact for solid-color text-on-background pairs (which is every case
  here), but would not catch, e.g., contrast issues introduced by
  opacity or gradients if any are added later.
- **Touch target sizing** (`docs/UX_AND_ACCESSIBILITY.md`: "Large
  interaction targets and generous spacing") was not measured in pixels
  against a real viewport; buttons visually appear generously padded via
  the `--space-*` tokens, but this was not verified against a WCAG 2.5.8
  (24x24px minimum) or similar target-size guideline with real rendered
  measurements.

## 4. Summary

One class of real, fixed issue (color contrast, four tokens, all fixed
at the shared token source so every component using them is corrected at
once) and no other structural accessibility gaps found. The app's
accessibility fundamentals (semantic buttons, focus-visible, skip link,
live regions, keyboard-operable custom controls, reduced-motion support)
were already solid from earlier phases; this audit's contribution is the
contrast fix and the "not covered" list above as the concrete pre-pilot
follow-up (live screen-reader pass in particular).
