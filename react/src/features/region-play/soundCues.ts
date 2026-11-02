/**
 * The sound moments of Treasure Rush (TR-19), apart from any sound.
 *
 * The game says WHEN a cue happens (a chest opens, the key is found, the bridge is laid); a
 * sink, if one is registered, decides what it sounds like. Nothing registers a sink yet, so the
 * cove is silent today. What is deliberately not built is the player, the mute control and the
 * place the volume setting lives: that is the owner decision recorded in
 * `docs/TREASURE_RUSH_ROADMAP.md` (TR-D26), and building it first would settle it by accident.
 *
 * Cues carry no text, no child data and no audio. Meaningful sound must also have a text
 * equivalent (`docs/UX_AND_ACCESSIBILITY.md`); every cue here already has one in the HUD or the
 * panels, because the cue is only ever raised alongside that text.
 */
export type SoundCue =
  | 'chestOpen'
  | 'keyPickup'
  | 'stoneRight'
  | 'stoneWrong'
  | 'bridgeOpen'
  | 'celebrate'
  | 'replayWin';

export type SoundSink = (cue: SoundCue) => void;

let sink: SoundSink | null = null;

/** Registers the one sink (a player), or removes it with null. Returns the previous one. */
export function setSoundSink(next: SoundSink | null): SoundSink | null {
  const previous = sink;
  sink = next;
  return previous;
}

/** Raises a cue. Silent, and harmless, when no sink is registered or the sink throws. */
export function playCue(cue: SoundCue): void {
  try {
    sink?.(cue);
  } catch {
    // Sound is decoration: a broken player must never interrupt play.
  }
}
