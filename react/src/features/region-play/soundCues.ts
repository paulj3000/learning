/**
 * The sound moments of Treasure Rush (TR-19), apart from any sound.
 *
 * The game says WHEN a cue happens (a chest opens, the key is found, the bridge is laid); a
 * sink, if one is registered, decides what it sounds like. `audio/useTreasureRushAudio.ts`
 * registers it (SM-P3) and plays the Sound Manager cues each moment maps to; with no sink, or no
 * published audio, the cove is silent. Mute and volume are the Sound Manager's settings.
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
  | 'replayWin'
  | 'answerRight'
  | 'answerRetry'
  | 'questComplete'
  // NPC Manager (LAI-NPC-015): the Sound Manager's NPC events, for the NPC they happen to.
  | 'npcGreet'
  | 'npcInteract'
  | 'npcTalk'
  | 'npcLeave';

/** Where a moment happened, when it happened somewhere in the scene (SM-P7). */
export interface SoundPlace {
  /** A scene entity (a chest, a pickup) by its entity id. */
  entityId?: string;
  /** The way to Lookout Point (the gate). */
  unlock?: true;
  /** An NPC by its stable id (`pirate-pip`), for the NPC cues. */
  npcId?: string;
}

export type SoundSink = (cue: SoundCue, at?: SoundPlace) => void;

let sink: SoundSink | null = null;

/** Registers the one sink (a player), or removes it with null. Returns the previous one. */
export function setSoundSink(next: SoundSink | null): SoundSink | null {
  const previous = sink;
  sink = next;
  return previous;
}

/** Raises a cue. Silent, and harmless, when no sink is registered or the sink throws. */
export function playCue(cue: SoundCue, at?: SoundPlace): void {
  try {
    sink?.(cue, at);
  } catch {
    // Sound is decoration: a broken player must never interrupt play.
  }
}
