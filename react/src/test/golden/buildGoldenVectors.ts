import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNextStepId } from '../../features/adventures/engine/transitions';
import { nextHintLevel } from '../../features/adventures/engine/hints';
import { validateStepAnswer, type StepAnswer } from '../../features/adventures/engine/validators';
import type {
  AdventureDefinition,
  AdventureStep,
  Correctness,
} from '../../features/adventures/engine/types';
import type { AgeBandValue } from '../../features/child-profile/constants';
import { reachableAdventures } from '../../features/director/reachability';
import { rankAdventures } from '../../features/director/select';
import type { DirectorContext } from '../../features/director/types';
import { nextSkillProgressCounts } from '../../features/mastery/counters';
import { computeErrorPattern } from '../../features/mastery/errorPattern';
import { applyReviewDecay, computeSkillStatus } from '../../features/mastery/status';
import type { SkillProgressCounts, SkillStatus } from '../../features/mastery/types';
import { advanceQuest, startQuest } from '../../features/quests/quest';
import { evaluateQuestCondition, isObjectiveComplete } from '../../features/quests/objectives';
import type {
  QuestCondition,
  QuestContext,
  QuestDefinition,
  QuestObjective,
  QuestState,
} from '../../features/quests/types';
import { resolveRewards, rewardedItemIds } from '../../features/rewards/rewardTable';
import type { RewardTable, RewardTrigger } from '../../features/rewards/types';
import { isWorldUnlocked } from '../../features/worlds/travel';
import { WORLD_DEFINITIONS } from '../../features/worlds/worlds';

/**
 * Golden vectors (LAI-0303, ADR-019 sub-decision 8): representative and edge inputs for the
 * deterministic rules Python takes over in Phase 6, with the outputs the current TypeScript
 * produces. Only inputs are authored here; every `expected` value comes from running the real
 * function, so a vector can never assert a rule the code does not have.
 *
 * File format (`schemaVersion` 1), one file per suite under `tests/golden/`:
 * - `functions.<tsName>.python`: the Python name the roadmap gives the port.
 * - `functions.<tsName>.args`: the argument names, in TypeScript call order. Each case's
 *   `input` is an object with exactly those keys.
 * - each case has `expected` (the JSON-normalised result: an `undefined` property is absent)
 *   or `throws: true` (a rejected input; messages are not part of the contract).
 * - `notes`: behaviour a port must reproduce that no document specifies, so it is visible.
 *
 * `npm run golden:generate` writes the files; `goldenVectors.test.ts` fails when they are
 * stale. The `director-content` suite runs against the shipped content and records the content
 * export's digest, so it changes whenever content does.
 */

export const GOLDEN_SCHEMA_VERSION = 1;
export const GOLDEN_DIR = 'tests/golden';

interface CaseInput<I> {
  name: string;
  input: I;
}

interface FunctionVectors {
  python: string;
  args: string[];
  cases: Array<{ name: string; input: unknown; expected?: unknown; throws?: true }>;
}

export interface GoldenSuite {
  schemaVersion: number;
  suite: string;
  description: string;
  sources: string[];
  contentDigest?: string;
  notes: string[];
  functions: Record<string, FunctionVectors>;
}

/** JSON-normalised, so the file and an in-memory comparison agree on `undefined`. */
function normalise(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function vectors<I extends object>(
  python: string,
  args: (keyof I & string)[],
  cases: CaseInput<I>[],
  run: (input: I) => unknown,
): FunctionVectors {
  const names = new Set<string>();
  return {
    python,
    args,
    cases: cases.map(({ name, input }) => {
      if (names.has(name)) throw new Error(`duplicate golden case name "${name}"`);
      names.add(name);
      try {
        return { name, input: normalise(input), expected: normalise(run(input)) };
      } catch {
        return { name, input: normalise(input), throws: true as const };
      }
    }),
  };
}

// ---------------------------------------------------------------------------------------------
// Adventure engine: validateStepAnswer, getNextStepId, nextHintLevel (LAI-0601)

function step(id: string, presentation: AdventureStep['presentation'], transitions: AdventureStep['transitions'] = []): AdventureStep {
  const types: Record<AdventureStep['presentation']['kind'], AdventureStep['type']> = {
    narrative: 'NARRATIVE',
    'number-input': 'NUMBER_INPUT',
    choice: 'CHOICE',
    ordering: 'ORDERING',
    matching: 'MATCHING',
    'short-response': 'SHORT_RESPONSE',
    'creative-choice': 'CREATIVE_CHOICE',
    reflection: 'REFLECTION',
    'world-change': 'WORLD_CHANGE',
    complete: 'COMPLETE',
  };
  return {
    id,
    type: types[presentation.kind],
    objectiveIds: [],
    presentation,
    transitions,
    fallback: { text: 'fallback' },
  };
}

const OPTIONS = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];
const NUMBER = step('count', { kind: 'number-input', prompt: 'How many?', correctValue: 4 });
const ZERO = step('zero', { kind: 'number-input', prompt: 'How many?', correctValue: 0 });
const CHOICE = step('pick', { kind: 'choice', prompt: 'Pick', options: OPTIONS, correctOptionId: 'b' });
const ORDERING = step('order', {
  kind: 'ordering',
  prompt: 'Order',
  items: OPTIONS,
  correctOrder: ['a', 'b', 'c'],
});
const MATCHING = step('match', {
  kind: 'matching',
  prompt: 'Match',
  pairs: [
    { leftId: 'cat', rightId: 'meow' },
    { leftId: 'dog', rightId: 'woof' },
  ],
});
const SHORT = step('short', {
  kind: 'short-response',
  prompt: 'Why?',
  options: OPTIONS,
  acceptedOptionIds: ['a', 'c'],
});
const CREATIVE = step('create', { kind: 'creative-choice', prompt: 'Choose', options: OPTIONS });
const REFLECTION = step('reflect', { kind: 'reflection', prompt: 'How did it feel?' });
const NARRATIVE = step('story', { kind: 'narrative', speaker: 'Chatty', text: 'Hello' });
const WORLD_CHANGE = step('change', {
  kind: 'world-change',
  text: 'The bridge is fixed',
  payload: { changeType: 'REPAIR', changeKey: 'bridge', locationSlug: 'bay' },
});
const COMPLETE = step('done', { kind: 'complete', text: 'Well done' });

