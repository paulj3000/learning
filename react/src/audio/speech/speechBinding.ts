import type { TurnSpeechReference } from '../../api/ai/djangoAi';
import type { SpeakOptions } from './adapters';

/**
 * A world's spoken-dialogue switch (SM-P8-09, SM-P8-10). Shared dialogue components (an NPC's
 * conversation, Chatty's bubble) do not create speech themselves; they look for a binding. A
 * world that wants its characters to talk registers one for as long as it is mounted, and every
 * other world has none, so nothing speaks unless a game opted in.
 */
export interface SpeechBinding {
  /** Chatty's or the tutor's validated turn. `npcId` places the voice at that character. */
  speakTurn(
    result: { turn: { spokenText: string }; speech?: TurnSpeechReference },
    options?: SpeakOptions & { npcId?: string },
  ): Promise<void>;
  /** An authored NPC dialogue node already in the catalog. */
  speakNpcNode(npcId: string, nodeId: string, text: string): Promise<void>;
  /** Stops anything being said (the conversation closed). */
  stop(): void;
}

let binding: SpeechBinding | null = null;

/** Registers the one binding (or removes it with `null`). Returns the previous one. */
export function setSpeechBinding(next: SpeechBinding | null): SpeechBinding | null {
  const previous = binding;
  binding = next;
  return previous;
}

export function getSpeechBinding(): SpeechBinding | null {
  return binding;
}
