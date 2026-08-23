import { representationAidFor } from './content/representationAids';
import type { RepresentationAid } from './content/representationAids';
import type { TutorTurnState } from './useTutorTurn';

/**
 * Whether to put an authored manipulative beside the step, and which one.
 *
 * Pure and exported so the rule lives outside React (CLAUDE.md section 13)
 * and can be read in one place. Three conditions, all of them deliberate:
 *
 * - the turn has to be *for this step* (`appliesToCurrentStep`), so a
 *   scaffold offered on one problem cannot follow a child to the next one;
 * - the strategy has to be `SWITCH_REPRESENTATION`, the hint ladder's
 *   fourth rung ("partial scaffold", docs/ADVENTURE_ENGINE.md);
 * - the skill has to have an authored aid, or nothing is shown. Nothing is
 *   ever improvised, and the model never names the aid - at most it names a
 *   representation the curriculum already authored for that skill.
 *
 * Note what is *not* a condition: whether the turn came from Bedrock. A
 * fallback turn carries the same strategy, so the scaffold appears on rung
 * four whether or not AI is available or switched on.
 */
export function representationAidForTurn(
  skillId: string | undefined,
  state: TutorTurnState,
  appliesToCurrentStep: boolean,
): RepresentationAid | undefined {
  if (!skillId || !appliesToCurrentStep) return undefined;
  if (state.status !== 'ready') return undefined;
  if (state.turn.strategy !== 'SWITCH_REPRESENTATION') return undefined;
  return representationAidFor(skillId, state.turn.representation);
}
