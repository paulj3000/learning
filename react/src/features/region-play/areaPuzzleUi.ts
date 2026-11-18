import type {
  AnswerOutcome,
  InventoryEntry,
  JournalSubject,
  PuzzleOutcome,
  PuzzleState,
} from '../../api/play/types';
import {
  firstVariantIndex,
  nextVariantIndex,
  type ChoiceKindParams,
  type ChoiceOption,
  type PlatformParams,
  type PuzzleSymbol,
  type Stone,
} from './areaPuzzles';

/**
 * The rules behind the 3D Area puzzle UI (ADR-047 F, Firepeak FP-5 to FP-10), apart from React.
 * Nothing here grades or rewards: the server does. These only decide what to show.
 */

/** Child-facing copy. Readable aloud, localizable, no em dashes. Content comes from Django. */
export const AREA_COPY = {
  lookHere: 'Look here',
  seen: 'Found it!',
  tellProfessor: 'Tell Professor Ember',
  keepLooking: 'Keep looking. There is more to find.',
  checking: 'Checking...',
  notYet: 'Not quite yet. Let us look again!',
  hint: 'Hint',
  needHint: 'I would like a hint',
  close: 'Close',
  later: 'Not now',
  // Crossing
  carrying: 'You are carrying',
  pickUp: 'Pick up',
  putIn: 'Put it here',
  takeOut: 'Take it out',
  emptyGap: 'Empty',
  checkCrossing: 'Check the crossing',
  fitsGlow: 'This stone fits!',
  crossingWrong: 'One of the stones does not fit its gap. Try moving them around.',
  // Valves
  turn: 'Turn',
  turned: 'Turned',
  steamIsIn: 'The steam is in the',
  nothingHappened: 'Nothing happened. That valve has no steam in its pipe yet.',
  resetValves: 'Start the valves again',
  steamOut: 'The steam is going out!',
  // Crystal and return
  pickCrystal: 'Pick up the glowing crystal',
  showProfessor: 'Show Professor Ember the crystal',
  ropeLiftNotReady: 'The rope lift is not ready yet. Explore the cavern first!',
  lockedStage: 'Finish the part before this one first.',
  // Journal and safety
  journalTitle: 'Discovery Journal',
  journalEmpty: 'No discoveries yet. Explore to fill your journal!',
  discoveredOn: 'Discovered',
  lavaTooHot: 'Whoa, the lava is too hot! Back to safety.',
  // Choose an answer and put in order
  checkAnswer: 'Check my answer',
  checkOrder: 'Check my order',
  tryDifferent: 'Try a different one',
  chooseOne: 'Choose one',
  chosen: 'Chosen',
  notQuiteAgain: 'Not quite. Let us look again!',
  orderNotQuite: 'Not quite. Let us look again and try the order once more.',
  gotIt: 'You got it!',
  practiceBadge: 'Practice',
  practiceNote: 'This is practice. Nothing changes, so try as many as you like.',
  practiceRight: 'Yes! That is right.',
  practiceAgain: 'Practice another one',
  practiceOpen: 'Practice this again',
  yourOrder: 'Your order',
  emptyOrder: 'Tap the items below, one at a time, in the order you choose.',
  addToOrder: 'Add',
  undoLast: 'Undo',
  clearOrder: 'Start over',
  position: 'Step',
  unavailable: 'This puzzle is not ready yet.',
} as const;

const SYMBOL_GLYPHS: Record<PuzzleSymbol, string> = {
  circle: '\u25CF',
  square: '\u25A0',
  triangle: '\u25B2',
  star: '\u2605',
  diamond: '\u25C6',
  hexagon: '\u2B22',
  heart: '\u2665',
  moon: '\u263E',
};

/** The shape drawn next to an option, so it never depends on colour alone. */
export function symbolGlyph(symbol: PuzzleSymbol | null): string {
  return symbol ? SYMBOL_GLYPHS[symbol] : '';
}

/** An option as one line to read aloud: its symbol's name, then its label. */
export function optionSpoken(option: ChoiceOption): string {
  return option.symbol ? `${option.symbol}, ${option.label}` : option.label;
}

// --- CHOOSE_ANSWER and ORDER_SEQUENCE: one state per puzzle id -----------------------------------

export interface ChoiceState {
  variantIndex: number;
  /** CHOOSE_ANSWER: the option picked, not yet checked. */
  selected: string | null;
  /** ORDER_SEQUENCE: the items tapped so far, in order. */
  order: string[];
  /** Wrong tries on this variant (the hint is offered from this). */
  wrongCount: number;
  hintAsked: boolean;
  result: 'none' | 'wrong' | 'correct';
  /** The puzzle was already solved when this question was opened: grading only. */
  practice: boolean;
}

function blank(variantIndex: number, practice: boolean): ChoiceState {
  return {
    variantIndex,
    selected: null,
    order: [],
    wrongCount: 0,
    hintAsked: false,
    result: 'none',
    practice,
  };
}

/**
 * The state when a puzzle is first opened this visit: the deterministic first variant, or, for a
 * puzzle already solved, the next one (practice).
 */
export function openChoiceState(
  sessionId: string,
  puzzleId: string,
  params: ChoiceKindParams,
  solved: boolean,
): ChoiceState {
  const count = params.variants.length;
  const first = firstVariantIndex(sessionId, puzzleId, count);
  return blank(solved ? nextVariantIndex(first, count) : first, solved);
}

