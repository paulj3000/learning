import {
  PAINTED_WORDS_AGAIN_SLUG,
  PAINTED_WORDS_SLUG,
} from '../../adventures/content/thePaintedWords';
import { PAINTED_WORD_BANK } from '../../adventures/content/paintedWordsBank';
import type { AdventureDefinition, AdventureStep } from '../../adventures/engine/types';
import type { StepAnswer } from '../../adventures/engine/validators';
import { STUDIO_PAD_GROUP, padZoneId } from './runtime/manifests/castleRooms/castlePlatforms';
import {
  bindingsForStep,
  resolveEntityBinding,
  seatedEntitiesToOrder,
  type AdventureStepBinding,
} from './runtime/adventureStepBindings';
import {
  QUILLS_PICTURE_STORY_SLUG,
  SECRET_DOOR_CHAPTER_1_SLUG,
  SECRET_DOOR_CHAPTER_2_SLUG,
  THE_STORYKEEPERS_TALE_SLUG,
} from './castleChoiceBindings';

/**
 * What standing on a castle pad means (SC-JMP). Pure data and pure lookups: no `three`, no React.
 *
 * The rule this file exists to keep, the same as `castleChoiceBindings.ts`: **a pad is a second
 * way to give an answer a step already accepts, and nothing more.** A pad resolves to an option
 * id the step already declares and stops. The adventure engine grades it, the same
 * `submitAnswer` the HUD card uses advances the step, and the server writes any reward. So a
 * pad answer and the ground answer for the same option produce the same transition by
 * construction (`castlePlatformAnswers.test.ts` holds that against the real engine), and a pad
 * stepped on again, or on after the step has moved on, can never produce a second reward.
 */

/** The three painted pads of the Illustration Studio, in order (`red`, `blue`, `yellow`). */
export const PAINTED_WORDS_PAD_KEYS: readonly string[] = STUDIO_PAD_GROUP.pads.map(
  (pad) => pad.key,
);

const bind = (
  templateSlug: string,
  stepId: string,
  groupId: string,
  pairs: readonly (readonly [padKey: string, optionId: string])[],
): AdventureStepBinding[] =>
  pairs.map(([padKey, optionId]) => ({
    entityId: padZoneId(groupId, padKey),
    templateSlug,
    stepId,
    optionId,
  }));

/**
 * Pad zone to option, for every pad whose meaning does not depend on the step's words. The
 * Painted Words pads are the other kind (`paintedWordsPadSlots`): their words come from the
 * approved bank and the set chosen for this play, never from here.
 */
export const CASTLE_PAD_BINDINGS: readonly AdventureStepBinding[] = [
  // Beat 6: the story stones, in the same left to right order as the plates (not the story order).
  ...bind(THE_STORYKEEPERS_TALE_SLUG, 'order-the-story', 'story-hall', [
    ['choice', 'beat-choice'],
    ['ending', 'beat-ending'],
    ['problem', 'beat-problem'],
  ]),
  // The Sprouts picture story: two of the same stones (the choice stone does nothing here).
  ...bind(QUILLS_PICTURE_STORY_SLUG, 'what-happened-first', 'story-hall', [
    ['ending', 'picture-ending'],
    ['problem', 'picture-problem'],
  ]),
  // Beat 9: three enchanted books, stepped on in the order the clues were written.
  ...bind(SECRET_DOOR_CHAPTER_1_SLUG, 'order-the-clues', 'library-books', [
    ['note', 'clue-note'],
    ['diary', 'clue-diary'],
    ['map', 'clue-map'],
  ]),
  // Beat 10: the pattern carvings, and the rods as three heights of stone.
  ...bind(SECRET_DOOR_CHAPTER_2_SLUG, 'continue-the-pattern', 'library-pattern', [
    ['star', 'star'],
    ['sun', 'sun'],
    ['moon', 'moon'],
  ]),
  ...bind(SECRET_DOOR_CHAPTER_2_SLUG, 'order-the-keys', 'library-measure', [
    ['iron', 'medium-rod'],
    ['brass', 'long-rod'],
    ['silver', 'short-rod'],
  ]),
];

// --- the Painted Words pads ----------------------------------------------------------------------

export const PAINTED_WORDS_SLUGS: readonly string[] = [
  PAINTED_WORDS_SLUG,
  PAINTED_WORDS_AGAIN_SLUG,
];

export interface PaintedWordsPadSlot {
  /** `red`, `blue` or `yellow`. */
  padKey: string;
  /** The step's own option id (`opt-hat`). */
  optionId: string;
  /** The word on the pad: always an entry of the approved bank. */
  word: string;
  /** The picture card the word wears: the bank's `pictureId`. */
  pictureId: string;
  /** Whether the step grades this option correct (for tests and parent copy; never shown). */
  correct: boolean;
}

/**
 * The words on the three pads for one Painted Words choice step: its own options, in its own
 * order (one per pad). The odd-one-out step has four words; the pads carry the odd one and the
 * first two rhyming ones, so there are always exactly three pads and exactly one correct one.
 * Returns `null` for a step that is not a choice, or whose labels are not all in the approved bank
 * (a pad never shows a word the bank has not approved).
 */
