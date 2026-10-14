import { householdKeyFor } from './householdKey';
import { ROOM_CLOSE_CODES, type PresencePlayer } from './protocol';
import {
  MultiplayerJoinError,
  type JoinFailure,
  type MultiplayerTransport,
  type TransportRoom,
} from './transport';

/**
 * The reusable multiplayer client service (roadmap Phase 1): joins and
 * leaves one room, tracks connection state, and exposes presence as an
 * immutable snapshot a React hook can subscribe to.
 *
 * It never decides who the child is. It sends the parent's Cognito ID
 * token and the chosen child; the server verifies both (ADR-026 part C).
 */

export type ConnectionStatus =
  'IDLE' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED' | 'FAILED';

export type MultiplayerFailure = JoinFailure | 'REPLACED' | 'CONNECTION_LOST';

export interface MultiplayerSnapshot {
  status: ConnectionStatus;
  selfPlayerId: string | null;
  players: readonly PresencePlayer[];
  failure: MultiplayerFailure | null;
}

export interface MultiplayerIdentity {
  idToken: string;
  sub: string;
}

export interface MultiplayerClientDeps {
  transport: MultiplayerTransport;
  /** The signed-in parent's current tokens. Called on every join, so a refreshed token is used. */
  getIdentity(): Promise<MultiplayerIdentity>;
}

export interface MultiplayerClient {
  getSnapshot(): MultiplayerSnapshot;
  subscribe(listener: () => void): () => void;
  join(regionId: string, childProfileId: string): Promise<void>;
  leave(): Promise<void>;
}

export const IDLE_SNAPSHOT: MultiplayerSnapshot = {
  status: 'IDLE',
  selfPlayerId: null,
  players: [],
  failure: null,
};

export function createMultiplayerClient(deps: MultiplayerClientDeps): MultiplayerClient {
  let snapshot = IDLE_SNAPSHOT;
  const listeners = new Set<() => void>();
  let room: TransportRoom | null = null;
  /** Bumped on every join and leave, so callbacks from an abandoned attempt are ignored. */
  let attempt = 0;
  let target: { regionId: string; childProfileId: string } | null = null;

  function update(next: Partial<MultiplayerSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }

  async function connect(regionId: string, childProfileId: string, rejoinOnExpiry: boolean) {
    const thisAttempt = ++attempt;
    const isCurrent = () => thisAttempt === attempt;
    target = { regionId, childProfileId };
    update({ status: 'CONNECTING', failure: null });

    try {
      const identity = await deps.getIdentity();
      const householdKey = await householdKeyFor(identity.sub);
      if (!isCurrent()) return;
      const joined = await deps.transport.join(
        { regionId, childProfileId, householdKey },
        identity.idToken,
        {
          onWelcome: ({ playerId }) => {
            if (isCurrent()) update({ selfPlayerId: playerId });
          },
          onPresence: ({ players }) => {
            if (isCurrent()) update({ players });
          },
          onDropped: () => {
            if (isCurrent()) update({ status: 'RECONNECTING' });
          },
          onReconnected: () => {
            if (isCurrent()) update({ status: 'CONNECTED', failure: null });
          },
          onClosed: (code) => {
            if (!isCurrent()) return;
            room = null;
            if (code === ROOM_CLOSE_CODES.SESSION_EXPIRED && rejoinOnExpiry && target) {
              // Rejoin once with a fresh token; a second expiry in a row means something is wrong.
              void connect(target.regionId, target.childProfileId, false);
              return;
            }
            update({
              status: 'DISCONNECTED',
              selfPlayerId: null,
              players: [],
              failure: code === ROOM_CLOSE_CODES.REPLACED ? 'REPLACED' : 'CONNECTION_LOST',
            });
          },
        },
      );
      if (!isCurrent()) {
        await joined.leave();
        return;
      }
      room = joined;
      update({ status: 'CONNECTED' });
    } catch (error) {
      if (!isCurrent()) return;
      update({
        status: 'FAILED',
        selfPlayerId: null,
        players: [],
        failure: error instanceof MultiplayerJoinError ? error.failure : 'UNAVAILABLE',
      });
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async join(regionId, childProfileId) {
      if (room) await this.leave();
      await connect(regionId, childProfileId, true);
    },
    async leave() {
      attempt += 1;
      target = null;
      const leaving = room;
      room = null;
      update(IDLE_SNAPSHOT);
      if (leaving) await leaving.leave().catch(() => undefined);
    },
  };
}
