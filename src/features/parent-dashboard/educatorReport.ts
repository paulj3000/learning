import { getAdventureTemplate } from '../adventures/content';
import { SKILL_STATUS_LABELS, type DomainMasterySummary } from './masteryOverview';
import type { TemplateSupportSummary } from './adventureSupport';

/**
 * Optional educator-oriented reporting (docs/ROADMAP.md Phase 30's fourth
 * deliverable). Deliberately not a new surface: it reuses exactly the
 * records the rest of the parent dashboard already reads, formatted as
 * plain sentences a parent can read aloud or copy into a note home to a
 * teacher, the same "explain what was learned" parent-trust pillar
 * (CLAUDE.md section 4.6) the weekly summary already serves. "Optional"
 * per the roadmap means parent-opt-in display (`ChildDashboard.tsx`'s
 * toggle), not a separate export pipeline or file format — building one of
 * those before a real request for it would be exactly the premature
 * abstraction CLAUDE.md section 13 rules out.
 */
export interface EducatorReportInput {
  nickname: string;
  ageBandLabel: string;
  completedAdventureCount: number;
  worldChangeCount: number;
  domainSummaries: readonly DomainMasterySummary[];
  templateSupport: readonly TemplateSupportSummary[];
}

function adventureTitle(templateSlug: string): string {
  return getAdventureTemplate(templateSlug)?.title ?? templateSlug;
}

export function buildEducatorReport(input: EducatorReportInput): string[] {
  const {
    nickname,
    ageBandLabel,
    completedAdventureCount,
    worldChangeCount,
    domainSummaries,
    templateSupport,
  } = input;

  const lines: string[] = [
    `${nickname} is in the ${ageBandLabel} age band and has completed ${completedAdventureCount} ${
      completedAdventureCount === 1 ? 'adventure' : 'adventures'
    }, changing the island ${worldChangeCount} ${worldChangeCount === 1 ? 'time' : 'times'} along the way.`,
  ];

  if (domainSummaries.length === 0) {
    lines.push(`No skill area has enough practice yet to report a mastery level.`);
  } else {
    for (const domain of domainSummaries) {
      lines.push(`${domain.domainTitle}: ${SKILL_STATUS_LABELS[domain.status]}.`);
    }
  }

  for (const summary of templateSupport) {
    const total = summary.independentCount + summary.hintedCount;
    if (total === 0) continue;
    const suffix =
      summary.hintedCount === 0
        ? 'with no hints needed.'
        : `${summary.hintedCount} with the help of a hint.`;
    lines.push(
      `${adventureTitle(summary.templateSlug)}: solved ${summary.independentCount} of ${total} ${
        total === 1 ? 'step' : 'steps'
      } independently, ${suffix}`,
    );
  }

  return lines;
}
