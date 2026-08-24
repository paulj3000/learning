import { getDomain, getSkill } from '../curriculum/queries';
import { SKILL_STATUS_ORDER } from '../mastery/types';
import type { MasteryDetail, SkillStatus } from '../mastery/types';

/**
 * Mastery-level summaries grouped by curriculum domain (docs/ROADMAP.md
 * Phase 30: "mastery-level summaries ('Measurement -> PROFICIENT') sourced
 * from Phase 20"). Reads `MasteryDetail`, not `MasterySummary`: this is the
 * owning parent's own dashboard, the one place `MasteryDetail`'s doc
 * comment names as an allowed reader, alongside `exposureCount` to decide
 * which domains have actually been practiced.
 */
export interface DomainMasterySummary {
  domainId: string;
  domainTitle: string;
  status: SkillStatus;
}

/**
 * Plain-language labels for `SkillStatus`, shared by the dashboard's
 * "Mastery by area" section and the educator report — the Mastery Engine's
 * own status names are internal engine vocabulary
 * (`src/features/mastery/types.ts`), not parent-facing copy. `LOCKED` never
 * actually appears here (`buildDomainMasterySummaries` only reports
 * practiced skills, and `computeSkillStatus` never returns `LOCKED` once
 * `exposureCount > 0`) but the map stays total so it type-checks against
 * every `SkillStatus`.
 */
export const SKILL_STATUS_LABELS: Record<SkillStatus, string> = {
  LOCKED: 'Not started',
  INTRODUCED: 'Just started',
  DEVELOPING: 'Developing',
  PROFICIENT: 'Proficient',
  MASTERED: 'Mastered',
};

function statusRank(status: SkillStatus): number {
  return SKILL_STATUS_ORDER.indexOf(status);
}

/**
 * One line per domain with at least one practiced skill (`exposureCount >
 * 0`); an untouched domain is omitted rather than shown as "not started",
 * the same "reports what was found, not what is left" choice
 * `describeExploration` already made for Phase 26's discovery telemetry —
 * a parent seeing every unplayed domain listed as zero would read it as a
 * checklist, which CLAUDE.md pillar 7 rules out.
 *
 * A domain's status is the *weakest* of its practiced skills' statuses,
 * never the strongest: reporting a domain as `MASTERED` while one of its
 * skills is still `INTRODUCED` would overstate progress, which conflicts
 * with the parent-trust pillar (CLAUDE.md section 4.6) more than an
 * understated summary would.
 */
export function buildDomainMasterySummaries(
  details: readonly MasteryDetail[],
): DomainMasterySummary[] {
  const statusesByDomain = new Map<string, SkillStatus[]>();
  for (const detail of details) {
    if (detail.exposureCount === 0) continue;
    const skill = getSkill(detail.skillId);
    if (!skill) continue;
    const statuses = statusesByDomain.get(skill.domainId) ?? [];
    statuses.push(detail.status);
    statusesByDomain.set(skill.domainId, statuses);
  }

  const summaries: DomainMasterySummary[] = [];
  for (const [domainId, statuses] of statusesByDomain) {
    const domain = getDomain(domainId);
    if (!domain) continue;
    const weakest = statuses.reduce((min, status) =>
      statusRank(status) < statusRank(min) ? status : min,
    );
    summaries.push({ domainId, domainTitle: domain.title, status: weakest });
  }
  return summaries.sort((a, b) => a.domainTitle.localeCompare(b.domainTitle));
}
