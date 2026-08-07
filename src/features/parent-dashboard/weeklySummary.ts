import { LEARNING_OBJECTIVES } from '../adventures/content';
import type {
  AdventureSession,
  SkillProgress,
  StoryArtifact,
  WorldChange,
} from '../adventures/api';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function isWithinLastWeek(isoDate: string | null | undefined, now: Date): boolean {
  if (!isoDate) return false;
  const then = new Date(isoDate).getTime();
  if (Number.isNaN(then)) return false;
  return then <= now.getTime() && now.getTime() - then <= 7 * MS_PER_DAY;
}

function objectiveTitle(code: string): string {
  return LEARNING_OBJECTIVES.find((objective) => objective.code === code)?.title ?? code;
}

export interface WeeklySummaryInput {
  nickname: string;
  sessions: AdventureSession[];
  worldChanges: WorldChange[];
  skillProgress: SkillProgress[];
  stories: StoryArtifact[];
  now: Date;
}

/**
 * Deterministic, non-AI plain-language weekly summary (docs/ROADMAP.md
 * Phase 7: "plain-language weekly summary"). Built entirely from records
 * already collected for the rest of the dashboard, not a model call — it
 * can never describe anything the parent cannot already verify below it,
 * and no child data ever needs to leave the app to produce it.
 */
export function buildWeeklySummary(input: WeeklySummaryInput): string[] {
  const { nickname, sessions, worldChanges, skillProgress, stories, now } = input;

  const completedThisWeek = sessions.filter(
    (session) => session.status === 'COMPLETED' && isWithinLastWeek(session.completedAt, now),
  );
  const skillsPracticedThisWeek = skillProgress.filter((row) =>
    isWithinLastWeek(row.lastPracticedAt, now),
  );
  const worldChangesThisWeek = worldChanges.filter((change) =>
    isWithinLastWeek(change.createdAt, now),
  );
  const storiesThisWeek = stories.filter((story) => isWithinLastWeek(story.createdAt, now));

  if (
    completedThisWeek.length === 0 &&
    skillsPracticedThisWeek.length === 0 &&
    worldChangesThisWeek.length === 0 &&
    storiesThisWeek.length === 0
  ) {
    return [`${nickname} hasn't visited the island this week. It'll be ready whenever they are.`];
  }

  const lines: string[] = [
    completedThisWeek.length === 0
      ? `${nickname} didn't finish an adventure this week, but they're partway through one.`
      : `${nickname} completed ${completedThisWeek.length} ${
          completedThisWeek.length === 1 ? 'adventure' : 'adventures'
        } this week.`,
  ];

  if (skillsPracticedThisWeek.length > 0) {
    const titles = skillsPracticedThisWeek
      .slice(0, 3)
      .map((row) => objectiveTitle(row.learningObjectiveCode));
    lines.push(
      `They practiced ${
        skillsPracticedThisWeek.length === 1
          ? 'a skill'
          : `${skillsPracticedThisWeek.length} skills`
      }, including ${titles.join(', ')}.`,
    );
  }

  if (worldChangesThisWeek.length > 0) {
    lines.push(
      `The island changed in ${worldChangesThisWeek.length} new ${
        worldChangesThisWeek.length === 1 ? 'way' : 'ways'
      } because of what they did.`,
    );
  }

  if (storiesThisWeek.length > 0) {
    lines.push(
      `They created ${storiesThisWeek.length} new ${
        storiesThisWeek.length === 1 ? 'story' : 'stories'
      } in Storykeeper Castle.`,
    );
  }

  return lines;
}
