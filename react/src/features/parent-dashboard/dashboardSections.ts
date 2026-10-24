/**
 * The parent dashboard's own sections, as data.
 *
 * Today every one of these lives inside the single `ChildDashboard` page and
 * is reached by its anchor; the plan is to separate them into pages of their
 * own. Keeping the list here rather than as hand-written links means that
 * move is a change to `to`, not a hunt through JSX, and it keeps the anchor
 * ids in one place instead of duplicated between the list and the page's
 * markup.
 */

/** Section anchor ids, shared with `ChildDashboard`'s `<section id=...>`. */
export const CHILD_DASHBOARD_SECTION_IDS = {
  thisWeek: 'this-week',
  exploring: 'exploring',
  recentAdventures: 'recent-adventures',
  suggestedNext: 'suggested-next',
  focusAreas: 'focus-areas',
  masteryByArea: 'mastery-by-area',
  skillsPracticed: 'skills-practiced',
  creations: 'creations',
  safetyCheckIns: 'safety-check-ins',
  educatorReport: 'educator-report',
  controls: 'controls',
} as const;

export interface DashboardSection {
  id: string;
  title: string;
  /** One plain sentence a parent can read aloud; no jargon, no metrics. */
  description: string;
  to: string;
}

interface SectionTemplate {
  id: string;
  title: string;
  description: string;
}

const ANCHORED_SECTIONS: readonly SectionTemplate[] = [
  {
    id: CHILD_DASHBOARD_SECTION_IDS.thisWeek,
    title: 'This week',
    description: 'A short summary of what happened on the island over the last seven days.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.exploring,
    title: 'Exploring',
    description: 'Which places have been visited and what has been discovered there.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.recentAdventures,
    title: 'Recent adventures',
    description:
      'The most recent missions, whether they were finished, and how much help was used.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.suggestedNext,
    title: 'What we would suggest next',
    description: 'Adventures we would offer next, and the reason for each one.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.focusAreas,
    title: 'Focus areas to consider',
    description: 'Skills that would benefit from practice. For you only, and nothing is locked.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.masteryByArea,
    title: 'Mastery by area',
    description: 'How each learning area is going, grouped rather than skill by skill.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.skillsPracticed,
    title: 'Skills practiced',
    description: 'Every skill practiced so far, with how recently it came up.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.creations,
    title: 'Creations and world changes',
    description: 'What has been built, repaired, or changed on the island.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.safetyCheckIns,
    title: 'Safety check-ins',
    description:
      'When an AI response did not pass our checks and a reviewed reply was used instead.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.educatorReport,
    title: 'Educator report',
    description: 'An optional plain-language summary you can share with a teacher or tutor.',
  },
  {
    id: CHILD_DASHBOARD_SECTION_IDS.controls,
    title: 'Controls',
    description: 'AI, voice and reading mode, session time, and stored AI interaction history.',
  },
];

/**
 * Sections that already have a page of their own, listed alongside the
 * anchored ones so the parent sees one list rather than two ideas of where
 * things live.
 */
function ownPageSections(childId: string): DashboardSection[] {
  return [
    {
      id: 'story-keepsakes',
      title: 'Story keepsakes',
      description: 'Stories written on the island, kept so they can be read again or deleted.',
      to: `/home/children/${childId}/stories`,
    },
    {
      id: 'profile-details',
      title: 'Profile details',
      description: 'Nickname, avatar, age band, interests, reading mode, and session length.',
      to: `/home/children/${childId}/edit`,
    },
    {
      id: 'play-together',
      title: 'Play together',
      description: 'Start a shared adventure between two children in your family.',
      to: '/home/coop/new',
    },
  ];
}

/** Every parent dashboard section for one child, in reading order. */
export function listDashboardSections(childId: string): DashboardSection[] {
  return [
    ...ANCHORED_SECTIONS.map((section) => ({
      ...section,
      to: `/home/children/${childId}/dashboard#${section.id}`,
    })),
    ...ownPageSections(childId),
  ];
}
