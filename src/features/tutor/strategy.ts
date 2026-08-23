import { MAX_HINT_LEVEL } from '../adventures/engine/hints';
import { scaffoldingLevelForHintLevel } from '../teaching/scaffolding';
import type { ScaffoldingLevel } from '../teaching/types';
import type { TutorStrategy } from './types';

/**
 * Which strategy each rung of the existing hint ladder calls for, in the
 * ladder's own order (docs/ADVENTURE_ENGINE.md "Hint ladder": encouragement
 * and restatement, attention cue, strategy hint, partial scaffold, guided
 * completion). The mapping is the whole reason the model never picks its
 * own strategy: escalation is already a deterministic function of how many
 * hints a child has asked for, and Phase 21 already made "stop escalating"
 * a rule rather than a judgment call.
 *
 * This is keyed on `hintLevel` rather than on `ScaffoldingLevel` because
 * the two ladders name different things at the same rung: Phase 21's
 * `SCAFFOLDING_LEVEL_ORDER` names the *kind of support* a rung provides
 * (rung 2 is a visual representation), while the hint ladder names the
 * *intensity step* (rung 2 is an attention cue). Both are true of the same
 * rung, and a tutoring turn is phrased from the intensity step. Callers
 * that want the support-type label for the same rung should ask
 * `scaffoldingLevelForHintLevel` - `scaffoldingLevelForStrategy` below is
 * that same call, offered here so the two vocabularies never drift.
 */
export const TUTOR_STRATEGY_BY_HINT_LEVEL: readonly TutorStrategy[] = [
  'ENCOURAGE',
  'ASK_GUIDING_QUESTION',
  'GIVE_HINT',
  'SWITCH_REPRESENTATION',
  'EXPLAIN',
];

/**
 * The strategy for a hint-ladder rung. Levels at or below 1 are the gentlest
 * rung (a child who has not asked for anything yet gets encouragement, never
 * an unrequested hint), and levels at or above `MAX_HINT_LEVEL` are guided
 * completion - mirrors `nextHintLevel`'s own clamping so the two can never
 * disagree about where the ladder ends.
 */
export function strategyForHintLevel(hintLevel: number): TutorStrategy {
  const clamped = Math.min(Math.max(Math.round(hintLevel), 1), MAX_HINT_LEVEL);
  return TUTOR_STRATEGY_BY_HINT_LEVEL[clamped - 1];
}

/** The Phase 21 support-type label for the same rung, for evidence and adult-facing logs. */
export function scaffoldingLevelForStrategy(strategy: TutorStrategy): ScaffoldingLevel | undefined {
  const index = TUTOR_STRATEGY_BY_HINT_LEVEL.indexOf(strategy);
  if (index < 0) return undefined;
  return scaffoldingLevelForHintLevel(index + 1);
}
