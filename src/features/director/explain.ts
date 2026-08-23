/**
 * Explainable selection logs (docs/ROADMAP.md Phase 28: "explainable
 * selection logs for adults/developers (not exposed to the child)").
 *
 * The parenthetical is the whole design constraint. Everything this module
 * produces is adult vocabulary - skill statuses, scores, penalties - and none
 * of it may reach a child, because telling a child "this was chosen because
 * you are still developing counting" is exactly the remediation framing
 * CLAUDE.md pillar 7 and section 3 rule out. The child gets an ordered list
 * of adventures and no reasons at all.
 *
 * Two safeguards keep that from being merely a comment:
 *
 * - the functions here take a `SelectionRecord` and return adult text, and
 *   nothing in the child-facing render path imports this module;
 * - `explain.test.ts` asserts the output is addressed to an adult rather
 *   than to a child, so a future edit that starts writing "you" fails.
 */
import type { SelectionRecord, SelectionReason } from './types';

/** One reason as a phrase for an adult reader. Never child-facing copy. */
export function describeReason(reason: SelectionReason): string {
  switch (reason.kind) {
    case 'PRACTISES_SKILL':
      return `practises ${reason.skillId} (${reason.status.toLowerCase()}, weight ${reason.weight})`;
    case 'CONTINUES_STORY':
      return `continues the story already in progress (${reason.storyId})`;
    case 'ALREADY_COMPLETED':
      return `already completed (-${reason.penalty})`;
    case 'PLAYED_RECENTLY':
      return `played recently (-${reason.penalty})`;
    case 'NO_SKILLS_NEEDED':
      return 'practises no skill currently needing work';
  }
}

/**
 * One record as a line for a developer log or a parent-facing "why this?"
 * panel. Deliberately mentions the adventure by title and the child not at
 * all: the record is about content, not about a person
 * (docs/DATA_MODEL.md: "Do not label children with fixed ability
 * judgments").
 */
export function explainSelection(record: SelectionRecord): string {
  return `${record.title} (score ${record.score}): ${record.reasons.map(describeReason).join('; ')}`;
}

/** A whole ranking, most recommended first, for an adult-facing surface. */
export function explainRanking(records: readonly SelectionRecord[]): string[] {
  return records.map(explainSelection);
}
