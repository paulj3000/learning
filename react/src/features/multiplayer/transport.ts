import type { IslandJoinOptions, PresenceMessage, WelcomeMessage } from './protocol';

/**
 * The seam between the multiplayer client and any network library
 * (docs/DECISIONS.md ADR-026 part A). The Colyseus adapter implements it
 * for real; tests use an in-memory one. Nothing above this interface
 * imports a socket library.
 */

export type JoinFailure = 'UNAUTHORIZED' | 'ROOM_FULL' | 'UNAVAILABLE';

export class MultiplayerJoinError extends Error {
  readonly failure: JoinFailure;

  constructor(failure: JoinFailure) {
    super(`Could not join the multiplayer room: ${failure}`);
    this.name = 'MultiplayerJoinError';
    this.failure = failure;
  }
}

export interface TransportRoomHandlers {
  onWelcome(message: WelcomeMessage): void;
  onPresence(message: PresenceMessage): void;
  /** The connection dropped; the transport is trying to get the same seat back. */
  onDropped(): void;
  onReconnected(): void;
  /** The room is gone for this client. `code` is a WebSocket close code. */
  onClosed(code: number): void;
}

export interface TransportRoom {
  /** Leaves with consent: the server frees the seat at once rather than holding it. */
  leave(): Promise<void>;
}

export interface MultiplayerTransport {
  /** Rejects with `MultiplayerJoinError`. */
  join(
    options: IslandJoinOptions,
    idToken: string,
    handlers: TransportRoomHandlers,
  ): Promise<TransportRoom>;
}
