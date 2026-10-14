import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ISLAND_ROOM_NAME, RECONNECT_GRACE_SECONDS } from '../../src/features/multiplayer/protocol';
import type { PlayerAuthenticator } from './auth';
import { createIslandRoomClass } from './islandRoom';
import { isAllowedOrigin } from './origin';
import type { RoomEventLog } from './roomEventLog';

export interface RoomServerOptions {
  allowedOrigins: readonly string[];
  authenticate: PlayerAuthenticator;
  log: RoomEventLog;
  now?: () => number;
  reconnectGraceSeconds?: number;
  tokenSweepMs?: number;
  /** Socket heartbeat: a client missing this many pings in a row is dropped. */
  pingIntervalMs?: number;
  pingMaxRetries?: number;
}

/** Small, because Phase 1 clients send nothing after joining; Phase 2 movement fits well under it. */
const MAX_MESSAGES_PER_SECOND = 20;
/** Bytes. Join options and presence are tiny; this caps abuse. */
const MAX_PAYLOAD_BYTES = 4096;

/**
 * Builds the Colyseus server with the island room registered. Shared by the
 * process entry point (`index.ts`) and the integration tests, so both run
 * the same wiring.
 */
export function createRoomServer(options: RoomServerOptions): Server {
  const transport = new WebSocketTransport({
    pingInterval: options.pingIntervalMs ?? 5000,
    pingMaxRetries: options.pingMaxRetries ?? 3,
    maxPayload: MAX_PAYLOAD_BYTES,
    beforeUpgrade: (request) =>
      isAllowedOrigin(request.headers.get('origin'), options.allowedOrigins)
        ? undefined
        : new Response('Forbidden', { status: 403 }),
  });

  // The matchmaker answers CORS for its HTTP route. Only echo an allowed origin.
  matchMaker.controller.getCorsHeaders = (headers: Headers): Record<string, string> => {
    const origin = headers.get('origin');
    return isAllowedOrigin(origin, options.allowedOrigins) && origin
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {};
  };

  const server = new Server({ transport, gracefullyShutdown: false, greet: false });
  server
    .define(
      ISLAND_ROOM_NAME,
      createIslandRoomClass({
        authenticate: options.authenticate,
        now: options.now ?? Date.now,
        reconnectGraceSeconds: options.reconnectGraceSeconds ?? RECONNECT_GRACE_SECONDS,
        tokenSweepMs: options.tokenSweepMs ?? 30_000,
        maxMessagesPerSecond: MAX_MESSAGES_PER_SECOND,
        log: options.log,
      }),
    )
    .filterBy(['regionId', 'householdKey']);
  return server;
}
