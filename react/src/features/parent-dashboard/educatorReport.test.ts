import { describe, expect, it } from 'vitest';
import { buildEducatorReport } from './educatorReport';

describe('buildEducatorReport', () => {
  it('reports a headline sentence and a no-mastery-yet line when nothing has been practiced enough', () => {
    const lines = buildEducatorReport({
      nickname: 'Ari',
      ageBandLabel: 'Pathfinders (ages 5-6)',
      completedAdventureCount: 0,
      worldChangeCount: 0,
      domainSummaries: [],
      templateSupport: [],
    });
    expect(lines[0]).toContain('Ari');
    expect(lines[0]).toContain('0 adventures');
    expect(lines).toContain('No skill area has enough practice yet to report a mastery level.');
  });

  it('lists each domain and its mastery label', () => {
    const lines = buildEducatorReport({
      nickname: 'Ari',
      ageBandLabel: 'Pathfinders (ages 5-6)',
      completedAdventureCount: 1,
      worldChangeCount: 1,
      domainSummaries: [
        { domainId: 'early-number', domainTitle: 'Early Number', status: 'PROFICIENT' },
      ],
      templateSupport: [],
    });
    expect(lines).toContain('Early Number: Proficient.');
  });

  it('describes independent-vs-hinted solving per adventure, singular/plural aware', () => {
    const lines = buildEducatorReport({
      nickname: 'Ari',
      ageBandLabel: 'Pathfinders (ages 5-6)',
      completedAdventureCount: 1,
      worldChangeCount: 1,
      domainSummaries: [],
      templateSupport: [
        { templateSlug: 'repair-the-moonlight-bridge', independentCount: 2, hintedCount: 0 },
      ],
    });
    const line = lines.find((entry) => entry.includes('Repair the Moonlight Bridge'));
    expect(line).toContain('solved 2 of 2 steps independently');
    expect(line).toContain('with no hints needed');
  });

  it('skips a template with zero counted steps', () => {
    const lines = buildEducatorReport({
      nickname: 'Ari',
      ageBandLabel: 'Pathfinders (ages 5-6)',
      completedAdventureCount: 0,
      worldChangeCount: 0,
      domainSummaries: [],
      templateSupport: [
        { templateSlug: 'repair-the-moonlight-bridge', independentCount: 0, hintedCount: 0 },
      ],
    });
    expect(lines.some((entry) => entry.includes('Repair the Moonlight Bridge'))).toBe(false);
  });
});