/** Opening a puzzle again: a finished question gives way to the next variant. */
export function reopenChoiceState(
  state: ChoiceState,
  params: ChoiceKindParams,
  solved: boolean,
): ChoiceState {
  if (state.result === 'correct' || (solved && !state.practice)) {
    return blank(nextVariantIndex(state.variantIndex, params.variants.length), solved);
  }
  return state;
}

/** "Try a different one": the next variant, a fresh question. */
export function differentChoiceState(
  state: ChoiceState,
  params: ChoiceKindParams,
): ChoiceState {
  return blank(nextVariantIndex(state.variantIndex, params.variants.length), state.practice);
}

export function selectOption(state: ChoiceState, optionId: string): ChoiceState {
  return { ...state, selected: optionId, result: state.result === 'correct' ? 'correct' : 'none' };
}

/** Adds an item to the end of the order unless it is already there. */
export function addToOrder(state: ChoiceState, itemId: string): ChoiceState {
  if (state.order.includes(itemId)) return state;
  return { ...state, order: [...state.order, itemId], result: 'none' };
}

export function undoOrder(state: ChoiceState): ChoiceState {
  return { ...state, order: state.order.slice(0, -1), result: 'none' };
}

export function clearOrder(state: ChoiceState): ChoiceState {
  return { ...state, order: [], result: 'none' };
}

export function recordChoiceResult(state: ChoiceState, correct: boolean): ChoiceState {
  return correct
    ? { ...state, result: 'correct' }
    : { ...state, result: 'wrong', wrongCount: state.wrongCount + 1 };
}

/** The lines shown after a right answer: why, then the band's closing lines. */
export function successLines(
  explanation: string,
  params: Pick<ChoiceKindParams, 'completeMessage' | 'scienceNote'>,
): string[] {
  return [explanation, params.completeMessage, params.scienceNote].filter(
    (line): line is string => Boolean(line),
  );
}

const SUBJECT_LABELS: Record<JournalSubject, string> = {
  EARTH_SCIENCE: 'Earth science',
  MATHEMATICS: 'Mathematics',
  SPATIAL_REASONING: 'Spatial reasoning',
  PROBLEM_SOLVING: 'Problem solving',
};

export function subjectLabel(subject: JournalSubject): string {
  return SUBJECT_LABELS[subject];
}

/** The puzzle a scene entity belongs to, if any. */
export function puzzleForEntity(
  puzzles: readonly PuzzleState[],
  entityId: string,
): PuzzleState | undefined {
  return puzzles.find((puzzle) => puzzle.entityIds.includes(entityId));
}

/** The puzzle the child is on now: the first unsolved one that is not locked. */
export function currentPuzzle(puzzles: readonly PuzzleState[]): PuzzleState | undefined {
  return puzzles.find((puzzle) => !puzzle.solved && !puzzle.locked);
}

export interface JournalEntryView {
  itemId: string;
  title: string;
  description: string;
  subject: string;
  discoveredAt: string;
  questId: string;
}

/** Discovery Journal entries from the child's inventory (server data), oldest first. */
export function journalEntries(inventory: readonly InventoryEntry[]): JournalEntryView[] {
  return inventory
    .filter((entry) => entry.item.journal !== null)
    .map((entry) => ({
      itemId: entry.item.itemId,
      title: entry.item.displayName,
      description: entry.item.description,
      subject: subjectLabel(entry.item.journal!.subject),
      discoveredAt: entry.grantedAt,
      questId: entry.item.journal!.questId,
    }))
    .sort((a, b) => a.discoveredAt.localeCompare(b.discoveredAt));
}

/** A date a child's grown-up can read, without the time. */
export function readableDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Where the stones sit once the crossing is solved, so a returning child sees the bridge they
 * built: each gap takes the first unused stone of its size (the server already accepted one).
 */
export function solvedPlacements(params: PlatformParams): Record<string, string> {
  const used = new Set<string>();
  const placements: Record<string, string> = {};
  for (const slot of params.slots) {
    const stone = params.stones.find((s) => s.size === slot.gap && !used.has(s.id));
    if (stone) {
      used.add(stone.id);
      placements[slot.id] = stone.id;
    }
  }
  return placements;
}

/** Slots whose stone fits, for the visible glow. */
export function fittingSlots(params: PlatformParams, placements: Record<string, string>): string[] {
  const sizes = new Map(params.stones.map((stone: Stone) => [stone.id, stone.size]));
  return params.slots
    .filter((slot) => sizes.get(placements[slot.id] ?? '') === slot.gap)
    .map((slot) => slot.id);
}

/** Puts `stone` into `slot`, taking it out of any other gap first; the stone already there leaves. */
export function placeStone(
  placements: Readonly<Record<string, string>>,
  stone: string,
  slot: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(placements)) {
    if (value !== stone && key !== slot) next[key] = value;
  }
  next[slot] = stone;
  return next;
}

export function removeStone(
  placements: Readonly<Record<string, string>>,
  stone: string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(placements).filter(([, value]) => value !== stone));
}

/** A puzzle outcome as the reward reveal reads it (the shape of a chest outcome). */
export function asRevealOutcome(outcome: PuzzleOutcome): AnswerOutcome {
  return {
    attemptId: outcome.attemptId ?? '',
    correct: outcome.correct,
    feedback: outcome.feedback,
    canRetry: false,
    chestOpened: false,
    newItems: outcome.newItems,
    rewardMessage: outcome.rewardMessage,
    questUpdates: outcome.questUpdates,
    completionRewards: [],
  };
}
