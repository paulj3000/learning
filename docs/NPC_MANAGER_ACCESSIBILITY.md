# NPC Manager Accessibility (LAI-NPC-038)

Scope: the NPC interaction UI (`react/src/features/npc-manager/ui/`), the scene host
(`host/useNpcSceneHost.tsx`) and the voice (`voice/`), as used by Treasure Rush and, next,
Storykeeper's Castle. Checked against `docs/UX_AND_ACCESSIBILITY.md`,
`docs/ACCESSIBILITY_AUDIT.md` and CLAUDE.md section 13. Players are 3 to 8 and may be pre-readers
on a tablet.

## 1. Findings and what changed

| Area | Before | Now |
|---|---|---|
| Captions | The authored line was always shown (voice coordinator: "captions always"). Busy text shared the caption's live region. | Unchanged guarantee: the line is visible while speaking, muted, loading or failed, and nothing closes the panel on a timer. The caption region is `aria-live="polite"` + `aria-atomic`, with the speaker's name (visually hidden) read first; the busy line is a separate `role="status"`, so nothing nests or double-reads. Text uses `--font-size-large` on `--color-surface` (14:1). |
| Dialog semantics | `role="dialog"`, labelled by the speaker, `aria-modal="false"`, no focus trap. | `aria-modal="true"`; Tab and Shift+Tab cycle within the panel while it is open (with every control but Close disabled, focus stays in the panel). Escape closes; arrows still step through buttons. |
| Focus return | Returned to the element focused before the panel opened. The Talk prompt hides while a conversation is open, so that element was usually gone and focus fell to `<body>`. | The panel takes an optional `returnFocusTo()`. The host passes one that focuses the Talk prompt when it is shown again, else the world's optional `focusReturnTarget()` (for example the canvas), and never takes focus while another world panel is open (`suspended`) or already has focus. No keyboard trap after close (tested). |
| Touch targets | `3rem` (48 px). | `--npc-target: 3.5rem` (56 px) min width and height on the prompt and every panel button; one tap activates (`touch-action: manipulation`); no `:hover` styles exist. |
| Pre-readers | Text-only prompt. | Prompt shows a speech-bubble icon plus "Talk to Pip"; replay shows a speaker icon plus "Hear it again". Icons are `aria-hidden`; the text is the accessible name. |
| Mute and volume | Voice played on the Sound Manager `voice` channel; muted meant no request and text only. NPC cues (`onSound`) go through the world's Sound Manager cues (Treasure Rush `playCue`), so mute and volume apply. | Same, plus `useNpcVoice` now reports `silent` (live, from `useSoundSettings`) and `speechAvailable`. |
| Replay | None. | "Hear it again" on the panel, only for a line with a speech reference, a speech source, and a voice the child can hear. Hidden while muted (master or voice channel muted or at zero), with no speech source, on the error fallback, and while a hint's words replace the line; disabled while busy or while the voice loads. |
| Reduced motion | The host passed `options.reducedMotion` (Treasure Rush: `prefersReducedMotion()` read at render). A system change applied only when something re-rendered. | The runtime reads `reducedMotion || system prefers-reduced-motion`, subscribed live through `matchMedia` change events. Turning to face the child and the animator's procedural placeholder motion follow the change at once; wander and patrol choose "stand still" when an NPC is mounted, so that part applies on the next mount (scene or scope change). UI transitions and press movement are off under `prefers-reduced-motion`. |
| Copy | Centralized in `npcUiCopy.ts`; no em dashes; calm error ("Hmm, that did not work. Let us try again."). | Added `NPC_PROMPT_COPY.talkTo` (a function, so a locale owns word order) and `replay`. The host takes an optional `copy` (`prompt`, `dialogue`) for localization. |

Fixed in passing: the prompt's hotkey badge used an undefined `--font-size-base` token; it now uses
`--font-size-body`.

