import { describe, expect, it } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../../adventures/content';
import {
  PAINTED_WORDS_ADVENTURES,
  THE_PAINTED_WORDS,
  THE_PAINTED_WORDS_AGAIN,
  selectPaintedWordsSlug,
  PAINTED_WORDS_CHANGE_KEY,
} from '../../adventures/content/thePaintedWords';
import { PAINTED_WORDS_SETS, PAINTED_WORD_BANK } from '../../adventures/content/paintedWordsBank';
import { decideSubmission } from '../../adventures/engine/submission';
import type { AdventureDefinition, AdventureStep } from '../../adventures/engine/types';
import { findAdventureBindingIssues } from './runtime/adventureStepBindings';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './runtime/manifests/storykeeperCastle';
import { isPadZoneId, padZoneId } from './runtime/manifests/castleRooms/castlePlatforms';
import {
  CASTLE_PAD_BINDINGS,
  PAINTED_WORDS_PAD_KEYS,
  createPadGate,
  createPadOrderCollector,
  padZonesForStep,
  paintedWordsPadGuide,
  paintedWordsPadSlots,
  resolvePadAnswer,
  padsToOrder,
} from './castlePlatformAnswers';

/**
 * Pad answers against the real adventure engine: a pad is another way to give an answer, never a
 * way to skip, grade or reward. Everything is decided by `decideSubmission`, the same function
 * the HUD card's answer goes through.
 */

const adventure = (slug: string): AdventureDefinition => {
  const found = ADVENTURE_TEMPLATES.find((template) => template.slug === slug);
  if (!found) throw new Error(`no adventure ${slug}`);
  return found;
};
const stepOf = (definition: AdventureDefinition, id: string): AdventureStep =>
  definition.steps.find((step) => step.id === id)!;

describe('static pad bindings', () => {
  it('name real adventures, steps and options, one pad for each option, on pads that exist', () => {
    expect(
      findAdventureBindingIssues(CASTLE_PAD_BINDINGS, {
        adventures: ADVENTURE_TEMPLATES,
        placedEntityIds: MANIFEST.zones.map((zone) => zone.rect.id),
      }),
    ).toEqual([]);
  });

  it('only ever points at pad zones', () => {
    for (const binding of CASTLE_PAD_BINDINGS)
      expect(isPadZoneId(binding.entityId), binding.entityId).toBe(true);
  });

  it('puts the story stones in the plates’ own order, not the story’s (neither route starts at the answer)', () => {
    const tale = CASTLE_PAD_BINDINGS.filter((binding) => binding.stepId === 'order-the-story').map(
      (b) => b.optionId,
    );
    const step = stepOf(adventure('the-storykeepers-tale'), 'order-the-story');
    if (step.presentation.kind !== 'ordering') throw new Error('not an ordering');
    expect(tale).not.toEqual(step.presentation.correctOrder);
    const clues = CASTLE_PAD_BINDINGS.filter((binding) => binding.stepId === 'order-the-clues').map(
      (b) => b.optionId,
    );
    const clueStep = stepOf(adventure('secret-door-chapter-1-three-clues'), 'order-the-clues');
    if (clueStep.presentation.kind !== 'ordering') throw new Error('not an ordering');
    expect(clues).not.toEqual(clueStep.presentation.correctOrder);
  });
});

