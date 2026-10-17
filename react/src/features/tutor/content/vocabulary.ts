/**
 * Authored tutoring vocabulary (docs/ROADMAP.md Phase 27's "allowed
 * vocabulary" deliverable). Source-controlled content, not a DB model, same
 * as curriculum, quest, NPC, and item content elsewhere in this codebase.
 *
 * Two lists, doing opposite jobs:
 *
 * - `SKILL_VOCABULARY` (plus `CORE_TUTOR_VOCABULARY`) is the *permission*
 *   list. It is sent to the model as the complete set of learning words a
 *   turn may use, so a designer reviewing a skill can see exactly what
 *   Chatty is allowed to say about it.
 * - `CURRICULUM_TERMS` is the *tripwire* list, used only by
 *   `validateTutorTurn`. A curriculum term that appears in a response but
 *   is not on that skill's permission list means the model wandered into
 *   another skill - which is the roadmap's "cannot invent curriculum
 *   requirements" failure mode, and the one a prompt alone cannot prevent
 *   (docs/AI_AND_CHILD_SAFETY.md: "No single model instruction is
 *   considered sufficient").
 *
 * The tripwire is deliberately conservative, in the same spirit as
 * `src/lib/ai/contentSafety.ts`: a false positive costs one authored
 * fallback line, which the child sees as Chatty saying something slightly
 * plainer, while a false negative would let a counting lesson start
 * teaching multiplication.
 */

/**
 * Words any tutoring turn may use regardless of skill: the shared language
 * of trying things on the island. Kept small on purpose - it is not a place
 * to smuggle in curriculum terms.
 */
export const CORE_TUTOR_VOCABULARY: readonly string[] = [
  'again',
  'answer',
  'check',
  'guess',
  'idea',
  'look',
  'notice',
  'part',
  'picture',
  'problem',
  'puzzle',
  'same',
  'show',
  'sort',
  'step',
  'think',
  'try',
  'way',
];

/**
 * Per-skill permission lists, keyed by `Skill.id`
 * (`src/features/curriculum/content/`). A skill with no entry here has no
 * tutoring vocabulary authored yet, which `isTutorableSkill` treats as "do
 * not tutor this skill" rather than "tutor it with no words" - adding a
 * curriculum skill must never silently open an unreviewed AI surface.
 */
export const SKILL_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  'counting-sets': [
    'all together',
    'count',
    'counted',
    'counting',
    'each',
    'group',
    'how many',
    'last',
    'many',
    'number',
    'one at a time',
    'point',
    'set',
    'total',
  ],
  'comparing-lengths': [
    'compare',
    'end',
    'line up',
    'long',
    'longer',
    'longest',
    'match',
    'short',
    'shorter',
    'shortest',
    'side by side',
    'size',
    'taller',
  ],
  'addition-within-ten': [
    'add',
    'adding',
    'addition',
    'all together',
    'count',
    'counting',
    'group',
    'how many',
    'join',
    'more',
    'number',
    'plus',
    'sum',
    'total',
  ],
  patterns: [
    'again',
    'color',
    'copy',
    'shape',
    'next',
    'order',
    'pattern',
    'patterns',
    'repeat',
    'repeating',
    'rule',
  ],
  measurement: [
    'compare',
    'count',
    'counting',
    'end',
    'how many',
    'long',
    'longer',
    'measure',
    'measurement',
    'measuring',
    'ruler',
    'shorter',
    'size',
    'start',
    'unit',
  ],
  'subtraction-within-ten': [
    'away',
    'count',
    'counting',
    'fewer',
    'group',
    'how many',
    'left',
    'less',
    'minus',
    'number',
    'subtract',
    'subtracting',
    'subtraction',
    'take away',
  ],
  /*
   * Phase 19's early-years slice (`earlyYears.ts`). Without an entry here a
   * skill is not tutorable at all (`isTutorableSkill`), so the Sprout band
   * would have had a curriculum but still no AI tutoring.
   */
  observation: [
    'closer',
    'different',
    'look',
    'looking',
    'notice',
    'noticed',
    'same',
    'see',
    'shape',
    'watch',
  ],
  classification: [
    'belong',
    'different',
    'group',
    'grouping',
    'kind',
    'match',
    'same',
    'set',
    'sort',
    'sorting',
    'together',
  ],
  'cause-and-effect': [
    'after',
    'because',
    'before',
    'happen',
    'happened',
    'happens',
    'made',
    'next',
    'reason',
    'so',
    'then',
    'why',
  ],
  'animal-science': [
    'animal',
    'animals',
    'eat',
    'eats',
    'food',
    'home',
    'live',
    'lives',
    'move',
    'moves',
    'nest',
    'wing',
    'wings',
  ],
};

export const CURRICULUM_TERMS: readonly string[] = [
  'add',
  'adding',
  'addition',
  'algebra',
  'count',
  'counting',
  'decimal',
  'decimals',
  'divide',
  'dividing',
  'division',
  'equation',
  'estimate',
  'fraction',
  'fractions',
  'geometry',
  'graph',
  'half',
  'measure',
  'measuring',
  'measurement',
  'minus',
  'multiply',
  'multiplying',
  'multiplication',
  'negative',
  'pattern',
  'patterns',
  'percent',
  'place value',
  'classify',
  'classifying',
  'sorting',
  'plus',
  'ratio',
  'rounding',
  'subtract',
  'subtracting',
  'subtraction',
  'sum',
  'times table',
  'weigh',
  'weight',
];

/**
 * The complete permission list for one skill, or `undefined` when no
 * vocabulary has been authored for it. Sorted and de-duplicated so the same
 * skill always produces the same prompt argument (stable prompts keep the
 * audit trail comparable across sessions).
 */
export function allowedVocabularyForSkill(skillId: string): readonly string[] | undefined {
  const skillWords = SKILL_VOCABULARY[skillId];
  if (!skillWords) return undefined;
  return [...new Set([...CORE_TUTOR_VOCABULARY, ...skillWords])].sort();
}
