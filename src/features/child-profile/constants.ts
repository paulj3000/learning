export const MAX_CHILD_PROFILES = 3;

export const AGE_BAND_LABELS = {
  SPROUT: 'Sprouts (ages 3-4)',
  PATHFINDER: 'Pathfinders (ages 5-6)',
  EXPLORER: 'Explorers (ages 7-8)',
} as const;

export type AgeBandValue = keyof typeof AGE_BAND_LABELS;

export const AGE_BAND_OPTIONS = (Object.keys(AGE_BAND_LABELS) as AgeBandValue[]).map((value) => ({
  value,
  label: AGE_BAND_LABELS[value],
}));

/** Recommended session length per age band, from CLAUDE.md section 3. */
export const SESSION_MINUTES_RANGE: Record<AgeBandValue, { min: number; max: number }> = {
  SPROUT: { min: 5, max: 8 },
  PATHFINDER: { min: 8, max: 12 },
  EXPLORER: { min: 10, max: 18 },
};

export const READING_MODE_OPTIONS = [
  { value: 'VOICE_FIRST', label: 'Voice first' },
  { value: 'READ_ALONG', label: 'Read along' },
  { value: 'INDEPENDENT', label: 'Independent' },
] as const;

export type ReadingModeValue = (typeof READING_MODE_OPTIONS)[number]['value'];

export const AVATAR_OPTIONS = [
  { value: 'FOX', label: 'Fox' },
  { value: 'OWL', label: 'Owl' },
  { value: 'OTTER', label: 'Otter' },
  { value: 'DRAGON', label: 'Dragon' },
  { value: 'ROBOT', label: 'Robot' },
  { value: 'MERMAID', label: 'Mermaid' },
] as const;

export type AvatarValue = (typeof AVATAR_OPTIONS)[number]['value'];

export const MAX_INTERESTS = 5;

export const INTEREST_OPTIONS = [
  'Animals',
  'Space',
  'Dinosaurs',
  'Ocean',
  'Vehicles',
  'Art',
  'Music',
  'Cooking',
  'Sports',
  'Nature',
  'Robots',
  'Fantasy',
] as const;

/**
 * How each authored avatar looks in the DOM (profile cards, the harbor
 * greeting), used whenever a child profile has no uploaded photo.
 * The in-world Phaser look for the same `avatarKey` lives separately in
 * src/features/island-map/avatarAppearance.ts, which draws shapes rather
 * than glyphs.
 */
export const AVATAR_EMOJI: Record<AvatarValue, string> = {
  FOX: '\u{1F98A}',
  OWL: '\u{1F989}',
  OTTER: '\u{1F9A6}',
  DRAGON: '\u{1F409}',
  ROBOT: '\u{1F916}',
  MERMAID: '\u{1F9DC}',
};

/** Used for a missing or unrecognized `avatarKey`, rather than rendering nothing. */
export const DEFAULT_AVATAR_EMOJI = '\u{1F3DD}\u{FE0F}';

export function getAvatarEmoji(avatarKey: string | null | undefined): string {
  if (!avatarKey) return DEFAULT_AVATAR_EMOJI;
  return AVATAR_EMOJI[avatarKey as AvatarValue] ?? DEFAULT_AVATAR_EMOJI;
}
