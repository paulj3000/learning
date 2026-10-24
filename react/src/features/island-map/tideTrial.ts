/**
 * "Beat the Tide": Pirate Builder Bay's in-scene Explorer (ages 7-8)
 * challenge, played in the 3D bay itself rather than on question cards.
 *
 * Why it exists: the card version ("The Tide Gate Calculation") asked the
 * same arithmetic as five text prompts, while the 3D bay stood still behind
 * them, and an 8-year-old play tester was not impressed. Here the child
 * *decides* (how high to build the deck), *sees* the consequence (the tide
 * rises in the channel and either passes under the planks or carries them
 * away), and *measures* what went wrong before trying again. The arithmetic
 * is the same (low water + tide rise + storm wave, compared against a
 * limit); it is just the child's plan now instead of a quiz.
 *
 * Deliberately pure: every number, every transition, and every piece of
 * child-facing copy lives here, and the React panel and the Three.js scene
 * only render it. Heights are whole centimetres throughout.
 */

export interface TideBoard {
  /** Where the water sits when the tide is out, measured up from the channel bed. */
  lowWaterCm: number;
  /** How far tonight's tide lifts the water above low water. */
  tideRiseCm: number;
  /** The most a storm wave can add on top of the tide. */
  stormWaveCm: number;
  /** The highest deck Pip's barrel cart can still roll up onto. */
  cartLimitCm: number;
}

export const TIDE_BOARD: TideBoard = {
  lowWaterCm: 40,
  tideRiseCm: 85,
  stormWaveCm: 20,
  cartLimitCm: 170,
};

export const DECK_MIN_CM = 100;
export const DECK_MAX_CM = 200;
export const DECK_STEP_CM = 10;
/** Starts low enough to flood, so a child who just presses "go" sees what the tide does. */
export const DECK_START_CM = 110;

/** Where the tide alone takes the water. */
export function highTideCm(board: TideBoard = TIDE_BOARD): number {
  return board.lowWaterCm + board.tideRiseCm;
}

/** The highest the water can reach tonight: the tide plus the biggest storm wave. */
export function peakWaterCm(board: TideBoard = TIDE_BOARD): number {
  return highTideCm(board) + board.stormWaveCm;
}

export type TideOutcome =
  | { kind: 'DRY'; deckCm: number; peakWaterCm: number; spareCm: number }
  | { kind: 'FLOODED'; deckCm: number; peakWaterCm: number; shortByCm: number }
  | { kind: 'TOO_STEEP'; deckCm: number; cartLimitCm: number; overByCm: number };

/**
 * Judges a deck height against the board. Flooding is checked first: a deck
 * the water reaches is lost whatever else is true of it. Water level with the
 * underside of the deck counts as reaching it, since that is enough to lift
 * a plank.
 */
export function evaluateDeck(deckCm: number, board: TideBoard = TIDE_BOARD): TideOutcome {
  const peak = peakWaterCm(board);
  if (deckCm <= peak) {
    return { kind: 'FLOODED', deckCm, peakWaterCm: peak, shortByCm: peak - deckCm };
  }
  if (deckCm > board.cartLimitCm) {
    return {
      kind: 'TOO_STEEP',
      deckCm,
      cartLimitCm: board.cartLimitCm,
      overByCm: deckCm - board.cartLimitCm,
    };
  }
  return { kind: 'DRY', deckCm, peakWaterCm: peak, spareCm: deckCm - peak };
}

/** Moves the deck one step up or down, never past the ends of its range. */
export function stepDeck(deckCm: number, direction: 1 | -1): number {
  return Math.min(DECK_MAX_CM, Math.max(DECK_MIN_CM, deckCm + direction * DECK_STEP_CM));
}

/** How long the tide takes to come in, then how long the storm wave takes on top. */
export const TIDE_RISE_MS = 3500;
export const STORM_WAVE_MS = 1500;
export const TIDE_DURATION_MS = TIDE_RISE_MS + STORM_WAVE_MS;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

/**
 * The water level `elapsedMs` into a rising tide: a slow swell from low water
 * to high tide, then the storm wave on top. Whole centimetres, so the counter
 * a child watches ticks cleanly, and it ends exactly on `peakWaterCm`.
 */
export function tideLevelAt(elapsedMs: number, board: TideBoard = TIDE_BOARD): number {
  const high = highTideCm(board);
  if (elapsedMs <= 0) return board.lowWaterCm;
  if (elapsedMs < TIDE_RISE_MS) {
    const t = easeInOut(elapsedMs / TIDE_RISE_MS);
    return Math.round(board.lowWaterCm + (high - board.lowWaterCm) * t);
  }
  if (elapsedMs < TIDE_DURATION_MS) {
    const t = 1 - (1 - (elapsedMs - TIDE_RISE_MS) / STORM_WAVE_MS) ** 2;
    return Math.round(high + board.stormWaveCm * t);
  }
  return peakWaterCm(board);
}

export type TideTrialPhase = 'PLANNING' | 'TIDE_RISING' | 'RESULT';

export interface TideTrialState {
  phase: TideTrialPhase;
  deckCm: number;
  /** Tides brought in so far, this visit. */
  attempts: number;
  /** Set once a tide has been brought in; the verdict for the deck that faced it. */
  outcome: TideOutcome | null;
  /** How many rungs of `TIDE_TRIAL_HINTS` the child has asked to see. */
  hintsShown: number;
}