describe('a pad answer is the ground answer', () => {
  const HUD = (optionId: string) => ({ kind: 'choice', optionId }) as const;

  it('gives the same decision as the HUD card for every single-pad step, right and wrong', () => {
    const cases: [slug: string, stepId: string][] = [
      ['secret-door-chapter-2-pattern-lock', 'continue-the-pattern'],
    ];
    for (const [slug, stepId] of cases) {
      const definition = adventure(slug);
      const step = stepOf(definition, stepId);
      for (const zoneId of padZonesForStep(definition, step)) {
        const resolved = resolvePadAnswer(zoneId, definition, step);
        if (resolved?.kind !== 'answer') throw new Error('expected a single-pad answer');
        const optionId = (resolved.answer as { optionId: string }).optionId;
        for (const hint of [0, 1, 2]) {
          expect(decideSubmission(step, resolved.answer, hint)).toEqual(
            decideSubmission(step, HUD(optionId), hint),
          );
        }
      }
    }
  });

  it('grades the pattern: only the moon stone is right, and a wrong stone does not advance', () => {
    const definition = adventure('secret-door-chapter-2-pattern-lock');
    const step = stepOf(definition, 'continue-the-pattern');
    const decisions = Object.fromEntries(
      padZonesForStep(definition, step).map((zoneId) => {
        const resolved = resolvePadAnswer(zoneId, definition, step);
        if (resolved?.kind !== 'answer') throw new Error('expected an answer');
        return [zoneId, decideSubmission(step, resolved.answer, 0)];
      }),
    );
    expect(decisions[padZoneId('library-pattern', 'moon')]).toMatchObject({
      correctness: 'correct',
      action: 'ADVANCE',
    });
    expect(decisions[padZoneId('library-pattern', 'star')]).toMatchObject({
      correctness: 'incorrect',
      action: 'RETRY',
    });
    expect(decisions[padZoneId('library-pattern', 'star')].nextStepId).toBeUndefined();
    expect(decisions[padZoneId('library-pattern', 'sun')]).toMatchObject({ action: 'RETRY' });
  });

  it('orders by stepping: the right order advances exactly as the HUD list does, a wrong one retries', () => {
    const orderings: [slug: string, stepId: string, rightPads: string[]][] = [
      [
        'the-storykeepers-tale',
        'order-the-story',
        ['problem', 'choice', 'ending'].map((key) => padZoneId('story-hall', key)),
      ],
      [
        'secret-door-chapter-1-three-clues',
        'order-the-clues',
        ['diary', 'map', 'note'].map((key) => padZoneId('library-books', key)),
      ],
      [
        'secret-door-chapter-2-pattern-lock',
        'order-the-keys',
        ['silver', 'iron', 'brass'].map((key) => padZoneId('library-measure', key)),
      ],
      [
        'quills-picture-story',
        'what-happened-first',
        ['problem', 'ending'].map((key) => padZoneId('story-hall', key)),
      ],
    ];
    for (const [slug, stepId, rightPads] of orderings) {
      const definition = adventure(slug);
      const step = stepOf(definition, stepId);
      const collector = createPadOrderCollector();
      const stepZones = (zones: string[]) => {
        let result: string[] | null = null;
        for (const zone of zones) {
          const resolved = resolvePadAnswer(zone, definition, step);
          if (resolved?.kind !== 'order-entry') throw new Error(`${zone} is not an order entry`);
          result = collector.step(resolved.optionId, resolved.itemIds);
        }
        return result;
      };
      const right = stepZones(rightPads);
      expect(right, `${slug} right order`).not.toBeNull();
      expect(right).toEqual(padsToOrder(slug, stepId, rightPads));
      expect(decideSubmission(step, { kind: 'ordering', order: right! }, 0)).toMatchObject({
        correctness: 'correct',
        action: 'ADVANCE',
      });
      const wrong = stepZones([...rightPads].reverse());
      expect(wrong, `${slug} wrong order`).not.toBeNull();
      expect(decideSubmission(step, { kind: 'ordering', order: wrong! }, 0)).toMatchObject({
        correctness: 'incorrect',
        action: 'RETRY',
      });
    }
  });

  it('means nothing for a step that is not open, or another adventure', () => {
    const tale = adventure('the-storykeepers-tale');
    const stone = padZoneId('story-hall', 'choice');
    expect(resolvePadAnswer(stone, tale, stepOf(tale, 'choose-hero'))).toBeNull();
    expect(resolvePadAnswer(stone, tale, null)).toBeNull();
    expect(
      resolvePadAnswer(padZoneId('library-books', 'diary'), tale, stepOf(tale, 'order-the-story')),
    ).toBeNull();
    expect(resolvePadAnswer('tower-window-cave', tale, stepOf(tale, 'order-the-story'))).toBeNull();
  });
});

describe('repeated pad signals never repeat anything', () => {
  it('lets one pad answer be graded at a time, and ignores a landing while one is in flight', () => {
    const gate = createPadGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    expect(gate.begin()).toBe(false);
    gate.end();
    expect(gate.begin()).toBe(true);
  });

  it('ignores a stone stepped on twice in one try, and starts a fresh try after a whole answer', () => {
    const items = ['beat-problem', 'beat-choice', 'beat-ending'];
    const collector = createPadOrderCollector();
    expect(collector.step('beat-problem', items)).toBeNull();
    expect(collector.step('beat-problem', items)).toBeNull();
    expect(collector.stepped).toEqual(['beat-problem']);
    expect(collector.step('beat-choice', items)).toBeNull();
    expect(collector.step('beat-ending', items)).toEqual([
      'beat-problem',
      'beat-choice',
      'beat-ending',
    ]);
    expect(collector.stepped).toEqual([]);
    // A stone that is not one of the step's items is ignored.
    expect(collector.step('beat-unknown', items)).toBeNull();
    expect(collector.stepped).toEqual([]);
  });

  it('lets a stale pad zone (the step already moved on) produce no answer at all', () => {
    const definition = adventure('secret-door-chapter-2-pattern-lock');
    const moved = stepOf(definition, 'order-the-keys');
    expect(resolvePadAnswer(padZoneId('library-pattern', 'moon'), definition, moved)).toBeNull();
  });
});