**Unprompted lines (QA finding F-B, owner decision 2026-11-07).** A line the child did not ask for
(spawn greeting, welcome back, a reaction to a find) is no longer the modal panel. It is
`NpcAmbientLine`: a labelled `region` (not a dialog) whose line sits in one atomic
`aria-live="polite"` region with the speaker's name, so it is announced once without moving focus.
It never traps Tab or Escape and never hides the world's HUD (it renders in the HUD column on the
stage, beside Hint and Backpack, away from Full screen). Buttons: Continue (or "Talk to Pip" when
the line has choices, which moves the same conversation into the modal panel) and Close, both
56 px. No dismissal timer: the bubble stays until the child closes or continues it, or a newer
play line (a find, a finished quest) replaces it; a spawn greeting waits its turn. Hidden while
another panel is open, like the panel. Only a conversation the child starts (Talk, E, or "Talk to
Pip" on a bubble) is modal.

## 2. Additive API (backward compatible)

- `NpcDialoguePanel`: `onReplay?`, `replayDisabled?`, `returnFocusTo?`; copy key `replay`.
- `NpcInteractionPrompt`: `buttonRef?`.
- `useNpcSceneHost` options: `focusReturnTarget?`, `copy?`. `reducedMotion` is unchanged (still
  required); the system preference is OR-ed in.
- `useNpcVoice` result: `silent`, `speechAvailable`.
- `npcUiCopy.ts`: `NpcPromptCopy`, `NPC_PROMPT_COPY` (`talkToLabel` kept).

## 3. Automated coverage (Vitest + React Testing Library, jsdom)

- `ui/NpcInteraction.a11y.test.tsx`: modal dialog labelling; one atomic polite caption region
  with the speaker; busy status outside it; caption not dismissed by timers; choice names; Tab
  and Shift+Tab trap; busy Tab stays in the panel; `returnFocusTo` and no trap after close; no
  focus theft; prompt Enter, Space and hotkey; replay hidden, shown (icon plus text), disabled
  and hidden on error; single touch tap; 56 px targets, `touch-action`, no `:hover` and reduced
  motion rules (read from the CSS module source); copy without em dashes or blame words.
- `host/useNpcSceneHost.test.tsx` ("accessibility"): focus back to the Talk prompt; focus to
  `focusReturnTarget` after walking away; muted shows text only with no speech request and no
  replay, and replay returns live on unmute; replay requests the voice again; no replay without a
  speech source; localized copy; reduced motion passed to behaviours; system preference OR-ed in
  and re-read live (turning snaps, then becomes gradual after the change without a remount).
- `voice/useNpcVoice.test.tsx`: `silent` follows master mute and voice volume live;
  `speechAvailable` false with no source, caption still shown.
- Existing panel, prompt, host, voice and `RegionPlayCompanion.npc.test.tsx` tests still pass.

No axe or other scanner is installed, so no automated rule audit runs (no new dependency added).

## 4. Owner manual testing needed

jsdom does not run a screen reader, layout or real touch. Please check on a tablet:

1. VoiceOver (iPad) and TalkBack (Android tablet): the panel is announced as a dialog with the
   speaker's name; each new line is read once, prefixed by the speaker; "Just a moment..." is read
   while loading and not repeated; choices read as buttons with their words; Close and
   "Hear it again" are reachable by swipe; after Close, focus lands on "Talk to ..." (or the stage).
2. Switch Access (Android) and iOS Switch Control: the prompt and every panel button can be
   reached and activated; scanning stays inside the panel while it is open and is free after it
   closes.
3. Touch: targets feel large enough for a 3 to 4 year old (56 px minimum); one tap acts.
4. Mute: with master or voice muted, lines show as text, there is no "Hear it again", and
   unmuting brings it back; volume changes apply to the voice.
5. Reduced motion: turn the OS setting on and off during play; NPCs face the child without a
   turning animation when on. Wander and patrol stand still after re-entering the area.
6. Visual: focus ring visible on every control; caption readable at arm's length; the panel does
   not cover the Talk prompt or HUD controls the child needs.
7. Desktop keyboard: Enter, Space and (if a world enables it) the hotkey on the prompt; Tab,
   arrows and Escape in the panel.

## 5. Not covered or out of scope

- Word-by-word highlighting (Read Along) is not required here and is not implemented.
- Treasure Rush could pass `focusReturnTarget` (its canvas) to `useNpcSceneHost`; that is an
  island-map change for its owner, optional because the prompt is the usual target.
