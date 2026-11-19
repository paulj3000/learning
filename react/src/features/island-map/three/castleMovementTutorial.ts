import type { AgeBandValue } from '../../child-profile/constants';
import type { WorldEngineEventMap } from './worldEngineEvents';

/**
 * SC-JMP-06 preparation: an optional, skippable movement tutorial for the castle, as a pure
 * reducer over the shared engine's own events. It moves nothing and reads no input: the shared
 * controller does the moving and reports `PlayerGaitChanged`, `PlayerJumped`, `PlayerLanded` and
 * `PlayerRecovered`; this only decides which friendly line to show next.
 *
 * Rules it keeps (docs/adventures/jumping-standard.md, accessibility-standard.md):
 * - **Optional.** Nothing waits on it: no door, page, step, reward or exit. A child may skip it at
 *   any point, and skipping is final for the visit.
 * - **No timer.** Steps advance only on what the child did, never on time.
 * - **Never shames.** There is no failure state; a recovery is explained kindly.
 * - **Per visit.** Nothing is stored (no new save field).
 * - **Sprouts** are offered walking and a small hop only; going faster is not asked of them.
 *
 * Not built here (needs the owner): where the tutorial is shown (the task names a courtyard the
 * castle does not have; the Entry Hall is the candidate), and "assisted mode" (a per-child jump
 * assist is a Proposed shared-engine setting that needs a specification and an ADR).
 */

export type TutorialStepId = 'walk' | 'faster' | 'jump' | 'land' | 'done';

export type TutorialInput = 'keyboard' | 'touch' | 'gamepad';

export interface TutorialState {
  readonly step: TutorialStepId;
  readonly skipped: boolean;
  /** Shown once after a recovery, then cleared by the next event. */
  readonly recovered: boolean;
}

export type TutorialEvent =
  | {
      readonly name: 'PlayerGaitChanged';
      readonly detail: WorldEngineEventMap['PlayerGaitChanged'];
    }
  | { readonly name: 'PlayerJumped'; readonly detail: WorldEngineEventMap['PlayerJumped'] }
  | { readonly name: 'PlayerLanded'; readonly detail: WorldEngineEventMap['PlayerLanded'] }
  | { readonly name: 'PlayerRecovered'; readonly detail: WorldEngineEventMap['PlayerRecovered'] }
  | { readonly name: 'Skip' };

const ORDER: Readonly<Record<AgeBandValue, readonly TutorialStepId[]>> = {
  SPROUT: ['walk', 'jump', 'land', 'done'],
  PATHFINDER: ['walk', 'faster', 'jump', 'land', 'done'],
  EXPLORER: ['walk', 'faster', 'jump', 'land', 'done'],
};

export function tutorialSteps(band: AgeBandValue): readonly TutorialStepId[] {
  return ORDER[band];
}

export function startTutorial(): TutorialState {
  return { step: 'walk', skipped: false, recovered: false };
}

function advance(state: TutorialState, band: AgeBandValue): TutorialState {
  const order = ORDER[band];
  const next = order[order.indexOf(state.step) + 1] ?? 'done';
  return { ...state, step: next };
}

/** The next state. Pure; an event that does not fit the current step changes nothing but the recovery note. */
export function tutorialReducer(
  state: TutorialState,
  event: TutorialEvent,
  band: AgeBandValue,
): TutorialState {
  if (state.skipped || state.step === 'done') return state;
  if (event.name === 'Skip') return { ...state, skipped: true, recovered: false };
  if (event.name === 'PlayerRecovered') return { ...state, recovered: true };
  const cleared = state.recovered ? { ...state, recovered: false } : state;
  switch (cleared.step) {
    case 'walk':
      return event.name === 'PlayerGaitChanged' && event.detail.gait !== 'idle'
        ? advance(cleared, band)
        : cleared;
    case 'faster':
      return event.name === 'PlayerGaitChanged' &&
        (event.detail.gait === 'run' || event.detail.gait === 'sprint')
        ? advance(cleared, band)
        : cleared;
    case 'jump':
      return event.name === 'PlayerJumped' ? advance(cleared, band) : cleared;
    case 'land':
      return event.name === 'PlayerLanded' ? advance(cleared, band) : cleared;
    default:
      return cleared;
  }
}

/** Whether to show the tutorial card at all. */
export function tutorialVisible(state: TutorialState): boolean {
  return !state.skipped && state.step !== 'done';
}

/**
 * Child-facing lines, readable aloud and localizable (keys are stable; text is copy). The control
 * names follow the shared input as built (jumping-standard.md, "Controls").
 */
export const TUTORIAL_COPY: Readonly<
  Record<Exclude<TutorialStepId, 'done'>, Readonly<Record<TutorialInput, string>>>
> = {
  walk: {
    keyboard: 'Press W or the up arrow to walk.',
    touch: 'Drag on the left side of the screen to walk.',
    gamepad: 'Push the left stick to walk.',
  },
  faster: {
    keyboard: 'Hold Shift while you walk to go faster.',
    touch: 'Drag further from where you started to go faster.',
    gamepad: 'Press the left stick in to go faster.',
  },
  jump: {
    keyboard: 'Press Space to hop.',
    touch: 'Tap the Jump button to hop.',
    gamepad: 'Press A or Cross to hop.',
  },
  land: {
    keyboard: 'Down you come. Nice hop!',
    touch: 'Down you come. Nice hop!',
    gamepad: 'Down you come. Nice hop!',
  },
};

export const TUTORIAL_RECOVERED_LINE = 'Whoops! Back you go to where you were. Nothing is lost.';
export const TUTORIAL_DONE_LINE = 'You can walk, go faster and hop. Off you go and explore!';
export const TUTORIAL_SKIP_LABEL = 'Skip';
export const TUTORIAL_OPTIONAL_LINE =
  'You never need to hop to finish a story. It is just for fun.';

/** The line to show for a state, or null when the card is hidden. */
export function tutorialLine(state: TutorialState, input: TutorialInput): string | null {
  if (state.skipped) return null;
  if (state.step === 'done') return TUTORIAL_DONE_LINE;
  if (state.recovered) return TUTORIAL_RECOVERED_LINE;
  return TUTORIAL_COPY[state.step][input];
}