describe('the Painted Words pads', () => {
  const choiceSteps = (definition: AdventureDefinition) =>
    definition.steps.filter((step) => step.presentation.kind === 'choice');

  it('has pads for each set’s choice steps, with only approved bank words', () => {
    for (const definition of PAINTED_WORDS_ADVENTURES) {
      expect(choiceSteps(definition).length).toBeGreaterThan(0);
      for (const step of choiceSteps(definition)) {
        const slots = paintedWordsPadSlots(step);
        expect(slots, `${definition.slug}/${step.id}`).not.toBeNull();
        for (const slot of slots!) {
          expect(
            PAINTED_WORD_BANK[slot.word],
            `${slot.word} is not in the approved bank`,
          ).toBeDefined();
          expect(slot.pictureId).toBe(PAINTED_WORD_BANK[slot.word].pictureId);
        }
      }
    }
  });

  it('puts a word on every pad, at most three pads, exactly one correct, each pad a different colour', () => {
    for (const definition of PAINTED_WORDS_ADVENTURES) {
      for (const step of choiceSteps(definition)) {
        const slots = paintedWordsPadSlots(step)!;
        expect(slots.length, step.id).toBeLessThanOrEqual(PAINTED_WORDS_PAD_KEYS.length);
        expect(slots.length, step.id).toBeGreaterThanOrEqual(2);
        expect(
          slots.filter((slot) => slot.correct),
          step.id,
        ).toHaveLength(1);
        expect(new Set(slots.map((slot) => slot.padKey)).size).toBe(slots.length);
        expect(new Set(slots.map((slot) => slot.word)).size).toBe(slots.length);
        // Each pad is the option the card shows, so the HUD equivalent says the same words.
        if (step.presentation.kind !== 'choice') throw new Error('not a choice');
        for (const slot of slots) {
          expect(
            step.presentation.options.find((option) => option.id === slot.optionId)?.label,
          ).toBe(slot.word);
        }
      }
    }
  });

  it('follows the A/B selection: set A first, then set B once the page is mended', () => {
    expect(selectPaintedWordsSlug([])).toBe(THE_PAINTED_WORDS.slug);
    expect(selectPaintedWordsSlug([PAINTED_WORDS_CHANGE_KEY])).toBe(THE_PAINTED_WORDS_AGAIN.slug);
    const wordsOf = (definition: AdventureDefinition) =>
      new Set(
        choiceSteps(definition).flatMap((step) =>
          paintedWordsPadSlots(step)!.map((slot) => slot.word),
        ),
      );
    const [setA, setB] = PAINTED_WORDS_SETS;
    const aWords = new Set(
      [...setA.rhymes, ...setA.beginnings].flatMap((q) => [q.target, q.answer, ...q.distractors]),
    );
    for (const word of wordsOf(THE_PAINTED_WORDS)) {
      const inA =
        aWords.has(word) ||
        setA.oddOneOut.rhyming.includes(word as never) ||
        setA.oddOneOut.odd === word;
      expect(inA, `set A pad word ${word}`).toBe(true);
    }
    const bWords = new Set(
      [...setB.rhymes, ...setB.beginnings].flatMap((q) => [q.target, q.answer, ...q.distractors]),
    );
    for (const word of wordsOf(THE_PAINTED_WORDS_AGAIN)) {
      const inB =
        bWords.has(word) ||
        setB.oddOneOut.rhyming.includes(word as never) ||
        setB.oddOneOut.odd === word;
      expect(inB, `set B pad word ${word}`).toBe(true);
    }
    // The two plays show different words.
    expect([...wordsOf(THE_PAINTED_WORDS)].sort()).not.toEqual(
      [...wordsOf(THE_PAINTED_WORDS_AGAIN)].sort(),
    );
  });

  it('keeps the odd one out and two rhyming words on the pads when the step has four words', () => {
    const step = stepOf(THE_PAINTED_WORDS, 'rhyme-odd-one-out');
    const slots = paintedWordsPadSlots(step)!;
    expect(slots).toHaveLength(3);
    expect(slots.some((slot) => slot.word === 'cake' && slot.correct)).toBe(true);
  });

  it('gives a pad answer the same decision as the ground answer, and a wrong pad does not advance', () => {
    for (const definition of PAINTED_WORDS_ADVENTURES) {
      for (const step of choiceSteps(definition)) {
        for (const slot of paintedWordsPadSlots(step)!) {
          const zone = padZoneId('studio', slot.padKey);
          const resolved = resolvePadAnswer(zone, definition, step);
          if (resolved?.kind !== 'answer') throw new Error('expected an answer');
          const ground = { kind: 'choice', optionId: slot.optionId } as const;
          expect(resolved.answer).toEqual(ground);
          const decision = decideSubmission(step, resolved.answer, 0);
          expect(decision).toEqual(decideSubmission(step, ground, 0));
          expect(decision.action).toBe(slot.correct ? 'ADVANCE' : 'RETRY');
          if (!slot.correct) expect(decision.nextStepId).toBeUndefined();
        }
      }
    }
  });

  it('means nothing on a step that is not a choice, and says the colours aloud', () => {
    expect(
      resolvePadAnswer(
        padZoneId('studio', 'red'),
        THE_PAINTED_WORDS,
        stepOf(THE_PAINTED_WORDS, 'clap-apple'),
      ),
    ).toBeNull();
    const guide = paintedWordsPadGuide(stepOf(THE_PAINTED_WORDS, 'rhyme-cat'))!;
    expect(guide).toContain('The red pad says');
    expect(guide).toContain('hat');
  });
});
