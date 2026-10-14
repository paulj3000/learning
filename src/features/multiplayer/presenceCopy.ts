import { AVATAR_OPTIONS, type AvatarValue } from '../child-profile/constants';
import type { MultiplayerSnapshot } from './multiplayerClient';

/**
 * Child-facing presence copy. Every line is readable aloud, short, and
 * free of em dashes (CLAUDE.md section 13). Kept here, apart from the
 * component, so it can be localized in one place.
 */
export const PRESENCE_COPY = {
  heading: 'Explorers here',
  you: 'You',
  connecting: 'Looking for your family on the island.',
  alone: 'You are the only explorer here right now.',
  reconnecting: 'The island magic flickered. Finding your way back.',
  replaced: 'You are exploring from another screen now.',
  solo: 'You are exploring on your own for now.',
  retry: 'Try again',
  waitingToReturn: 'coming back',
} as const;

export function explorersHere(count: number): string {
  return count === 1 ? PRESENCE_COPY.alone : `${count} explorers are here.`;
}

export function explorerName(avatarKey: AvatarValue | null): string {
  const label = AVATAR_OPTIONS.find((option) => option.value === avatarKey)?.label;
  return label ? `${label} explorer` : 'An explorer';
}

/** The one status line for the current snapshot, or null when there is nothing to say. */
export function presenceStatusLine(snapshot: MultiplayerSnapshot): string | null {
  switch (snapshot.status) {
    case 'IDLE':
      return null;
    case 'CONNECTING':
      return PRESENCE_COPY.connecting;
    case 'CONNECTED':
      return explorersHere(Math.max(snapshot.players.length, 1));
    case 'RECONNECTING':
      return PRESENCE_COPY.reconnecting;
    case 'DISCONNECTED':
    case 'FAILED':
      return snapshot.failure === 'REPLACED' ? PRESENCE_COPY.replaced : PRESENCE_COPY.solo;
  }
}
