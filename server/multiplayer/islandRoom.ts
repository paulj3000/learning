import {
  ErrorCode,
  Room,
  ServerError,
  type AuthContext,
  type Client,
  type Deferred,
} from '@colyseus/core';
import {
  MAX_ROOM_CAPACITY,
  parseJoinOptions,
  ROOM_CLOSE_CODES,
  SERVER_MESSAGES,
} from '../../src/features/multiplayer/protocol';
import {
  admitPlayer,
  createIslandRoomState,
  expiredSessionIds,
  markDropped,
  markReconnected,
  presenceOf,
  removePlayer,
  type IslandRoomState,
} from '../../src/features/multiplayer/roomRules';
import { PlayerAuthRejected, type AuthenticatedPlayer, type PlayerAuthenticator } from './auth';
import type { RoomEventLog } from './roomEventLog';

export interface IslandRoomDeps {
  authenticate: PlayerAuthenticator;
  now(): number;
  reconnectGraceSeconds: number;
  /** How often to look for seats whose token has expired. */
  tokenSweepMs: number;
  /** Per client; a client over this is disconnected by Colyseus. */
  maxMessagesPerSecond: number;
  log: RoomEventLog;
}

/**
 * One instance of one region for one household (docs/DECISIONS.md ADR-026
 * part B). The matchmaker groups joins by `regionId` and `householdKey`;
 * this class re-checks both against the verified identity and delegates
 * every decision to the pure rules in `roomRules.ts`.
 *
 * State is in memory only and is gone when the room disposes. Nothing here
 * writes to a database.
 *
 * A factory rather than a plain class so dependencies are injected without
 * going through room options, which a client can influence.
 */
export function createIslandRoomClass(deps: IslandRoomDeps) {
  return class IslandRoom extends Room {
    maxClients = MAX_ROOM_CAPACITY;
    maxMessagesPerSecond = deps.maxMessagesPerSecond;

    private rules!: IslandRoomState;
    private readonly heldReconnections = new Map<string, Deferred<Client>>();

    onCreate(options: unknown) {
      const parsed = parseJoinOptions(options);
      if (!parsed) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, 'invalid options');
      this.rules = createIslandRoomState(parsed.regionId, parsed.householdKey, MAX_ROOM_CAPACITY);
      this.clock.setInterval(() => this.closeExpiredSessions(), deps.tokenSweepMs);
      deps.log({ event: 'room-created', roomId: this.roomId });
    }

    async onAuth(_client: Client, options: unknown, context: AuthContext) {
      try {
        const player = await deps.authenticate(context.token, options);
        if (
          player.regionId !== this.rules.regionId ||
          player.householdKey !== this.rules.householdKey
        ) {
          throw new PlayerAuthRejected('NOT_YOUR_HOUSEHOLD');
        }
        return player;
      } catch (error) {
        const reason = error instanceof PlayerAuthRejected ? error.reason : 'LOOKUP_FAILED';
        deps.log({ event: 'auth-rejected', roomId: this.roomId, reason });
        throw new ServerError(ErrorCode.AUTH_FAILED, 'not allowed');
      }
    }

    onJoin(client: Client, _options: unknown, auth: AuthenticatedPlayer) {
      const result = admitPlayer(this.rules, {
        sessionId: client.sessionId,
        regionId: auth.regionId,
        householdKey: auth.householdKey,
        childProfileId: auth.childProfileId,
        avatarKey: auth.avatarKey,
        tokenExpiresAt: auth.tokenExpiresAt,
      });
      if (!result.ok) {
        client.leave(ROOM_CLOSE_CODES.REJECTED);
        return;
      }
      this.rules = result.state;
      if (result.replacedSessionId) this.closeReplaced(result.replacedSessionId);
      client.send(SERVER_MESSAGES.WELCOME, { playerId: result.player.playerId });
      this.broadcastPresence();
      deps.log({ event: 'player-joined', roomId: this.roomId, players: this.rules.players.length });
    }

    onDrop(client: Client) {
      this.rules = markDropped(this.rules, client.sessionId);
      this.broadcastPresence();
      const held = this.allowReconnection(client, deps.reconnectGraceSeconds);
      this.heldReconnections.set(client.sessionId, held);
      // A rejected hold is how the seat is released early; onLeave cleans up either way.
      Promise.resolve(held).catch(() => undefined);
    }

    onReconnect(client: Client) {
      this.heldReconnections.delete(client.sessionId);
      this.rules = markReconnected(this.rules, client.sessionId);
      this.broadcastPresence();
      deps.log({ event: 'player-reconnected', roomId: this.roomId });
    }

    onLeave(client: Client) {
      this.heldReconnections.delete(client.sessionId);
      const before = this.rules.players.length;
      this.rules = removePlayer(this.rules, client.sessionId);
      if (this.rules.players.length !== before) {
        this.broadcastPresence();
        deps.log({ event: 'player-left', roomId: this.roomId, players: this.rules.players.length });
      }
    }

    onDispose() {
      deps.log({ event: 'room-disposed', roomId: this.roomId });
    }

    private closeReplaced(sessionId: string) {
      const held = this.heldReconnections.get(sessionId);
      if (held) {
        this.heldReconnections.delete(sessionId);
        held.reject(new Error('replaced'));
      }
      this.clients.get(sessionId)?.leave(ROOM_CLOSE_CODES.REPLACED);
    }

    private closeExpiredSessions() {
      const expired = expiredSessionIds(this.rules, deps.now());
      if (expired.length === 0) return;
      for (const sessionId of expired) {
        this.rules = removePlayer(this.rules, sessionId);
        this.clients.get(sessionId)?.leave(ROOM_CLOSE_CODES.SESSION_EXPIRED);
        const held = this.heldReconnections.get(sessionId);
        if (held) {
          this.heldReconnections.delete(sessionId);
          held.reject(new Error('expired'));
        }
      }
      this.broadcastPresence();
    }

    private broadcastPresence() {
      this.broadcast(SERVER_MESSAGES.PRESENCE, presenceOf(this.rules));
    }
  };
}
