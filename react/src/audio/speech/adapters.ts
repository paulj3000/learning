import type { TurnSpeechReference } from '../../api/ai/djangoAi';
import type { SpeakRequest, SpeechPlayer } from './SpeechPlayer';

/**
 * Small adapters from the game's existing dialogue sources to the speech player (SM-P8-10). Each
 * one speaks only what the server approved and always shows the text, so a game that has not
 * switched speech on, or whose speech fails, behaves exactly as it did before.
 */

type Speaker = Pick<SpeechPlayer, 'speak' | 'showText'>;

interface SpokenTurn {
  turn: { spokenText: string };
  /** Present only when the server will speak this turn. */
  speech?: TurnSpeechReference;
}

export interface SpeakOptions {
  mode?: SpeakRequest['mode'];
  position?: SpeakRequest['position'];
}

function speakTurn(speech: Speaker, result: SpokenTurn, options: SpeakOptions = {}): Promise<void> {
  const text = result.turn.spokenText;
  if (!result.speech) {
    // No reference (speech off, AI off, authored fallback the server did not approve): text only.
    speech.showText(text);
    return Promise.resolve();
  }
  return speech.speak({
    reference: { kind: 'utterance', id: result.speech.utteranceId },
    fallbackText: text,
    ...options,
  });
}

/** Chatty the Parrot's companion turn (`requestCompanionTurn`). */
export const speakCompanionTurn = speakTurn;

/** The educational tutor's turn (`requestTutorTurn`). */
export const speakTutorTurn = speakTurn;

/** A line staff wrote in Django Admin, for example Keeper Quill's greeting. */
export function speakLine(
  speech: Speaker,
  lineId: string,
  fallbackText: string,
  options: SpeakOptions = {},
): Promise<void> {
  return speech.speak({ reference: { kind: 'line', id: lineId }, fallbackText, ...options });
}

/** An authored NPC dialogue node already in the catalog (its narration text). */
export function speakNpcNode(
  speech: Speaker,
  npcId: string,
  nodeId: string,
  fallbackText: string,
  options: SpeakOptions = {},
): Promise<void> {
  return speech.speak({
    reference: { kind: 'npcNode', npcId, nodeId },
    fallbackText,
    ...options,
  });
}
