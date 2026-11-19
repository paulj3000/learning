import { describe, expect, it } from 'vitest';
import { reachableWithoutAnswering } from '../../great-storybook/adventureMapping';
import { decideSubmission } from '../engine/submission';
import { getNextStepId } from '../engine/transitions';
import { getStep, type AdventureDefinition } from '../engine/types';
import { validateStepAnswer, type StepAnswer } from '../engine/validators';
import { getAdventureTemplate, isAdventureForAgeBand, LEARNING_OBJECTIVES } from './index';
import {
  PAINTED_WORD_BANK,
  PAINTED_WORDS_SETS,
  wordOf,
  type PaintedWordsSet,
} from './paintedWordsBank';
import {
  PAINTED_WORDS_ADVENTURES,
  PAINTED_WORDS_CHANGE_KEY,
  PAINTED_WORDS_AGAIN_SLUG,
  PAINTED_WORDS_SLUG,
  THE_PAINTED_WORDS,
  selectPaintedWordsSlug,
} from './thePaintedWords';

const EM_DASH = '—';

function groups(set: PaintedWordsSet) {
  return [
    ...set.rhymes.map((q) => ({ target: q.target, answer: q.answer, other: q.distractors })),
  ];
}

describe('the approved word bank is phonologically correct', () => {
  for (const set of PAINTED_WORDS_SETS) {
    describe(set.setId, () => {
      it('uses only words in the bank', () => {
        const all = [
          ...set.rhymes.flatMap((q) => [q.target, q.answer, ...q.distractors]),
          ...set.beginnings.flatMap((q) => [q.target, q.answer, ...q.distractors]),
          ...set.oddOneOut.rhyming,
          set.oddOneOut.odd,
          ...set.syllables.map((q) => q.word),
        ];
        for (const word of all) expect(PAINTED_WORD_BANK[word], word).toBeDefined();
      });

      it('rhymes: the answer shares the target rime and no distractor does', () => {
        for (const q of set.rhymes) {
          const rime = wordOf(q.target).rime;
          expect(wordOf(q.answer).rime, q.id).toBe(rime);
          for (const d of q.distractors) expect(wordOf(d).rime, `${q.id}/${d}`).not.toBe(rime);
        }
      });

      it('beginning sounds: the answer shares the first sound and no distractor does', () => {
        for (const q of set.beginnings) {
          const onset = wordOf(q.target).onset;
          expect(wordOf(q.answer).onset, q.id).toBe(onset);
          for (const d of q.distractors) expect(wordOf(d).onset, `${q.id}/${d}`).not.toBe(onset);
        }
      });

      it('odd one out: three words share a rime and the fourth does not', () => {
        const q = set.oddOneOut;
        const rime = wordOf(q.rhyming[0]).rime;
        for (const w of q.rhyming) expect(wordOf(w).rime).toBe(rime);
        expect(wordOf(q.odd).rime).not.toBe(rime);
      });

      it('syllables: the clapped parts match the count', () => {
        for (const q of set.syllables) {
          const entry = wordOf(q.word);
          expect(entry.parts.split('-')).toHaveLength(entry.syllables);
        }
      });

      it('has no question that repeats a target', () => {
        const targets = groups(set).map((g) => g.target);
        expect(new Set(targets).size).toBe(targets.length);
      });
    });
  }

  it('the two sets share no question target, so a replay is genuinely fresh', () => {
    const [a, b] = PAINTED_WORDS_SETS;
    const targets = (s: PaintedWordsSet) => [
      ...s.rhymes.map((q) => q.target),
      ...s.beginnings.map((q) => q.target),
      ...s.syllables.map((q) => q.word),
    ];
    const shared = targets(a).filter((t) => targets(b).includes(t));
    expect(shared).toEqual([]);
  });
});