export function paintedWordsPadSlots(step: AdventureStep): PaintedWordsPadSlot[] | null {
  const { presentation } = step;
  if (presentation.kind !== 'choice') return null;
  const { options, correctOptionId } = presentation;
  if (!options.every((option) => PAINTED_WORD_BANK[option.label] !== undefined)) return null;
  let shown = options;
  if (options.length > PAINTED_WORDS_PAD_KEYS.length) {
    const correct = options.find((option) => option.id === correctOptionId);
    if (!correct) return null;
    const others = options.filter((option) => option.id !== correctOptionId);
    const keep = new Set([
      correct.id,
      ...others.slice(0, PAINTED_WORDS_PAD_KEYS.length - 1).map((o) => o.id),
    ]);
    shown = options.filter((option) => keep.has(option.id));
  }
  return shown.map((option, index) => ({
    padKey: PAINTED_WORDS_PAD_KEYS[index],
    optionId: option.id,
    word: option.label,
    pictureId: PAINTED_WORD_BANK[option.label].pictureId,
    correct: option.id === correctOptionId,
  }));
}

/** What a child who cannot see the pads is told: which colour is which word. Readable aloud. */
export function paintedWordsPadGuide(step: AdventureStep): string | null {
  const slots = paintedWordsPadSlots(step);
  if (!slots) return null;
  return slots.map((slot) => `The ${slot.padKey} pad says ${slot.word}.`).join(' ');
}

// --- resolving a pad ---------------------------------------------------------------------------------

export type PadResolution =
  /** One pad is the whole answer (a choice). */
  | { kind: 'answer'; answer: StepAnswer }
  /** One pad is one place in an ordering; the answer is the pads stepped on, in order. */
  | { kind: 'order-entry'; optionId: string; itemIds: readonly string[] };

/**
 * What a pad's zone means for the step that is open, or `null` when it means nothing right now
 * (a pad of another adventure, another step, or no step at all). Never throws on a step that does
 * not match, so a stray zone event is simply ignored.
 */
export function resolvePadAnswer(
  zoneId: string,
  definition: AdventureDefinition,
  step: AdventureStep | null,
): PadResolution | null {
  if (!step) return null;
  const { presentation } = step;

  if (PAINTED_WORDS_SLUGS.includes(definition.slug)) {
    const slot = paintedWordsPadSlots(step)?.find(
      (candidate) => padZoneId(STUDIO_PAD_GROUP.id, candidate.padKey) === zoneId,
    );
    return slot ? { kind: 'answer', answer: { kind: 'choice', optionId: slot.optionId } } : null;
  }

  const binding = resolveEntityBinding(CASTLE_PAD_BINDINGS, zoneId, definition.slug);
  if (!binding || binding.stepId !== step.id) return null;
  if (presentation.kind === 'choice')
    return { kind: 'answer', answer: { kind: 'choice', optionId: binding.optionId } };
  if (presentation.kind === 'creative-choice') {
    return { kind: 'answer', answer: { kind: 'creative-choice', optionId: binding.optionId } };
  }
  if (presentation.kind === 'ordering') {
    return {
      kind: 'order-entry',
      optionId: binding.optionId,
      itemIds: presentation.items.map((item) => item.id),
    };
  }
  return null;
}

/** The pad zones that mean something to a step: for a test, and for the panel's "pads here" hint. */
export function padZonesForStep(definition: AdventureDefinition, step: AdventureStep): string[] {
  if (PAINTED_WORDS_SLUGS.includes(definition.slug)) {
    return (paintedWordsPadSlots(step) ?? []).map((slot) =>
      padZoneId(STUDIO_PAD_GROUP.id, slot.padKey),
    );
  }
  return bindingsForStep(CASTLE_PAD_BINDINGS, definition.slug, step.id).map(
    (binding) => binding.entityId,
  );
}

// --- an ordering, one stone at a time -----------------------------------------------------------------

export interface PadOrderCollector {
  /**
   * Records one stepped-on option. Returns the complete order once every item has been stepped on
   * exactly once (and starts afresh), otherwise `null`. A stone stepped on twice in one try is
   * ignored, so a hop back onto it changes nothing.
   */
  step(optionId: string, itemIds: readonly string[]): string[] | null;
  /** The options stepped on so far in this try. */
  readonly stepped: readonly string[];
  reset(): void;
}

export function createPadOrderCollector(): PadOrderCollector {
  let stepped: string[] = [];
  return {
    get stepped() {
      return stepped;
    },
    step(optionId, itemIds) {
      if (!itemIds.includes(optionId) || stepped.includes(optionId)) return null;
      stepped = [...stepped, optionId];
      if (stepped.length < itemIds.length) return null;
      const order = stepped;
      stepped = [];
      return order;
    },
    reset() {
      stepped = [];
    },
  };
}

/**
 * The same translation the plates, clues and rods use (`seatedEntitiesToOrder`), for pads: zone
 * ids stepped on, in order, to the option ids an `ORDERING` answer carries. `null` when the row is
 * not a whole answer.
 */
export function padsToOrder(
  templateSlug: string,
  stepId: string,
  steppedZoneIds: readonly string[],
): string[] | null {
  return seatedEntitiesToOrder(CASTLE_PAD_BINDINGS, templateSlug, stepId, steppedZoneIds);
}

// --- one submit at a time --------------------------------------------------------------------------------

export interface PadGate {
  /** True when this pad may submit now; false while an earlier pad's answer is still being graded. */
  begin(): boolean;
  end(): void;
  readonly busy: boolean;
}

/**
 * A pad answer never overlaps another: while one is being graded, further landings are ignored, so
 * a child bouncing between pads cannot submit twice for one moment, and a repeated landing cannot
 * produce a second grading, a second hint step or a second reward request.
 */
export function createPadGate(): PadGate {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    begin() {
      if (busy) return false;
      busy = true;
      return true;
    },
    end() {
      busy = false;
    },
  };
}
