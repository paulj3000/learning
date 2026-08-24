/**
 * The shared animation-clip vocabulary for `docs/ROADMAP.md` Phase 34,
 * copied verbatim from the roadmap's own list. Any asset in
 * `manifest.ts` that declares an animation clip must name it from this
 * list - not every asset uses every clip, and this file does not require
 * that any of them do.
 */
export const ANIMATION_CLIP_NAMES = [
  'Idle',
  'Walk',
  'Talk',
  'Wave',
  'Point',
  'Celebrate',
  'ReactHappy',
  'ReactConcerned',
  'Open',
  'Close',
  'Activate',
] as const;

export type AnimationClipName = (typeof ANIMATION_CLIP_NAMES)[number];
