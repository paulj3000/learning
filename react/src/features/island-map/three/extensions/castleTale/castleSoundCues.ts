/**
 * The sound moments of Storykeeper Castle (SC-R06-01), apart from any sound.
 *
 * The castle's React half says WHEN a moment happens (the Storybook opens, a page comes back, an
 * answer is confirmed right); a sink, if one is registered, decides what it sounds like.
 * `useCastleAudio` registers it while the castle is mounted and plays the Sound Manager cues each
 * moment maps to (`castleSounds.ts`); with no sink, or no published audio, the castle is silent.
 *
 * Moments carry no text, no child data and no audio. Every moment is raised alongside the text the
 * child already sees (a toast, the caption, the step card), so sound is never the only signal
 * (`docs/UX_AND_ACCESSIBILITY.md`). This is the castle's own sink, not Treasure Rush's
 * (`region-play/soundCues.ts`): the two are never mounted together, and neither can silence the
 * other.
 */
export type CastleSoundMoment =
  | 'bookOpen'
  | 'bookClose'
  | 'pageRestored'
  | 'questStart'
  | 'questComplete'
  | 'npcGreet'
  | 'hint'
  | 'answerRight'
  | 'answerRetry'
  | 'artifactFound'
  | 'roomDoor';

/** Where a moment happened, when it happened somewhere in the scene. */
export interface CastleSoundPlace {
  /** A scene entity (an NPC, an artifact) by its entity id. */
  entityId?: string;
}

export type CastleSoundSink = (moment: CastleSoundMoment, at?: CastleSoundPlace) => void;

let sink: CastleSoundSink | null = null;

/** Registers the one sink, or removes it with null. Returns the previous one. */
export function setCastleSoundSink(next: CastleSoundSink | null): CastleSoundSink | null {
  const previous = sink;
  sink = next;
  return previous;
}

/** Raises a moment. Silent, and harmless, when no sink is registered or the sink throws. */
export function playCastleCue(moment: CastleSoundMoment, at?: CastleSoundPlace): void {
  try {
    sink?.(moment, at);
  } catch {
    // Sound is decoration: a broken player must never interrupt play.
  }
}
