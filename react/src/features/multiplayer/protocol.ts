import { AVATAR_OPTIONS, type AvatarValue } from '../child-profile/constants';

/**
 * The wire contract between the browser and the multiplayer room server
 * (docs/DECISIONS.md ADR-026). Shared by both sides, so it imports nothing
 * from React, Three.js or Colyseus.
 *
 * Every message is runtime-validated on arrival (CLAUDE.md section 13):
 * the server never trusts what a client sends, and the client never trusts
 * a payload's shape just because it came from our server.
 *
 * What crosses the wire to *other* players is deliberately minimal: an
 * opaque per-room player id, an authored avatar key and a slot number. A
 * child's id, nickname, photo or age band never does.
 */

/** The one room type the server defines. */
export const ISLAND_ROOM_NAME = 'island';

/** Technical ceiling per room instance (roadmap Phase 1). A household has at most three children. */
export const MAX_ROOM_CAPACITY = 12;

/** How long a dropped player's seat is held before they are removed. */
export const RECONNECT_GRACE_SECONDS = 20;

export const SERVER_MESSAGES = {
  WELCOME: 'welcome',
  PRESENCE: 'presence',
} as const;

/**
 * Application close codes, in the 4000-4999 range WebSocket reserves for
 * applications and above the ones Colyseus itself uses.
 */
export const ROOM_CLOSE_CODES = {
  /** The Cognito token behind this seat expired; rejoin with a fresh one. */
  SESSION_EXPIRED: 4401,
  /** The same child joined again from another screen, which took this seat. */
  REPLACED: 4409,
  /** The server could not seat this player after authenticating them. */
  REJECTED: 4403,
} as const;

/** What a client asks for when joining. The server re-derives everything it can from the token. */
export interface IslandJoinOptions {
  regionId: string;
  childProfileId: string;
  /** `householdKeyFor(sub)`: lets the matchmaker group a family without the raw `sub` in room filters. */
  householdKey: string;
}

export type PresenceStatus = 'HERE' | 'RECONNECTING';

export interface PresencePlayer {
  playerId: string;
  avatarKey: AvatarValue | null;
  slot: number;
  status: PresenceStatus;
}

export interface PresenceMessage {
  players: readonly PresencePlayer[];
}

export interface WelcomeMessage {
  playerId: string;
}

const REGION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHILD_PROFILE_ID = /^[A-Za-z0-9-]{1,64}$/;
const HOUSEHOLD_KEY = /^[0-9a-f]{64}$/;
const PLAYER_ID = /^p[0-9]{1,6}$/;
const AVATAR_KEYS: ReadonlySet<string> = new Set(AVATAR_OPTIONS.map((option) => option.value));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An authored avatar key, or null for anything else, so free text can never ride in this field. */
export function toAvatarKey(value: unknown): AvatarValue | null {
  return typeof value === 'string' && AVATAR_KEYS.has(value) ? (value as AvatarValue) : null;
}

export function parseJoinOptions(value: unknown): IslandJoinOptions | null {
  if (!isRecord(value)) return null;
  const { regionId, childProfileId, householdKey } = value;
  if (typeof regionId !== 'string' || !REGION_ID.test(regionId)) return null;
  if (typeof childProfileId !== 'string' || !CHILD_PROFILE_ID.test(childProfileId)) return null;
  if (typeof householdKey !== 'string' || !HOUSEHOLD_KEY.test(householdKey)) return null;
  return { regionId, childProfileId, householdKey };
}

export function parseWelcomeMessage(value: unknown): WelcomeMessage | null {
  if (!isRecord(value)) return null;
  return typeof value.playerId === 'string' && PLAYER_ID.test(value.playerId)
    ? { playerId: value.playerId }
    : null;
}

function parsePresencePlayer(value: unknown): PresencePlayer | null {
  if (!isRecord(value)) return null;
  const { playerId, avatarKey, slot, status } = value;
  if (typeof playerId !== 'string' || !PLAYER_ID.test(playerId)) return null;
  if (
    typeof slot !== 'number' ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot >= MAX_ROOM_CAPACITY
  ) {
    return null;
  }
  if (status !== 'HERE' && status !== 'RECONNECTING') return null;
  return { playerId, avatarKey: toAvatarKey(avatarKey), slot, status };
}

export function parsePresenceMessage(value: unknown): PresenceMessage | null {
  if (!isRecord(value) || !Array.isArray(value.players)) return null;
  if (value.players.length > MAX_ROOM_CAPACITY) return null;
  const players: PresencePlayer[] = [];
  for (const raw of value.players) {
    const player = parsePresencePlayer(raw);
    if (!player) return null;
    players.push(player);
  }
  return { players };
}