type AnswerInput = { step: AdventureStep; answer: StepAnswer };

const ANSWER_CASES: CaseInput<AnswerInput>[] = [
  { name: 'number: correct', input: { step: NUMBER, answer: { kind: 'number-input', value: 4 } } },
  { name: 'number: incorrect', input: { step: NUMBER, answer: { kind: 'number-input', value: 5 } } },
  { name: 'number: off by one below', input: { step: NUMBER, answer: { kind: 'number-input', value: 3 } } },
  { name: 'number: negative', input: { step: NUMBER, answer: { kind: 'number-input', value: -4 } } },
  { name: 'number: fractional near miss', input: { step: NUMBER, answer: { kind: 'number-input', value: 4.5 } } },
  { name: 'number: zero is a valid correct value', input: { step: ZERO, answer: { kind: 'number-input', value: 0 } } },
  { name: 'choice: correct', input: { step: CHOICE, answer: { kind: 'choice', optionId: 'b' } } },
  { name: 'choice: incorrect', input: { step: CHOICE, answer: { kind: 'choice', optionId: 'a' } } },
  { name: 'choice: unknown option id', input: { step: CHOICE, answer: { kind: 'choice', optionId: 'zzz' } } },
  { name: 'ordering: correct', input: { step: ORDERING, answer: { kind: 'ordering', order: ['a', 'b', 'c'] } } },
  { name: 'ordering: wrong order', input: { step: ORDERING, answer: { kind: 'ordering', order: ['b', 'a', 'c'] } } },
  { name: 'ordering: too short', input: { step: ORDERING, answer: { kind: 'ordering', order: ['a', 'b'] } } },
  { name: 'ordering: too long', input: { step: ORDERING, answer: { kind: 'ordering', order: ['a', 'b', 'c', 'c'] } } },
  { name: 'ordering: empty', input: { step: ORDERING, answer: { kind: 'ordering', order: [] } } },
  {
    name: 'matching: all pairs correct',
    input: { step: MATCHING, answer: { kind: 'matching', pairs: [{ leftId: 'cat', rightId: 'meow' }, { leftId: 'dog', rightId: 'woof' }] } },
  },
  {
    name: 'matching: all pairs correct in another order',
    input: { step: MATCHING, answer: { kind: 'matching', pairs: [{ leftId: 'dog', rightId: 'woof' }, { leftId: 'cat', rightId: 'meow' }] } },
  },
  {
    name: 'matching: one of two correct is partial',
    input: { step: MATCHING, answer: { kind: 'matching', pairs: [{ leftId: 'cat', rightId: 'meow' }, { leftId: 'dog', rightId: 'meow' }] } },
  },
  {
    name: 'matching: none correct',
    input: { step: MATCHING, answer: { kind: 'matching', pairs: [{ leftId: 'cat', rightId: 'woof' }, { leftId: 'dog', rightId: 'meow' }] } },
  },
  {
    name: 'matching: one correct pair but too few pairs is partial',
    input: { step: MATCHING, answer: { kind: 'matching', pairs: [{ leftId: 'cat', rightId: 'meow' }] } },
  },
  { name: 'matching: no pairs', input: { step: MATCHING, answer: { kind: 'matching', pairs: [] } } },
  {
    name: 'matching: the same correct pair twice counts as correct',
    input: { step: MATCHING, answer: { kind: 'matching', pairs: [{ leftId: 'cat', rightId: 'meow' }, { leftId: 'cat', rightId: 'meow' }] } },
  },
  { name: 'short response: first accepted option', input: { step: SHORT, answer: { kind: 'short-response', optionId: 'a' } } },
  { name: 'short response: second accepted option', input: { step: SHORT, answer: { kind: 'short-response', optionId: 'c' } } },
  { name: 'short response: not accepted', input: { step: SHORT, answer: { kind: 'short-response', optionId: 'b' } } },
  { name: 'creative choice: never graded', input: { step: CREATIVE, answer: { kind: 'creative-choice', optionId: 'a' } } },
  { name: 'reflection: never graded', input: { step: REFLECTION, answer: { kind: 'reflection' } } },
  { name: 'narrative: never graded', input: { step: NARRATIVE, answer: { kind: 'narrative' } } },
  { name: 'world change: never graded', input: { step: WORLD_CHANGE, answer: { kind: 'world-change' } } },
  { name: 'complete: never graded', input: { step: COMPLETE, answer: { kind: 'narrative' } } },
  { name: 'reflection: any answer kind is not graded', input: { step: REFLECTION, answer: { kind: 'choice', optionId: 'a' } } },
  { name: 'invalid: choice answer to a number step', input: { step: NUMBER, answer: { kind: 'choice', optionId: 'a' } } },
  { name: 'invalid: number answer to an ordering step', input: { step: ORDERING, answer: { kind: 'number-input', value: 1 } } },
  { name: 'invalid: narrative answer to a creative step', input: { step: CREATIVE, answer: { kind: 'narrative' } } },
];

type TransitionInput = { step: AdventureStep; correctness: Correctness };
const BRANCHING = step('branch', CHOICE.presentation, [
  { when: 'correct', nextStepId: 'celebrate' },
  { when: 'incorrect', nextStepId: 'hint' },
  { when: 'always', nextStepId: 'continue' },
]);
const ALWAYS_FIRST = step('always-first', CHOICE.presentation, [
  { when: 'always', nextStepId: 'continue' },
  { when: 'correct', nextStepId: 'celebrate' },
]);
const NO_FALLBACK = step('no-fallback', CHOICE.presentation, [{ when: 'correct', nextStepId: 'celebrate' }]);
const DUPLICATE_RULES = step('duplicate', CHOICE.presentation, [
  { when: 'correct', nextStepId: 'first' },
  { when: 'correct', nextStepId: 'second' },
]);

