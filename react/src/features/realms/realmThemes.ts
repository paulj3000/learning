/**
 * How a Realm or Place looks when it has no published picture yet (AP-03).
 *
 * Presentation only: this never decides what exists, what is open or what it teaches. It maps
 * a published slug to one of a few drawn scenes and colour washes. A slug it does not know gets
 * a stable default from its letters, so a newly published Realm still looks deliberate.
 *
 * Literal class strings: the portal's Tailwind build only sees classes written out in full
 * (portal.css). Every text pair on these washes is checked in `portalCss.test.ts`.
 */

export type RealmScene =
  'island' | 'cove' | 'treasure' | 'castle' | 'volcano' | 'forest' | 'harbor';

export interface RealmTheme {
  scene: RealmScene;
  /** The card's border and hover border. */
  frame: string;
  /** The wash behind the picture and the subject chips. */
  wash: string;
  /** The progress fill (ProgressIndicator tone). */
  tone: 'ocean' | 'tropical' | 'treasure' | 'coral' | 'purple';
}

export const THEMES: Record<RealmScene, RealmTheme> = {
  island: {
    scene: 'island',
    frame: 'border-ocean-100 hover:border-ocean-500',
    wash: 'bg-ocean-50',
    tone: 'ocean',
  },
  cove: {
    scene: 'cove',
    frame: 'border-tropical-100 hover:border-tropical-500',
    wash: 'bg-tropical-50',
    tone: 'tropical',
  },
  treasure: {
    scene: 'treasure',
    frame: 'border-treasure-100 hover:border-treasure-500',
    wash: 'bg-treasure-50',
    tone: 'treasure',
  },
  castle: {
    scene: 'castle',
    frame: 'border-purple-100 hover:border-purple-500',
    wash: 'bg-purple-50',
    tone: 'purple',
  },
  volcano: {
    scene: 'volcano',
    frame: 'border-coral-100 hover:border-coral-500',
    wash: 'bg-coral-50',
    tone: 'coral',
  },
  forest: {
    scene: 'forest',
    frame: 'border-tropical-100 hover:border-tropical-500',
    wash: 'bg-tropical-50',
    tone: 'tropical',
  },
  harbor: {
    scene: 'harbor',
    frame: 'border-ocean-100 hover:border-ocean-500',
    wash: 'bg-ocean-50',
    tone: 'ocean',
  },
};

/** Visual directions for the content published today (AP-03 brief section E). */
const SCENE_BY_SLUG: Record<string, RealmScene> = {
  // Realms (catalog Islands)
  'learning-adventure-island': 'island',
  'creature-care-cove': 'cove',
  // Places and their 3D Areas
  'pirate-builder-bay': 'treasure', // Treasure Cove: ship, palms, treasure
  'storykeeper-castle': 'castle',
  'castle-writing-room': 'castle',
  'firepeak-volcano': 'volcano',
  'wonderwild-forest': 'forest',
  'dragons-sanctuary': 'volcano',
  'fossil-ridge-camp': 'forest',
  'bolts-workshop': 'harbor',
  'clockwork-harbor': 'harbor',
  'cove-care-beach': 'cove',
  'lantern-tide-pools': 'cove',
};

const FALLBACK_SCENES: readonly RealmScene[] = ['island', 'cove', 'forest', 'harbor'];

export function themeFor(slug: string): RealmTheme {
  const known = SCENE_BY_SLUG[slug];
  if (known) return THEMES[known];
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return THEMES[FALLBACK_SCENES[hash % FALLBACK_SCENES.length]];
}
