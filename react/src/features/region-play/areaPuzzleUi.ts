import type {
  AnswerOutcome,
  InventoryEntry,
  JournalSubject,
  PuzzleOutcome,
  PuzzleState,
} from '../../api/play/types';
import type { PlatformParams, Stone } from './areaPuzzles';

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
} as const;

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