export type TideTrialEvent =
  | { type: 'RAISE_DECK' }
  | { type: 'LOWER_DECK' }
  | { type: 'BRING_TIDE' }
  | { type: 'TIDE_FINISHED' }
  | { type: 'TRY_AGAIN' }
  | { type: 'SHOW_HINT' };

export function initialTideTrialState(): TideTrialState {
  return {
    phase: 'PLANNING',
    deckCm: DECK_START_CM,
    attempts: 0,
    outcome: null,
    hintsShown: 0,
  };
}

/**
 * The challenge's only transitions. Anything not listed for the current
 * phase is ignored rather than thrown, so a double tap or a late animation
 * callback can never push the state somewhere it should not be.
 */
export function tideTrialReducer(state: TideTrialState, event: TideTrialEvent): TideTrialState {
  switch (event.type) {
    case 'RAISE_DECK':
    case 'LOWER_DECK':
      if (state.phase !== 'PLANNING') return state;
      return { ...state, deckCm: stepDeck(state.deckCm, event.type === 'RAISE_DECK' ? 1 : -1) };
    case 'BRING_TIDE':
      if (state.phase !== 'PLANNING') return state;
      return {
        ...state,
        phase: 'TIDE_RISING',
        attempts: state.attempts + 1,
        outcome: evaluateDeck(state.deckCm),
      };
    case 'TIDE_FINISHED':
      if (state.phase !== 'TIDE_RISING') return state;
      return { ...state, phase: 'RESULT' };
    case 'TRY_AGAIN':
      if (state.phase !== 'RESULT' || state.outcome?.kind === 'DRY') return state;
      return { ...state, phase: 'PLANNING' };
    case 'SHOW_HINT':
      return { ...state, hintsShown: Math.min(TIDE_TRIAL_HINTS.length, state.hintsShown + 1) };
  }
}

export function isTideTrialWon(state: TideTrialState): boolean {
  return state.phase === 'RESULT' && state.outcome?.kind === 'DRY';
}

// Child-facing copy. Readable aloud, no em dashes (CLAUDE.md section 13).

export const TIDE_TRIAL_COPY = {
  title: 'Beat the Tide',
  intro:
    'Ahoy! Every time I fix this bridge, the tide carries my planks away. The tide is out now, so we can build. How high should the new deck be?',
  boardHeading: "Pip's tide board",
  deckLabel: 'Deck height',
  raiseDeck: 'Raise the deck',
  lowerDeck: 'Lower the deck',
  bringTide: 'Build it and bring in the tide!',
  tideRising: 'Here comes the tide...',
  waterLabel: 'Water',
  tryAgain: 'Rebuild and try again',
  cross: 'Walk across the bridge',
  close: 'Not now',
  hint: 'Ask Chatty for a hint',
} as const;

export function tideBoardLines(board: TideBoard = TIDE_BOARD): string[] {
  return [
    `When the tide is out, the water is ${board.lowWaterCm} cm deep.`,
    `Tonight the tide lifts the water ${board.tideRiseCm} cm higher.`,
    `A storm wave can add up to ${board.stormWaveCm} cm more.`,
    `Pip's barrel cart can only roll up onto a deck up to ${board.cartLimitCm} cm high.`,
  ];
}

/** The result, told as what happened and then what the numbers say, so a retry has something to work from. */
export function outcomeMessage(outcome: TideOutcome, attempts: number): string[] {
  switch (outcome.kind) {
    case 'FLOODED':
      return [
        'Splash! The water lifted the planks and they floated away. Pip has plenty more.',
        outcome.shortByCm === 0
          ? `The water reached ${outcome.peakWaterCm} cm, exactly as high as your deck.`
          : `The water reached ${outcome.peakWaterCm} cm. Your deck was at ${outcome.deckCm} cm, so the water came up ${outcome.shortByCm} cm too high.`,
      ];
    case 'TOO_STEEP':
      return [
        'The deck stayed dry, but when Pip pushed his barrel cart up, it rolled right back down!',
        `The cart can only get up to ${outcome.cartLimitCm} cm. Your deck is ${outcome.overByCm} cm too high for it.`,
      ];
    case 'DRY':
      return [
        attempts === 1
          ? 'You worked it out before the tide even came! The water rushed under the deck and the planks stayed put.'
          : 'The water rushed under the deck and the planks stayed put. You measured, changed your plan, and beat the tide!',
        `The water reached ${outcome.peakWaterCm} cm and your deck is at ${outcome.deckCm} cm, with ${outcome.spareCm} cm to spare. The bridge is fixed!`,
      ];
  }
}

/** Scaffolds method first, and names a working answer only on the last rung. */
export const TIDE_TRIAL_HINTS: readonly string[] = [
  "Look at Pip's tide board. The water starts low, and then the tide lifts it.",
  'Add the tide to the low water: 40 cm and 85 cm. How high does the tide reach?',
  "Don't forget the storm wave. It can push the water 20 cm higher still.",
  '40 + 85 + 20 = 145 cm. The deck has to be higher than that, but not higher than the cart can climb.',
  'Any deck from 150 cm to 170 cm stays dry and lets the cart roll on.',
];
