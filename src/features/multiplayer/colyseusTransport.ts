import {
  ISLAND_ROOM_NAME,
  parsePresenceMessage,
  parseWelcomeMessage,
  SERVER_MESSAGES,
} from './protocol';
import { MultiplayerJoinError, type MultiplayerTransport } from './transport';

/** Colyseus' matchmaking code for a rejected `onAuth` (`ErrorCode.AUTH_FAILED`). */
const AUTH_FAILED = 525;
const MIN_UPTIME_BEFORE_RECONNECT_MS = 1000;

/**
 * `MultiplayerTransport` over the Colyseus SDK (docs/DECISIONS.md ADR-026).
 *
 * The SDK is imported lazily, so a build with multiplayer switched off, or a
 * region that never joins a room, does not download it.
 *
 * The SDK sends the token as an `Authorization` header on the matchmaking
 * request, and also as a query parameter on the WebSocket URL. It does not
 * store it. The query parameter means a production load balancer must not
 * log query strings (docs/multiplayer/MULTIPLAYER_SERVER.md).
 */
export function createColyseusTransport(serverUrl: string): MultiplayerTransport {
  return {
    async join(options, idToken, handlers) {
      const { Client } = await import('@colyseus/sdk');
      const client = new Client(serverUrl);
      client.auth.token = idToken;

      let room;
      try {
        room = await client.joinOrCreate(ISLAND_ROOM_NAME, { ...options });
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        throw new MultiplayerJoinError(code === AUTH_FAILED ? 'UNAUTHORIZED' : 'UNAVAILABLE');
      }

      // The SDK will not auto-reconnect a room younger than this; its 5 s default strands early drops.
      room.reconnection.minUptime = MIN_UPTIME_BEFORE_RECONNECT_MS;

      room.onMessage(SERVER_MESSAGES.WELCOME, (payload: unknown) => {
        const message = parseWelcomeMessage(payload);
        if (message) handlers.onWelcome(message);
      });
      room.onMessage(SERVER_MESSAGES.PRESENCE, (payload: unknown) => {
        const message = parsePresenceMessage(payload);
        if (message) handlers.onPresence(message);
      });
      room.onDrop(() => handlers.onDropped());
      room.onReconnect(() => handlers.onReconnected());
      room.onLeave((code: number) => handlers.onClosed(code));

      return {
        async leave() {
          await room.leave(true);
        },
      };
    },
  };
}