const TRANSITION_CASES: CaseInput<TransitionInput>[] = [
  { name: 'correct takes its specific rule', input: { step: BRANCHING, correctness: 'correct' } },
  { name: 'incorrect takes its specific rule', input: { step: BRANCHING, correctness: 'incorrect' } },
  { name: 'partial with no rule falls back to always', input: { step: BRANCHING, correctness: 'partial' } },
  { name: 'not_applicable falls back to always', input: { step: BRANCHING, correctness: 'not_applicable' } },
  { name: 'a specific rule wins over an earlier always', input: { step: ALWAYS_FIRST, correctness: 'correct' } },
  { name: 'the first of two matching rules wins', input: { step: DUPLICATE_RULES, correctness: 'correct' } },
  { name: 'invalid: no rule and no always fallback', input: { step: NO_FALLBACK, correctness: 'incorrect' } },
  { name: 'invalid: a step with no transitions', input: { step: COMPLETE, correctness: 'not_applicable' } },
];

const HINT_CASES: CaseInput<{ currentLevel: number }>[] = [0, 1, 2, 3, 4, 5, 6, 99, -1].map(
  (currentLevel) => ({
    name: currentLevel > 5 ? `above the ladder (${currentLevel}) clamps to 5` : currentLevel < 0 ? `negative level ${currentLevel}` : `level ${currentLevel}`,
    input: { currentLevel },
  }),
);

function adventureEngineSuite(): GoldenSuite {
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    suite: 'adventure-engine',
    description: 'Answer evaluation, step transitions and the hint ladder.',
    sources: [
      'react/src/features/adventures/engine/validators.ts',
      'react/src/features/adventures/engine/transitions.ts',
      'react/src/features/adventures/engine/hints.ts',
    ],
    notes: [
      'validateStepAnswer: a matching answer that repeats one correct pair as many times as there are pairs counts as correct, because only the length and each pair are checked. No document says whether that is intended.',
      'validateStepAnswer: number answers compare with exact equality; no tolerance is specified.',
      'validateStepAnswer: reflection, narrative, world-change and complete steps return not_applicable for any answer kind; only gradable steps reject a mismatched kind.',
      'nextHintLevel: inputs are not validated; a negative level returns level + 1, and fractional levels are not rejected.',
    ],
    functions: {
      validateStepAnswer: vectors('validate_step_answer', ['step', 'answer'], ANSWER_CASES, ({ step: s, answer }) =>
        validateStepAnswer(s, answer),
      ),
      getNextStepId: vectors('next_step_id', ['step', 'correctness'], TRANSITION_CASES, ({ step: s, correctness }) =>
        getNextStepId(s, correctness),
      ),
      nextHintLevel: vectors('next_hint_level', ['currentLevel'], HINT_CASES, ({ currentLevel }) =>
        nextHintLevel(currentLevel),
      ),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rewards: resolveRewards, rewardedItemIds (LAI-0604)

const REWARD_TABLE: RewardTable = [
  { id: 'bridge-shell', trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'bridge' }, itemIds: ['shell'], message: 'A shell' },
  { id: 'bridge-flag', trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'bridge' }, itemIds: ['flag', 'shell'], message: 'A flag' },
  { id: 'story-book', trigger: { type: 'STORY_COMPLETED', storySlug: 'ember' }, itemIds: ['book'], message: 'A book' },
  { id: 'quest-map', trigger: { type: 'QUEST_COMPLETED', questId: 'repair' }, itemIds: ['map'], message: 'A map' },
  { id: 'change-lamp', trigger: { type: 'WORLD_CHANGE', changeKey: 'lighthouse-lit' }, itemIds: ['lamp'], message: 'A lamp' },
  { id: 'pip-friend', trigger: { type: 'NPC_RELATIONSHIP', npcId: 'pip', level: 'FRIEND' }, itemIds: ['badge'], message: 'A badge' },
  { id: 'discover-fossil', trigger: { type: 'DISCOVERY', discoveryKey: 'fossil' }, itemIds: ['fossil'], message: 'A fossil' },
  { id: 'empty-grant', trigger: { type: 'DISCOVERY', discoveryKey: 'nothing' }, itemIds: [], message: 'Well done' },
];

const REWARD_CASES: CaseInput<{ table: RewardTable; trigger: RewardTrigger }>[] = [
  { name: 'two rules match one adventure, in authored order', input: { table: REWARD_TABLE, trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'bridge' } } },
  { name: 'story completed', input: { table: REWARD_TABLE, trigger: { type: 'STORY_COMPLETED', storySlug: 'ember' } } },
  { name: 'quest completed', input: { table: REWARD_TABLE, trigger: { type: 'QUEST_COMPLETED', questId: 'repair' } } },
  { name: 'world change', input: { table: REWARD_TABLE, trigger: { type: 'WORLD_CHANGE', changeKey: 'lighthouse-lit' } } },
  { name: 'relationship at the exact level', input: { table: REWARD_TABLE, trigger: { type: 'NPC_RELATIONSHIP', npcId: 'pip', level: 'FRIEND' } } },
  { name: 'relationship at a higher level does not match', input: { table: REWARD_TABLE, trigger: { type: 'NPC_RELATIONSHIP', npcId: 'pip', level: 'TRUSTED_FRIEND' } } },
  { name: 'relationship with another npc', input: { table: REWARD_TABLE, trigger: { type: 'NPC_RELATIONSHIP', npcId: 'quill', level: 'FRIEND' } } },
  { name: 'discovery', input: { table: REWARD_TABLE, trigger: { type: 'DISCOVERY', discoveryKey: 'fossil' } } },
  { name: 'a rule may grant no items', input: { table: REWARD_TABLE, trigger: { type: 'DISCOVERY', discoveryKey: 'nothing' } } },
  { name: 'unknown adventure grants nothing', input: { table: REWARD_TABLE, trigger: { type: 'ADVENTURE_COMPLETED', templateSlug: 'unknown' } } },
  { name: 'same key under another trigger type does not match', input: { table: REWARD_TABLE, trigger: { type: 'STORY_COMPLETED', storySlug: 'bridge' } } },
  { name: 'empty table', input: { table: [], trigger: { type: 'QUEST_COMPLETED', questId: 'repair' } } },
];

