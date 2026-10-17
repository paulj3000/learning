import type { AdventureAction, AdventureSession } from '../adventures/api';

/**
 * Independent-vs-hinted reporting per adventure (docs/ROADMAP.md Phase 30).
 * Pure aggregation over `AdventureAction` rows already recorded by the
 * Adventure Engine (Phase 3) and Hint Ladder (`useAdventureSession.ts`) —
 * this adds no new gameplay data, only a parent-facing rollup of it, same
 * "aggregated from records already collected" discipline `ChildDashboard.tsx`
 * already documents for the rest of the page.
 *
 * Only `CORRECT` actions count as "solved", matching the precedent
 * `SkillProgress.independentSuccessCount`/`supportedSuccessCount` already
 * set: an incorrect attempt is neither independent nor hinted success, so
 * it is excluded rather than counted as a third bucket nobody asked for.
 */
export interface SessionSupportCounts {
  independentCount: number;
  hintedCount: number;
}

/** Independent-vs-hinted solved-step counts, keyed by `AdventureSession.id`. */
export function summarizeSupportBySession(
  actions: readonly AdventureAction[],
): Map<string, SessionSupportCounts> {
  const bySession = new Map<string, SessionSupportCounts>();
  for (const action of actions) {
    if (action.correctness !== 'CORRECT') continue;
    const counts = bySession.get(action.sessionId) ?? { independentCount: 0, hintedCount: 0 };
    if (action.hintLevel > 0) {
      counts.hintedCount += 1;
    } else {
      counts.independentCount += 1;
    }
    bySession.set(action.sessionId, counts);
  }
  return bySession;
}

export interface TemplateSupportSummary {
  templateSlug: string;
  independentCount: number;
  hintedCount: number;
}

/**
 * The same counts rolled up across every one of a child's sessions of the
 * same adventure template, for the Phase 30 educator report — a teacher
 * wants "how did they do on this adventure overall", not one line per
 * replay. Sorted by `templateSlug` for a stable, testable order; the
 * dashboard maps slugs to titles at render time via
 * `getAdventureTemplate`, same as every other adventure-slug list already
 * on the page.
 */
export function summarizeSupportByTemplate(
  sessions: readonly Pick<AdventureSession, 'id' | 'templateSlug'>[],
  bySession: ReadonlyMap<string, SessionSupportCounts>,
): TemplateSupportSummary[] {
  const byTemplate = new Map<string, SessionSupportCounts>();
  for (const session of sessions) {
    const counts = bySession.get(session.id);
    if (!counts) continue;
    const entry = byTemplate.get(session.templateSlug) ?? {
      independentCount: 0,
      hintedCount: 0,
    };
    entry.independentCount += counts.independentCount;
    entry.hintedCount += counts.hintedCount;
    byTemplate.set(session.templateSlug, entry);
  }
  return Array.from(byTemplate.entries())
    .map(([templateSlug, counts]) => ({ templateSlug, ...counts }))
    .sort((a, b) => a.templateSlug.localeCompare(b.templateSlug));
}
