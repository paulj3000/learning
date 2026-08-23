import type { CurriculumRepresentation } from '../../curriculum/types';
import type { InteractionPresentation, InteractionSkillParams } from '../../interaction/types';

/**
 * Authored practice aids for a `SWITCH_REPRESENTATION` tutoring turn
 * (docs/ROADMAP.md Phase 21's "show manipulatives or visual groups"
 * scaffold, Phase 22's interaction library, Phase 27's strategy).
 *
 * This is what makes the fourth rung of the hint ladder
 * (docs/ADVENTURE_ENGINE.md: "partial scaffold") a thing a child can touch
 * rather than a sentence Chatty says. Rung 4 offers the same idea in a
 * second modality, and this file is where a designer says what that
 * modality *is* for each skill.
 *
 * Three rules hold for every aid here, and `RepresentationAid.tsx` enforces
 * them:
 *
 * - **Never graded.** An aid records no evidence, advances no step, and
 *   changes no correctness. It is a manipulative on the side of the
 *   problem, so a child who plays with it ten times is not ten failed
 *   attempts (docs/DATA_MODEL.md: "Do not label children with fixed ability
 *   judgments").
 * - **Never authored by AI.** Every prompt, item, and target below is
 *   written here in source control. The tutoring turn only decides *which*
 *   authored aid to show, from the representations the curriculum already
 *   lists for that skill.
 * - **Available without AI.** The aid is chosen from the skill and the rung,
 *   so it appears on rung 4 whether the tutoring call succeeded, failed, or
 *   was never made because a parent switched AI off.
 */
export interface RepresentationAid {
  id: string;
  skillId: string;
  representation: CurriculumRepresentation;
  /** Shown once the child has had a go, whatever they entered. Never a score. */
  encouragement: string;
  skillParams: InteractionSkillParams;
  presentation: InteractionPresentation;
}

export const REPRESENTATION_AIDS: readonly RepresentationAid[] = [
  {
    id: 'counting-sets-visual',
    skillId: 'counting-sets',
    representation: 'visual',
    encouragement: 'Every shell counted, one at a time. That is exactly how counting works.',
    skillParams: {
      mechanic: 'BUILD',
      requiredPieceIds: ['shell-1', 'shell-2', 'shell-3', 'shell-4', 'shell-5'],
    },
    presentation: {
      mechanic: 'BUILD',
      prompt: 'Tap each shell once as you count it out loud.',
      availablePieces: [
        { id: 'shell-1', label: 'Shell 1' },
        { id: 'shell-2', label: 'Shell 2' },
        { id: 'shell-3', label: 'Shell 3' },
        { id: 'shell-4', label: 'Shell 4' },
        { id: 'shell-5', label: 'Shell 5' },
      ],
    },
  },
  {
    id: 'addition-within-ten-visual',
    skillId: 'addition-within-ten',
    representation: 'visual',
    encouragement: 'Two smaller groups, one whole pile. That is what adding looks like.',
    skillParams: { mechanic: 'SPLIT', total: 7, partsCount: 2 },
    presentation: {
      mechanic: 'SPLIT',
      prompt: 'Here are 7 planks. Put them into two piles, any way you like.',
      totalLabel: '7 planks',
      partsCount: 2,
    },
  },
  {
    id: 'comparing-lengths-visual',
    skillId: 'comparing-lengths',
    representation: 'visual',
    encouragement: 'Lining them up from shortest to longest makes the difference easy to see.',
    skillParams: {
      mechanic: 'DRAG_SORT',
      correctOrder: ['rope-short', 'rope-middle', 'rope-long'],
    },
    presentation: {
      mechanic: 'DRAG_SORT',
      prompt: 'Put the three ropes in order, shortest at the top.',
      items: [
        { id: 'rope-long', label: 'The long rope' },
        { id: 'rope-short', label: 'The short rope' },
        { id: 'rope-middle', label: 'The middle rope' },
      ],
    },
  },
  {
    id: 'measurement-visual',
    skillId: 'measurement',
    representation: 'visual',
    encouragement: 'Measuring with shells works just as well as measuring with a ruler.',
    skillParams: { mechanic: 'MEASURE', targetValue: 6, tolerance: 0 },
    presentation: {
      mechanic: 'MEASURE',
      prompt: 'Six shells lie end to end along the plank. How many shells long is it?',
      unit: 'shells',
    },
  },
  {
    id: 'patterns-visual',
    skillId: 'patterns',
    representation: 'visual',
    encouragement: 'Red, blue, red, blue. Once you see the repeat, you can keep it going.',
    skillParams: {
      mechanic: 'DRAG_SORT',
      correctOrder: ['flag-red-1', 'flag-blue-1', 'flag-red-2', 'flag-blue-2'],
    },
    presentation: {
      mechanic: 'DRAG_SORT',
      prompt: 'Put the flags back in their repeating order, starting with red.',
      items: [
        { id: 'flag-blue-1', label: 'First blue flag' },
        { id: 'flag-red-1', label: 'First red flag' },
        { id: 'flag-blue-2', label: 'Second blue flag' },
        { id: 'flag-red-2', label: 'Second red flag' },
      ],
    },
  },
  {
    id: 'subtraction-within-ten-word-problem',
    skillId: 'subtraction-within-ten',
    representation: 'word-problem',
    encouragement:
      'Each little story is a taking-away story, and each one has its own number sentence.',
    skillParams: {
      mechanic: 'DECODE',
      pairs: [
        { promptId: 'story-gulls', answerId: 'sentence-8-3' },
        { promptId: 'story-crates', answerId: 'sentence-6-2' },
      ],
    },
    presentation: {
      mechanic: 'DECODE',
      prompt: 'Match each story to the number sentence that tells it.',
      prompts: [
        { id: 'story-gulls', label: '8 gulls sat on the mast. 3 flew away.' },
        { id: 'story-crates', label: '6 crates were on the dock. 2 went onto the ship.' },
      ],
      choices: [
        { id: 'sentence-8-3', label: '8 take away 3' },
        { id: 'sentence-6-2', label: '6 take away 2' },
      ],
    },
  },
];

/**
 * The aid for a skill in a given representation, or the skill's only
 * authored aid when the tutoring turn named no representation (which is the
 * normal case when AI is off or the call fell back: the rung still asked for
 * a switch, and the curriculum already said which modality this skill has).
 * `undefined` means "show nothing extra", never "improvise something".
 */
export function representationAidFor(
  skillId: string,
  representation?: CurriculumRepresentation,
): RepresentationAid | undefined {
  const forSkill = REPRESENTATION_AIDS.filter((aid) => aid.skillId === skillId);
  if (representation) {
    return forSkill.find((aid) => aid.representation === representation);
  }
  return forSkill[0];
}