function rewardsSuite(): GoldenSuite {
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    suite: 'rewards',
    description: 'Deterministic reward resolution: every matching rule grants, no randomness (ADR-011).',
    sources: ['react/src/features/rewards/rewardTable.ts'],
    notes: [
      'resolveRewards: NPC_RELATIONSHIP matches the exact level only; reaching a higher level does not also grant lower-level rules.',
      'rewardedItemIds: de-duplicates in first-seen order.',
    ],
    functions: {
      resolveRewards: vectors('resolve_rewards', ['table', 'trigger'], REWARD_CASES, ({ table, trigger }) =>
        resolveRewards(table, trigger),
      ),
      rewardedItemIds: vectors('rewarded_item_ids', ['table', 'trigger'], REWARD_CASES, ({ table, trigger }) =>
        rewardedItemIds(table, trigger),
      ),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Quests: objective evaluation, conditions, quest progress sync (LAI-0605)

const EMPTY: QuestContext = {
  completedAdventureSlugs: [],
  worldChangeKeys: [],
  visitedLocationSlugs: [],
  ownedItemIds: [],
  npcMemoryFlags: {},
  relationshipLevels: {},
  skillStatuses: {},
  discoveryKeys: [],
  completedQuestIds: [],
};

function ctx(overrides: Partial<QuestContext>): QuestContext {
  return { ...EMPTY, ...overrides };
}

const objective = <O extends QuestObjective>(value: O): O => value;

const OBJECTIVE_CASES: CaseInput<{ objective: QuestObjective; context: QuestContext }>[] = [
  { name: 'talk to: remembered', input: { objective: objective({ id: 'o', label: 'Talk', kind: 'TALK_TO', npcId: 'pip', memoryFlag: 'met' }), context: ctx({ npcMemoryFlags: { pip: { met: true } } }) } },
  { name: 'talk to: flag false', input: { objective: objective({ id: 'o', label: 'Talk', kind: 'TALK_TO', npcId: 'pip', memoryFlag: 'met' }), context: ctx({ npcMemoryFlags: { pip: { met: false } } }) } },
  { name: 'talk to: another npc remembers', input: { objective: objective({ id: 'o', label: 'Talk', kind: 'TALK_TO', npcId: 'pip', memoryFlag: 'met' }), context: ctx({ npcMemoryFlags: { quill: { met: true } } }) } },
  { name: 'help npc: remembered', input: { objective: objective({ id: 'o', label: 'Help', kind: 'HELP_NPC', npcId: 'pip', memoryFlag: 'helped' }), context: ctx({ npcMemoryFlags: { pip: { helped: true } } }) } },
  { name: 'deliver: item and memory', input: { objective: objective({ id: 'o', label: 'Deliver', kind: 'DELIVER', itemId: 'rope', npcId: 'pip', memoryFlag: 'got-rope' }), context: ctx({ ownedItemIds: ['rope'], npcMemoryFlags: { pip: { 'got-rope': true } } }) } },
  { name: 'deliver: item only', input: { objective: objective({ id: 'o', label: 'Deliver', kind: 'DELIVER', itemId: 'rope', npcId: 'pip', memoryFlag: 'got-rope' }), context: ctx({ ownedItemIds: ['rope'] }) } },
  { name: 'deliver: memory only', input: { objective: objective({ id: 'o', label: 'Deliver', kind: 'DELIVER', itemId: 'rope', npcId: 'pip', memoryFlag: 'got-rope' }), context: ctx({ npcMemoryFlags: { pip: { 'got-rope': true } } }) } },
  { name: 'find: owned', input: { objective: objective({ id: 'o', label: 'Find', kind: 'FIND', itemId: 'shell' }), context: ctx({ ownedItemIds: ['shell'] }) } },
  { name: 'craft: not owned', input: { objective: objective({ id: 'o', label: 'Craft', kind: 'CRAFT', itemId: 'kite' }), context: ctx({ ownedItemIds: ['shell'] }) } },
  { name: 'collect: all of them by default', input: { objective: objective({ id: 'o', label: 'Collect', kind: 'COLLECT', itemIds: ['a', 'b', 'c'] }), context: ctx({ ownedItemIds: ['a', 'b'] }) } },
  { name: 'collect: required count reached', input: { objective: objective({ id: 'o', label: 'Collect', kind: 'COLLECT', itemIds: ['a', 'b', 'c'], requiredCount: 2 }), context: ctx({ ownedItemIds: ['c', 'a'] }) } },
  { name: 'collect: required count zero is always met', input: { objective: objective({ id: 'o', label: 'Collect', kind: 'COLLECT', itemIds: ['a'], requiredCount: 0 }), context: EMPTY } },
  { name: 'collect: owned items outside the list do not count', input: { objective: objective({ id: 'o', label: 'Collect', kind: 'COLLECT', itemIds: ['a', 'b'], requiredCount: 2 }), context: ctx({ ownedItemIds: ['a', 'x', 'y'] }) } },
  { name: 'solve: adventure completed', input: { objective: objective({ id: 'o', label: 'Solve', kind: 'SOLVE', adventureSlug: 'bridge' }), context: ctx({ completedAdventureSlugs: ['bridge'] }) } },
  { name: 'build: world change present', input: { objective: objective({ id: 'o', label: 'Build', kind: 'BUILD', changeKey: 'bridge-fixed' }), context: ctx({ worldChangeKeys: ['bridge-fixed'] }) } },
  { name: 'explore: location visited', input: { objective: objective({ id: 'o', label: 'Explore', kind: 'EXPLORE', locationSlug: 'forest' }), context: ctx({ visitedLocationSlugs: ['forest'] }) } },
  { name: 'learn: exactly the required status', input: { objective: objective({ id: 'o', label: 'Learn', kind: 'LEARN', learningObjectiveCode: 'count-10', atLeast: 'DEVELOPING' }), context: ctx({ skillStatuses: { 'count-10': 'DEVELOPING' } }) } },
  { name: 'learn: a higher status', input: { objective: objective({ id: 'o', label: 'Learn', kind: 'LEARN', learningObjectiveCode: 'count-10', atLeast: 'DEVELOPING' }), context: ctx({ skillStatuses: { 'count-10': 'MASTERED' } }) } },
  { name: 'learn: a lower status', input: { objective: objective({ id: 'o', label: 'Learn', kind: 'LEARN', learningObjectiveCode: 'count-10', atLeast: 'PROFICIENT' }), context: ctx({ skillStatuses: { 'count-10': 'DEVELOPING' } }) } },
  { name: 'learn: no status recorded', input: { objective: objective({ id: 'o', label: 'Learn', kind: 'LEARN', learningObjectiveCode: 'count-10', atLeast: 'INTRODUCED' }), context: EMPTY } },
  { name: 'discover: key present', input: { objective: objective({ id: 'o', label: 'Discover', kind: 'DISCOVER', discoveryKey: 'fossil' }), context: ctx({ discoveryKeys: ['fossil'] }) } },
];

const STATE: QuestState = startQuest(
  { id: 'q', title: 'Q', summary: '', ageBands: ['PATHFINDER'], prerequisites: [], entryStageId: 's1', stages: [], completion: { journalNote: '' } },
  '2026-01-01T00:00:00.000Z',
);

const CONDITION_CASES: CaseInput<{ condition: QuestCondition; context: QuestContext; state?: QuestState }>[] = [
  { name: 'always', input: { condition: { type: 'ALWAYS' }, context: EMPTY } },
  { name: 'quest completed: yes', input: { condition: { type: 'QUEST_COMPLETED', questId: 'repair' }, context: ctx({ completedQuestIds: ['repair'] }) } },
  { name: 'quest completed: no', input: { condition: { type: 'QUEST_COMPLETED', questId: 'repair' }, context: EMPTY } },
  { name: 'world change: present', input: { condition: { type: 'WORLD_CHANGE', changeKey: 'bridge-fixed' }, context: ctx({ worldChangeKeys: ['bridge-fixed'] }) } },
  { name: 'item owned: no', input: { condition: { type: 'ITEM_OWNED', itemId: 'rope' }, context: EMPTY } },
  { name: 'relationship: exactly the level', input: { condition: { type: 'RELATIONSHIP_AT_LEAST', npcId: 'pip', level: 'FRIEND' }, context: ctx({ relationshipLevels: { pip: 'FRIEND' } }) } },
  { name: 'relationship: above the level', input: { condition: { type: 'RELATIONSHIP_AT_LEAST', npcId: 'pip', level: 'ACQUAINTANCE' }, context: ctx({ relationshipLevels: { pip: 'TRUSTED_FRIEND' } }) } },
  { name: 'relationship: below the level', input: { condition: { type: 'RELATIONSHIP_AT_LEAST', npcId: 'pip', level: 'FRIEND' }, context: ctx({ relationshipLevels: { pip: 'ACQUAINTANCE' } }) } },
  { name: 'relationship: an unknown npc is a stranger', input: { condition: { type: 'RELATIONSHIP_AT_LEAST', npcId: 'pip', level: 'STRANGER' }, context: EMPTY } },
  { name: 'objective completed: no state yet', input: { condition: { type: 'OBJECTIVE_COMPLETED', objectiveId: 'o1' }, context: EMPTY } },
  { name: 'objective completed: in state', input: { condition: { type: 'OBJECTIVE_COMPLETED', objectiveId: 'o1' }, context: EMPTY, state: { ...STATE, completedObjectiveIds: ['o1'] } } },
];

/** Three stages: an optional objective, a branch on an item, and world changes on the way. */
const QUEST: QuestDefinition = {
  id: 'repair',
  title: 'Repair the bridge',
  summary: 'Fix it',
  ageBands: ['PATHFINDER'],
  prerequisites: [{ type: 'ALWAYS' }],
  entryStageId: 'talk',
  stages: [
    {
      id: 'talk',
      title: 'Talk to Pip',
      objectives: [
        { id: 'met-pip', label: 'Meet Pip', kind: 'TALK_TO', npcId: 'pip', memoryFlag: 'met' },
        { id: 'see-shell', label: 'Find a shell', kind: 'FIND', itemId: 'shell', optional: true },
      ],
      branches: [{ conditions: [{ type: 'ITEM_OWNED', itemId: 'map' }], nextStageId: 'finish' }],
      nextStageId: 'build',
    },
    {
      id: 'build',
      title: 'Build',
      objectives: [{ id: 'fixed', label: 'Fix it', kind: 'BUILD', changeKey: 'bridge-fixed' }],
      nextStageId: 'finish',
      worldChanges: [{ locationSlug: 'bay', changeType: 'REPAIR', changeKey: 'bridge-fixed' }],
    },
    {
      id: 'finish',
      title: 'Finish',
      objectives: [{ id: 'solved', label: 'Solve', kind: 'SOLVE', adventureSlug: 'bridge' }],
    },
  ],
  completion: {
    journalNote: 'Done',
    worldChanges: [{ locationSlug: 'bay', changeType: 'CELEBRATE', changeKey: 'flags-up' }],
  },
};

const START: QuestState = startQuest(QUEST, '2026-01-01T00:00:00.000Z');
const CYCLE: QuestDefinition = {
  ...QUEST,
  id: 'cycle',
  entryStageId: 'a',
  stages: [
    { id: 'a', title: 'A', objectives: [], nextStageId: 'b' },
    { id: 'b', title: 'B', objectives: [], nextStageId: 'a' },
  ],
};

const ADVANCE_CASES: CaseInput<{ definition: QuestDefinition; state: QuestState; context: QuestContext }>[] = [
  { name: 'nothing done yet', input: { definition: QUEST, state: START, context: EMPTY } },
  { name: 'only the optional objective done', input: { definition: QUEST, state: START, context: ctx({ ownedItemIds: ['shell'] }) } },
  { name: 'first stage done, waits on the second', input: { definition: QUEST, state: START, context: ctx({ npcMemoryFlags: { pip: { met: true } } }) } },
  {
    name: 'walks every stage in one call and completes',
    input: { definition: QUEST, state: START, context: ctx({ npcMemoryFlags: { pip: { met: true } }, worldChangeKeys: ['bridge-fixed'], completedAdventureSlugs: ['bridge'] }) },
  },
  {
    name: 'a branch skips the build stage',
    input: { definition: QUEST, state: START, context: ctx({ npcMemoryFlags: { pip: { met: true } }, ownedItemIds: ['map'], completedAdventureSlugs: ['bridge'] }) },
  },
  {
    name: 'a completed quest never changes',
    input: { definition: QUEST, state: { ...START, status: 'COMPLETED', currentStageId: 'finish' }, context: ctx({ npcMemoryFlags: { pip: { met: true } } }) },
  },
  { name: 'an unknown current stage leaves the quest intact', input: { definition: QUEST, state: { ...START, currentStageId: 'missing' }, context: EMPTY } },
  { name: 'an authored cycle stops instead of spinning', input: { definition: CYCLE, state: startQuest(CYCLE, '2026-01-01T00:00:00.000Z'), context: EMPTY } },
];

function questsSuite(): GoldenSuite {
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    suite: 'quests',
    description: 'Objective evaluation, quest conditions, and quest progress sync (advanceQuest).',
    sources: ['react/src/features/quests/objectives.ts', 'react/src/features/quests/quest.ts'],
    notes: [
      'isObjectiveComplete: DISCOVER reads discoveryKeys, which nothing fills yet (documented as dormant in quests/types.ts).',
      'isObjectiveComplete: a COLLECT requiredCount of 0 is always met; requiredCount is not validated against the list length.',
      'advanceQuest: newlyCompletedObjectiveIds is in first-seen order; a cycle stops at the first revisited stage without completing the quest.',
      'Relationship levels order STRANGER < ACQUAINTANCE < FRIEND < TRUSTED_FRIEND; skill statuses order LOCKED < INTRODUCED < DEVELOPING < PROFICIENT < MASTERED.',
    ],
    functions: {
      isObjectiveComplete: vectors('is_objective_complete', ['objective', 'context'], OBJECTIVE_CASES, ({ objective: o, context }) =>
        isObjectiveComplete(o, context),
      ),
      evaluateQuestCondition: vectors('evaluate_quest_condition', ['condition', 'context', 'state'], CONDITION_CASES, ({ condition, context, state }) =>
        evaluateQuestCondition(condition, context, state),
      ),
      advanceQuest: vectors('advance_quest', ['definition', 'state', 'context'], ADVANCE_CASES, ({ definition, state, context }) =>
        advanceQuest(definition, state, context),
      ),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Mastery: counters, status, error pattern, review decay (LAI-0603)

const NOW = '2026-03-01T12:00:00.000Z';
const counts = (
  exposureCount: number,
  independentSuccessCount: number,
  supportedSuccessCount: number,
  consecutiveIndependentCorrect: number,
  lastPracticedAt: string | null = '2026-02-28T12:00:00.000Z',
): SkillProgressCounts => ({
  exposureCount,
  independentSuccessCount,
  supportedSuccessCount,
  consecutiveIndependentCorrect,
  lastPracticedAt,
});

const COUNTER_CASES: CaseInput<{ existing: SkillProgressCounts | null; correctness: Correctness; supportLevel: number; now: string }>[] = [
  { name: 'first evidence: independent success', input: { existing: null, correctness: 'correct', supportLevel: 0, now: NOW } },
  { name: 'first evidence: supported success', input: { existing: null, correctness: 'correct', supportLevel: 2, now: NOW } },
  { name: 'first evidence: incorrect', input: { existing: null, correctness: 'incorrect', supportLevel: 0, now: NOW } },
  { name: 'streak grows on independent success', input: { existing: counts(4, 3, 0, 2), correctness: 'correct', supportLevel: 0, now: NOW } },
  { name: 'a hint breaks the streak but counts as supported', input: { existing: counts(4, 3, 0, 2), correctness: 'correct', supportLevel: 1, now: NOW } },
  { name: 'incorrect breaks the streak', input: { existing: counts(4, 3, 0, 2), correctness: 'incorrect', supportLevel: 0, now: NOW } },
  { name: 'partial counts only as exposure', input: { existing: counts(4, 3, 0, 2), correctness: 'partial', supportLevel: 0, now: NOW } },
  { name: 'not_applicable counts only as exposure', input: { existing: counts(4, 3, 1, 2), correctness: 'not_applicable', supportLevel: 0, now: NOW } },
  { name: 'a negative support level is not a supported success', input: { existing: null, correctness: 'correct', supportLevel: -1, now: NOW } },
];

const STATUS_CASES: CaseInput<{ counts: SkillProgressCounts; prerequisitesSatisfied: boolean }>[] = [
  { name: 'no evidence, prerequisites missing: locked', input: { counts: counts(0, 0, 0, 0, null), prerequisitesSatisfied: false } },
  { name: 'no evidence, prerequisites met: introduced', input: { counts: counts(0, 0, 0, 0, null), prerequisitesSatisfied: true } },
  { name: 'exposure without independent success: introduced', input: { counts: counts(4, 0, 3, 0), prerequisitesSatisfied: false } },
  { name: 'one independent success: developing', input: { counts: counts(2, 1, 0, 1), prerequisitesSatisfied: true } },
  { name: 'proficient at exactly 3 of 5 (ratio 0.6)', input: { counts: counts(5, 3, 0, 1), prerequisitesSatisfied: true } },
  { name: 'just under the proficient ratio: developing', input: { counts: counts(6, 3, 0, 1), prerequisitesSatisfied: true } },
  { name: 'mastered at exactly 5 independent with a streak of 3', input: { counts: counts(7, 5, 0, 3), prerequisitesSatisfied: true } },
  { name: 'streak of 3 without 5 independent: proficient', input: { counts: counts(4, 4, 0, 3), prerequisitesSatisfied: true } },
  { name: '5 independent with a broken streak: proficient', input: { counts: counts(8, 5, 0, 2), prerequisitesSatisfied: true } },
  { name: 'inconsistent counts (more successes than exposures)', input: { counts: counts(2, 5, 0, 5), prerequisitesSatisfied: true } },
];

const PATTERN_CASES: CaseInput<{ counts: SkillProgressCounts }>[] = [
  { name: 'no exposure: none', input: { counts: counts(0, 0, 0, 0, null) } },
  { name: 'stalled at 3 exposures and no independent success', input: { counts: counts(3, 0, 1, 0) } },
  { name: '2 exposures without success is not yet stalled', input: { counts: counts(2, 0, 0, 0) } },
  { name: 'needs support at exactly half supported', input: { counts: counts(4, 1, 2, 0) } },
  { name: 'under half supported, mixed: inconsistent', input: { counts: counts(5, 2, 2, 1) } },
  { name: 'only independent successes: none', input: { counts: counts(4, 4, 0, 4) } },
  { name: 'a single supported exposure is under every minimum: none', input: { counts: counts(1, 0, 1, 0) } },
  { name: 'stalled takes priority over needs support', input: { counts: counts(4, 0, 4, 0) } },
];

const DECAY_CASES: CaseInput<{ status: SkillStatus; lastPracticedAt: string | null; now: string }>[] = [
  { name: 'mastered, practiced yesterday', input: { status: 'MASTERED', lastPracticedAt: '2026-02-28T12:00:00.000Z', now: NOW } },
  { name: 'mastered, exactly 21 days ago decays', input: { status: 'MASTERED', lastPracticedAt: '2026-02-08T12:00:00.000Z', now: NOW } },
  { name: 'mastered, one second under 21 days', input: { status: 'MASTERED', lastPracticedAt: '2026-02-08T12:00:01.000Z', now: NOW } },
  { name: 'proficient decays to developing', input: { status: 'PROFICIENT', lastPracticedAt: '2026-01-01T00:00:00.000Z', now: NOW } },
  { name: 'developing never decays', input: { status: 'DEVELOPING', lastPracticedAt: '2025-01-01T00:00:00.000Z', now: NOW } },
  { name: 'no practice date: unchanged', input: { status: 'MASTERED', lastPracticedAt: null, now: NOW } },
  { name: 'a practice date in the future: unchanged', input: { status: 'MASTERED', lastPracticedAt: '2026-04-01T00:00:00.000Z', now: NOW } },
];

function masterySuite(): GoldenSuite {
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    suite: 'mastery',
    description: 'SkillProgress counters, skill status, error pattern and review decay.',
    sources: [
      'react/src/features/mastery/counters.ts',
      'react/src/features/mastery/status.ts',
      'react/src/features/mastery/errorPattern.ts',
    ],
    notes: [
      'nextSkillProgressCounts: a negative supportLevel with a correct answer counts as neither independent nor supported, but still as exposure.',
      'computeSkillStatus: counts are not validated; more successes than exposures still produce a status.',
      'computeSkillStatus: the proficient ratio compares with >= 0.6 in IEEE double arithmetic (3/5 is exactly 0.6).',
      'applyReviewDecay: decays at 21 days or more, measured in milliseconds from ISO-8601 timestamps; a future practice date never decays. Timestamps are UTC with a Z suffix.',
    ],
    functions: {
      nextSkillProgressCounts: vectors('next_skill_progress_counts', ['existing', 'correctness', 'supportLevel', 'now'], COUNTER_CASES, ({ existing, correctness, supportLevel, now }) =>
        nextSkillProgressCounts(existing, correctness, supportLevel, now),
      ),
      computeSkillStatus: vectors('compute_skill_status', ['counts', 'prerequisitesSatisfied'], STATUS_CASES, ({ counts: c, prerequisitesSatisfied }) =>
        computeSkillStatus(c, prerequisitesSatisfied),
      ),
      computeErrorPattern: vectors('compute_error_pattern', ['counts'], PATTERN_CASES, ({ counts: c }) => computeErrorPattern(c)),
      applyReviewDecay: vectors('apply_review_decay', ['status', 'lastPracticedAt', 'now'], DECAY_CASES, ({ status, lastPracticedAt, now }) =>
        applyReviewDecay(status, lastPracticedAt, new Date(now)),
      ),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Director: ranking and reachability (LAI-0606)

function adventure(slug: string, title: string, ageBands: AgeBandValue[], objectiveIds: string[][]): AdventureDefinition {
  return {
    slug,
    version: 1,
    title,
    locationSlug: 'bay',
    ageBands,
    entryStepId: 's0',
    steps: objectiveIds.map((ids, index) => ({
      ...step(`s${index}`, { kind: 'complete', text: '' }),
      objectiveIds: ids,
    })),
  };
}

const DEFINITIONS: AdventureDefinition[] = [
  adventure('counting', 'Counting Crabs', ['PATHFINDER'], [['count-10'], ['count-10', 'add-5']]),
  adventure('adding', 'Adding Shells', ['PATHFINDER', 'EXPLORER'], [['add-5']]),
  adventure('story', 'A Story', ['PATHFINDER'], [[]]),
  adventure('sprouts-only', 'Sprout Colours', ['SPROUT'], [['colours']]),
  adventure('tie-b', 'Bravo', ['PATHFINDER'], [[]]),
  adventure('tie-a', 'Alpha', ['PATHFINDER'], [[]]),
];

const CONTEXT: DirectorContext = {
  masterySummaries: [],
  completedAdventureSlugs: [],
  recentAdventureSlugs: [],
  storiesInProgress: [],
};

type RankInput = {
  definitions: AdventureDefinition[];
  ageBand: AgeBandValue;
  context: DirectorContext;
  storyIdBySlug: Record<string, string>;
};

const RANK_CASES: CaseInput<RankInput>[] = [
  { name: 'no signal: alphabetical within the age band', input: { definitions: DEFINITIONS, ageBand: 'PATHFINDER', context: CONTEXT, storyIdBySlug: {} } },
  {
    name: 'skill needs add weight per objective',
    input: { definitions: DEFINITIONS, ageBand: 'PATHFINDER', context: { ...CONTEXT, masterySummaries: [{ skillId: 'count-10', status: 'INTRODUCED' }, { skillId: 'add-5', status: 'DEVELOPING' }] }, storyIdBySlug: {} },
  },
  {
    name: 'mastered and locked skills carry no weight',
    input: { definitions: DEFINITIONS, ageBand: 'PATHFINDER', context: { ...CONTEXT, masterySummaries: [{ skillId: 'count-10', status: 'MASTERED' }, { skillId: 'add-5', status: 'LOCKED' }] }, storyIdBySlug: {} },
  },
  {
    name: 'completed and recent penalties, story continuity bonus',
    input: {
      definitions: DEFINITIONS,
      ageBand: 'PATHFINDER',
      context: { ...CONTEXT, masterySummaries: [{ skillId: 'add-5', status: 'PROFICIENT' }], completedAdventureSlugs: ['counting'], recentAdventureSlugs: ['adding'], storiesInProgress: ['ember'] },
      storyIdBySlug: { story: 'ember' },
    },
  },
  {
    name: 'only the first three recent adventures are penalised',
    input: { definitions: DEFINITIONS, ageBand: 'PATHFINDER', context: { ...CONTEXT, recentAdventureSlugs: ['tie-a', 'tie-b', 'story', 'counting'] }, storyIdBySlug: {} },
  },
  { name: 'explorer sees only explorer adventures', input: { definitions: DEFINITIONS, ageBand: 'EXPLORER', context: CONTEXT, storyIdBySlug: {} } },
  { name: 'no definitions', input: { definitions: [], ageBand: 'SPROUT', context: CONTEXT, storyIdBySlug: {} } },
];

const UNLOCK_CASES: CaseInput<{ world: { travelRequirement?: { anyOfChangeKeys: string[]; lockedHint: string } }; worldChangeKeys: string[] }>[] = [
  { name: 'no requirement: unlocked', input: { world: {}, worldChangeKeys: [] } },
  { name: 'any one listed change unlocks', input: { world: { travelRequirement: { anyOfChangeKeys: ['a', 'b'], lockedHint: 'Fix it' } }, worldChangeKeys: ['b'] } },
  { name: 'no listed change: locked', input: { world: { travelRequirement: { anyOfChangeKeys: ['a'], lockedHint: 'Fix it' } }, worldChangeKeys: ['c'] } },
  { name: 'an empty requirement list never unlocks', input: { world: { travelRequirement: { anyOfChangeKeys: [], lockedHint: 'Fix it' } }, worldChangeKeys: ['a'] } },
];

function directorSuite(): GoldenSuite {
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    suite: 'director',
    description: 'Adventure ranking and the world travel rule, over self-contained inputs.',
    sources: ['react/src/features/director/select.ts', 'react/src/features/director/needs.ts', 'react/src/features/worlds/travel.ts'],
    notes: [
      'rankAdventures: storyIdForAdventure is a function in TypeScript; here it is the map storyIdBySlug.',
      'rankAdventures: ties break on title with String.prototype.localeCompare, which is locale- and ICU-dependent. The vectors use plain ASCII titles; a port must not rely on locale collation for anything else until a collation is specified.',
      'rankAdventures: an objective appearing in several steps counts once; only the first three recentAdventureSlugs are penalised.',
    ],
    functions: {
      rankAdventures: vectors('rank_adventures', ['definitions', 'ageBand', 'context', 'storyIdBySlug'], RANK_CASES, ({ definitions, ageBand, context, storyIdBySlug }) =>
        rankAdventures(definitions, ageBand, context, (slug) => storyIdBySlug[slug]),
      ),
      isWorldUnlocked: vectors('is_world_unlocked', ['world', 'worldChangeKeys'], UNLOCK_CASES, ({ world, worldChangeKeys }) =>
        isWorldUnlocked(world, worldChangeKeys),
      ),
    },
  };
}

/** Every change key any shipped world's travel requirement accepts, read from the content. */
const ALL_TRAVEL_KEYS = [
  ...new Set(WORLD_DEFINITIONS.flatMap((world) => world.travelRequirement?.anyOfChangeKeys ?? [])),
];

const REACHABLE_CASES: CaseInput<{ worldChangeKeys: string[]; ageBand: AgeBandValue }>[] = (
  ['SPROUT', 'PATHFINDER', 'EXPLORER'] as const
).flatMap((ageBand) => [
  { name: `${ageBand.toLowerCase()} with no world changes`, input: { worldChangeKeys: [], ageBand } },
  { name: `${ageBand.toLowerCase()} with every travel change`, input: { worldChangeKeys: ALL_TRAVEL_KEYS, ageBand } },
]);

function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
}

function contentDigest(): string {
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot(), 'content/exported/manifest.json'), 'utf8'),
  ) as { contentDigest: string };
  return manifest.contentDigest;
}

function directorContentSuite(): GoldenSuite {
  return {
    schemaVersion: GOLDEN_SCHEMA_VERSION,
    suite: 'director-content',
    description: 'reachableAdventures over the shipped content. Regenerate after any content change.',
    sources: ['react/src/features/director/reachability.ts', 'react/src/features/worlds/travel.ts'],
    contentDigest: contentDigest(),
    notes: [
      'Bound to the content export identified by contentDigest; a port loads the same export (LAI-0304) and compares only when the digests match.',
      'Expected values are adventure slugs, in content order.',
    ],
    functions: {
      reachableAdventures: vectors('reachable_adventures', ['worldChangeKeys', 'ageBand'], REACHABLE_CASES, ({ worldChangeKeys, ageBand }) =>
        reachableAdventures(worldChangeKeys, ageBand).map((definition) => definition.slug),
      ),
    },
  };
}

export function buildGoldenSuites(): GoldenSuite[] {
  return [adventureEngineSuite(), rewardsSuite(), questsSuite(), masterySuite(), directorSuite(), directorContentSuite()];
}

/** Repository-relative path to file text, exactly as committed. */
export function renderGoldenFiles(suites: GoldenSuite[] = buildGoldenSuites()): Record<string, string> {
  return Object.fromEntries(
    suites.map((suite) => [`${GOLDEN_DIR}/${suite.suite}.json`, `${JSON.stringify(suite, null, 2)}\n`]),
  );
}
