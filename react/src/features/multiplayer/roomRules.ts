import type { AvatarValue } from '../child-profile/constants';
import type { PresenceMessage, PresenceStatus } from './protocol';

/**
 * The room server's rules, as pure functions over an immutable state
 * (docs/DECISIONS.md ADR-026 part A). The Colyseus room is a thin wrapper
 * that calls these; nothing here knows about sockets or Colyseus, so the
 * rules are unit-tested directly and survive a change of framework.
 *
 * `childProfileId` lives only in server memory, never in what
 * `presenceOf` broadcasts.
 */

export interface RoomPlayer {
  /** The connection currently holding this seat. Changes when a child rejoins from another screen. */
  sessionId: string;
  /** Opaque, per-room, assigned here. The only id other players see. */
  playerId: string;
  childProfileId: string;
  avatarKey: AvatarValue | null;
  slot: number;
  status: PresenceStatus;
  /** When the Cognito token behind this seat expires, in epoch milliseconds. */
  tokenExpiresAt: number;
}

export interface IslandRoomState {
  regionId: string;
  householdKey: string;
  capacity: number;
  players: readonly RoomPlayer[];
  nextPlayerNumber: number;
}

export interface SeatCandidate {
  sessionId: string;
  regionId: string;
  householdKey: string;
  childProfileId: string;
  avatarKey: AvatarValue | null;
  tokenExpiresAt: number;
}

export type AdmitResult =
  | {
      ok: true;
      state: IslandRoomState;
      player: RoomPlayer;
      /** A session that held this child's seat and must now be closed, so there is never a duplicate. */
      replacedSessionId: string | null;
    }
  | { ok: false; reason: 'WRONG_ROOM' | 'ROOM_FULL' };

export function createIslandRoomState(
  regionId: string,
  householdKey: string,
  capacity: number,
): IslandRoomState {
  return { regionId, householdKey, capacity, players: [], nextPlayerNumber: 1 };
}

function lowestFreeSlot(players: readonly RoomPlayer[], capacity: number): number | null {
  const taken = new Set(players.map((player) => player.slot));
  for (let slot = 0; slot < capacity; slot += 1) {
    if (!taken.has(slot)) return slot;
  }
  return null;
}

/**
 * Seats an authenticated candidate.
 *
 * A child already in the room (connected or waiting to reconnect) keeps
 * their player id and slot and moves to the new session; the old session
 * is returned for the caller to close. That is what stops a reload or a
 * second tab creating a duplicate player.
 */
export function admitPlayer(state: IslandRoomState, candidate: SeatCandidate): AdmitResult {
  if (candidate.regionId !== state.regionId || candidate.householdKey !== state.householdKey) {
    return { ok: false, reason: 'WRONG_ROOM' };
  }

  const existing = state.players.find(
    (player) => player.childProfileId === candidate.childProfileId,
  );
  if (existing) {
    const player: RoomPlayer = {
      ...existing,
      sessionId: candidate.sessionId,
      avatarKey: candidate.avatarKey,
      status: 'HERE',
      tokenExpiresAt: candidate.tokenExpiresAt,
    };
    return {
      ok: true,
      state: {
        ...state,
        players: state.players.map((other) => (other === existing ? player : other)),
      },
      player,
      replacedSessionId: existing.sessionId === candidate.sessionId ? null : existing.sessionId,
    };
  }

  const slot = lowestFreeSlot(state.players, state.capacity);
  if (slot === null) return { ok: false, reason: 'ROOM_FULL' };

  const player: RoomPlayer = {
    sessionId: candidate.sessionId,
    playerId: `p${state.nextPlayerNumber}`,
    childProfileId: candidate.childProfileId,
    avatarKey: candidate.avatarKey,
    slot,
    status: 'HERE',
    tokenExpiresAt: candidate.tokenExpiresAt,
  };
  return {
    ok: true,
    state: {
      ...state,
      players: [...state.players, player],
      nextPlayerNumber: state.nextPlayerNumber + 1,
    },
    player,
    replacedSessionId: null,
  };
}

function setStatus(
  state: IslandRoomState,
  sessionId: string,
  status: PresenceStatus,
): IslandRoomState {
  if (!state.players.some((player) => player.sessionId === sessionId)) return state;
  return {
    ...state,
    players: state.players.map((player) =>
      player.sessionId === sessionId ? { ...player, status } : player,
    ),
  };
}

/** The connection dropped; the seat is held for the reconnect grace period. */
export function markDropped(state: IslandRoomState, sessionId: string): IslandRoomState {
  return setStatus(state, sessionId, 'RECONNECTING');
}

export function markReconnected(state: IslandRoomState, sessionId: string): IslandRoomState {
  return setStatus(state, sessionId, 'HERE');
}

/**
 * Frees the seat held by `sessionId`. A no-op for a session whose seat has
 * already moved to a newer one (see `admitPlayer`), so closing a replaced
 * connection never removes the child who replaced it.
 */
export function removePlayer(state: IslandRoomState, sessionId: string): IslandRoomState {
  if (!state.players.some((player) => player.sessionId === sessionId)) return state;
  return { ...state, players: state.players.filter((player) => player.sessionId !== sessionId) };
}

/** Sessions whose token has expired by `now`, to be closed so the client rejoins with a fresh one. */
export function expiredSessionIds(state: IslandRoomState, now: number): string[] {
  return state.players
    .filter((player) => player.tokenExpiresAt <= now)
    .map((player) => player.sessionId);
}

/** What every player in the room is told. No child id, by construction. */
export function presenceOf(state: IslandRoomState): PresenceMessage {
  return {
    players: [...state.players]
      .sort((a, b) => a.slot - b.slot)
      .map(({ playerId, avatarKey, slot, status }) => ({ playerId, avatarKey, slot, status })),
  };
}
