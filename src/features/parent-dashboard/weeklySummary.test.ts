import { describe, expect, it } from 'vitest';
import { buildWeeklySummary } from './weeklySummary';
import type {
  AdventureSession,
  SkillProgress,
  StoryArtifact,
  WorldChange,
} from '../adventures/api';

const NOW = new Date('2026-08-07T12:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function session(overrides: Partial<AdventureSession> = {}): AdventureSession {
  return {
    id: 's1',
    childProfileId: 'child-1',
    templateSlug: 'repair-the-moonlight-bridge',
    templateVersion: 1,
    status: 'COMPLETED',
    currentStepId: 'complete',
    startedAt: daysAgo(2),
    completedAt: daysAgo(2),
    lastActivityAt: daysAgo(2),
    createdAt: daysAgo(2),
    updatedAt: daysAgo(2),
    ...overrides,
  } as AdventureSession;
}

function skillProgress(overrides: Partial<SkillProgress> = {}): SkillProgress {
  return {
    id: 'sp1',
    childProfileId: 'child-1',
    learningObjectiveCode: 'counting-sets',
    exposureCount: 1,
    independentSuccessCount: 1,
    supportedSuccessCount: 0,
    recentLevel: null,
    lastPracticedAt: daysAgo(1),
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...overrides,
  } as SkillProgress;
}

function worldChange(overrides: Partial<WorldChange> = {}): WorldChange {
  return {
    id: 'wc1',
    childProfileId: 'child-1',
    locationSlug: 'pirate-builder-bay',
    changeType: 'BRIDGE_REPAIRED',
    changeKey: 'BRIDGE_REPAIRED',
    payload: null,
    sourceSessionId: 's1',
    createdAt: daysAgo(1),
    updatedAt: daysAgo(1),
    ...overrides,
  } as WorldChange;
}

describe('buildWeeklySummary', () => {
  it('gives a calm no-activity message when nothing happened this week', () => {
    const lines = buildWeeklySummary({
      nickname: 'Rowan',
      sessions: [],
      worldChanges: [],
      skillProgress: [],
      stories: [],
      now: NOW,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hasn't visited the island this week");
  });

  it('reports completed adventures, skills, and world changes from within the last 7 days', () => {
    const lines = buildWeeklySummary({
      nickname: 'Rowan',
      sessions: [session()],
      worldChanges: [worldChange()],
      skillProgress: [skillProgress()],
      stories: [],
      now: NOW,
    });
    expect(lines[0]).toBe('Rowan completed 1 adventure this week.');
    expect(lines.some((line) => line.includes('Counting sets of objects'))).toBe(true);
    expect(lines.some((line) => line.includes('island changed in 1 new way'))).toBe(true);
  });

  it('ignores activity older than 7 days', () => {
    const lines = buildWeeklySummary({
      nickname: 'Rowan',
      sessions: [session({ completedAt: daysAgo(30) })],
      worldChanges: [worldChange({ createdAt: daysAgo(30) })],
      skillProgress: [skillProgress({ lastPracticedAt: daysAgo(30) })],
      stories: [],
      now: NOW,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("hasn't visited the island this week");
  });

  it('notes an in-progress adventure separately from a completed one', () => {
    const lines = buildWeeklySummary({
      nickname: 'Rowan',
      sessions: [session({ status: 'ACTIVE', completedAt: undefined })],
      worldChanges: [],
      skillProgress: [skillProgress()],
      stories: [],
      now: NOW,
    });
    expect(lines[0]).toContain("didn't finish an adventure this week");
  });

  it('mentions new stories created this week', () => {
    const story: StoryArtifact = {
      id: 'story-1',
      childProfileId: 'child-1',
      sessionId: 's1',
      templateSlug: 'the-storykeepers-tale',
      title: 'A Tale of Rowan',
      scenes: [],
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    } as StoryArtifact;

    const lines = buildWeeklySummary({
      nickname: 'Rowan',
      sessions: [],
      worldChanges: [],
      skillProgress: [],
      stories: [story],
      now: NOW,
    });
    expect(lines.some((line) => line.includes('1 new story'))).toBe(true);
  });
});