describe.each(PAINTED_WORDS_ADVENTURES)('$slug', (adventure: AdventureDefinition) => {
  const answerFor = (stepId: string, correct: boolean): StepAnswer => {
    const step = getStep(adventure, stepId);
    const p = step.presentation;
    if (p.kind === 'choice') {
      const wrong = p.options.find((o) => o.id !== p.correctOptionId);
      return { kind: 'choice', optionId: correct ? p.correctOptionId : (wrong?.id ?? 'x') };
    }
    if (p.kind === 'number-input') {
      return { kind: 'number-input', value: correct ? p.correctValue : p.correctValue + 1 };
    }
    throw new Error(`step ${stepId} is not graded`);
  };

  it('is for Pathfinders only', () => {
    expect(isAdventureForAgeBand(adventure, 'PATHFINDER')).toBe(true);
    expect(isAdventureForAgeBand(adventure, 'SPROUT')).toBe(false);
    expect(isAdventureForAgeBand(adventure, 'EXPLORER')).toBe(false);
  });

  it('is registered and targets a catalogued objective', () => {
    expect(getAdventureTemplate(adventure.slug)).toBe(adventure);
    const codes = LEARNING_OBJECTIVES.map((o) => o.code);
    for (const step of adventure.steps) {
      for (const id of step.objectiveIds) expect(codes).toContain(id);
    }
    expect(codes).toContain('phonemic-awareness');
  });

  it('every graded step has a five rung hint ladder and an authored fallback', () => {
    for (const step of adventure.steps) {
      expect(step.fallback.text.length, step.id).toBeGreaterThan(0);
      if (step.type === 'CHOICE' || step.type === 'NUMBER_INPUT') {
        expect(step.hintPolicy?.ladder, step.id).toHaveLength(5);
      }
    }
  });

  it('a wrong answer loops to the same step and a right one moves on', () => {
    for (const step of adventure.steps) {
      if (step.type !== 'CHOICE' && step.type !== 'NUMBER_INPUT') continue;
      const wrong = validateStepAnswer(step, answerFor(step.id, false));
      const right = validateStepAnswer(step, answerFor(step.id, true));
      expect(wrong, step.id).toBe('incorrect');
      expect(right, step.id).toBe('correct');
      expect(getNextStepId(step, 'incorrect')).toBe(step.id);
      expect(getNextStepId(step, 'correct')).not.toBe(step.id);
    }
  });

  it('a child who keeps getting it wrong is carried forward, never stuck or penalised', () => {
    const step = getStep(adventure, adventure.steps.find((s) => s.type === 'CHOICE')!.id);
    const decision = decideSubmission(step, answerFor(step.id, false), 4);
    expect(decision.action).toBe('ADVANCE');
  });

  it('can be completed by answering correctly, and writes the world change exactly once', () => {
    let id = adventure.entryStepId;
    const written: string[] = [];
    const seen: string[] = [];
    for (let guard = 0; guard < 40; guard++) {
      seen.push(id);
      const step = getStep(adventure, id);
      if (step.presentation.kind === 'world-change') {
        written.push(step.presentation.payload.changeKey);
      }
      if (step.type === 'COMPLETE') break;
      const graded = step.type === 'CHOICE' || step.type === 'NUMBER_INPUT';
      id = getNextStepId(step, graded ? 'correct' : 'correct');
    }
    expect(seen.at(-1)).toBe('complete');
    expect(written).toEqual([PAINTED_WORDS_CHANGE_KEY]);
  });

  it('awards the page only after a graded answer, never for opening or viewing', () => {
    expect(reachableWithoutAnswering(adventure, 'page-mended')).toBe(false);
  });

  it('has no timers, no free text and no em dashes in child-facing copy', () => {
    const text = JSON.stringify(adventure);
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toMatch(/short-response|timer|countdown|seconds left/i);
  });

  it('every choice puts the answer among three or four distinct options', () => {
    for (const step of adventure.steps) {
      if (step.presentation.kind !== 'choice') continue;
      const ids = step.presentation.options.map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain(step.presentation.correctOptionId);
      expect(ids.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('replay selection', () => {
  it('plays set A first and set B once the page is mended', () => {
    expect(selectPaintedWordsSlug([])).toBe(PAINTED_WORDS_SLUG);
    expect(selectPaintedWordsSlug(['FIRST_STORY_TOLD'])).toBe(PAINTED_WORDS_SLUG);
    expect(selectPaintedWordsSlug([PAINTED_WORDS_CHANGE_KEY])).toBe(PAINTED_WORDS_AGAIN_SLUG);
  });

  it('both play-throughs write the same world change, so a replay grants nothing new', () => {
    const keys = PAINTED_WORDS_ADVENTURES.map((a) =>
      a.steps.flatMap((s) =>
        s.presentation.kind === 'world-change'
          ? [`${s.presentation.payload.locationSlug}/${s.presentation.payload.changeKey}`]
          : [],
      ),
    );
    expect(keys[0]).toEqual(keys[1]);
    expect(THE_PAINTED_WORDS.locationSlug).toBe('storykeeper-castle');
  });
});
