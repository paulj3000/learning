// @vitest-environment node
import { request } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { matchMaker, type Server } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { householdKeyFor } from '../../react/src/features/multiplayer/householdKey';
import {
  ISLAND_ROOM_NAME,
  parsePresenceMessage,
  ROOM_CLOSE_CODES,
  SERVER_MESSAGES,
  type PresenceMessage,
} from '../../react/src/features/multiplayer/protocol';
import { createPlayerAuthenticator, type ChildProfileRecord } from './auth';
import type { RoomEvent } from './roomEventLog';
import { createRoomServer } from './roomServer';

/**
 * Roadmap Phase 1 acceptance, against a real Colyseus server and the real
 * SDK over real WebSockets. Only Cognito and AppSync are faked, behind the
 * same `PlayerAuthDeps` seam the production server fills in.
 */

const ORIGIN = 'http://localhost:5173';

/** Token -> identity, standing in for Cognito. */
const TOKENS: Record<string, { sub: string; expiresAt: number }> = {
  'parent-a': { sub: 'sub-a', expiresAt: Date.now() + 3_600_000 },
  'parent-b': { sub: 'sub-b', expiresAt: Date.now() + 3_600_000 },
  'parent-a-expiring': { sub: 'sub-a', expiresAt: Date.now() + 1500 },
};
/** Child -> owner, standing in for AppSync's owner rule. */
const CHILDREN: Record<string, ChildProfileRecord> = {
  'child-a1': { id: 'child-a1', ownerSub: 'sub-a', owner: null, avatarKey: 'FOX' },
  'child-a2': { id: 'child-a2', ownerSub: 'sub-a', owner: null, avatarKey: 'OWL' },
  'child-b1': { id: 'child-b1', ownerSub: 'sub-b', owner: null, avatarKey: 'ROBOT' },
};

let server: Server;
let port: number;
const events: RoomEvent[] = [];
const openRooms: Room[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port: found } = probe.address() as AddressInfo;
      probe.close(() => resolve(found));
    });
  });
}

beforeAll(async () => {
  port = await freePort();
  server = createRoomServer({
    allowedOrigins: [ORIGIN],
    log: (event) => events.push(event),
    reconnectGraceSeconds: 5,
    tokenSweepMs: 250,
    authenticate: createPlayerAuthenticator({
      verifyIdToken: async (token) => {
        const identity = TOKENS[token];
        if (!identity) throw new Error('invalid');
        return identity;
      },
      fetchOwnChildProfile: async (token, id) => {
        const child = CHILDREN[id];
        return child && child.ownerSub === TOKENS[token]?.sub ? child : null;
      },
      householdKeyFor,
    }),
  });
  await server.listen(port);
});

afterAll(async () => {
  // `leave()` never settles for a room that is already closed, so bound it.
  const settle = (room: Room) =>
    Promise.race([
      room.leave(true).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 200)),
    ]);
  await Promise.all(openRooms.map(settle));
  await server.gracefullyShutdown(false);
});

interface Joined {
  room: Room;
  presence: PresenceMessage[];
  latest(): PresenceMessage | undefined;
}

async function join(token: string, childProfileId: string, sub: string): Promise<Joined> {
  const client = new Client(`http://localhost:${port}`, { headers: { origin: ORIGIN } });
  client.auth.token = token;
  const presence: PresenceMessage[] = [];
  const room = await client.joinOrCreate(ISLAND_ROOM_NAME, {
    regionId: 'welcome-harbor',
    childProfileId,
    householdKey: await householdKeyFor(sub),
  });
  room.reconnection.minUptime = 0;
  room.onMessage(SERVER_MESSAGES.WELCOME, () => undefined);
  room.onMessage(SERVER_MESSAGES.PRESENCE, (payload: unknown) => {
    const parsed = parsePresenceMessage(payload);
    if (parsed) presence.push(parsed);
  });
  openRooms.push(room);
  return { room, presence, latest: () => presence.at(-1) };
}

async function joinError(token: string, childProfileId: string, sub: string): Promise<number> {
  try {
    const { room } = await join(token, childProfileId, sub);
    await room.leave(true);
  } catch (error) {
    return (error as { code: number }).code;
  }
  throw new Error('expected the join to be refused');
}

const herePlayers = (joined: Joined) =>
  joined.latest()?.players.filter((player) => player.status === 'HERE').length;

describe('island room server (Phase 1 acceptance)', () => {
  it('seats two children of one family in the same room and both see each other', async () => {
    const first = await join('parent-a', 'child-a1', 'sub-a');
    const second = await join('parent-a', 'child-a2', 'sub-a');
    expect(second.room.roomId).toBe(first.room.roomId);

    await vi.waitFor(() => expect(first.latest()?.players).toHaveLength(2));
    await vi.waitFor(() => expect(second.latest()?.players).toHaveLength(2));
    expect(first.latest()?.players.map((p) => p.avatarKey)).toEqual(['FOX', 'OWL']);
    expect(JSON.stringify(first.presence)).not.toContain('child-a');

    await second.room.leave(true);
    await vi.waitFor(() => expect(first.latest()?.players).toHaveLength(1));
    await first.room.leave(true);
  });

  it('refuses a missing or forged token', async () => {
    expect(await joinError('', 'child-a1', 'sub-a')).toBe(525);
    expect(await joinError('forged', 'child-a1', 'sub-a')).toBe(525);
  });

  it("refuses another family's child and another family's room", async () => {
    expect(await joinError('parent-b', 'child-a1', 'sub-b')).toBe(525);
    expect(await joinError('parent-b', 'child-b1', 'sub-a')).toBe(525);
    const reasons = events.flatMap((event) =>
      event.event === 'auth-rejected' ? [event.reason] : [],
    );
    expect(reasons).toEqual(
      expect.arrayContaining([
        'MISSING_TOKEN',
        'INVALID_TOKEN',
        'NOT_YOUR_CHILD',
        'NOT_YOUR_HOUSEHOLD',
      ]),
    );
  });

  it('puts different families in different rooms', async () => {
    const a = await join('parent-a', 'child-a1', 'sub-a');
    const b = await join('parent-b', 'child-b1', 'sub-b');
    expect(a.room.roomId).not.toBe(b.room.roomId);
    await Promise.all([a.room.leave(true), b.room.leave(true)]);
  });

  it('rejoining from a second screen replaces the seat instead of duplicating the player', async () => {
    const sibling = await join('parent-a', 'child-a2', 'sub-a');
    const firstScreen = await join('parent-a', 'child-a1', 'sub-a');
    const closed = new Promise<number>((resolve) =>
      firstScreen.room.onLeave((code) => resolve(code)),
    );

    const secondScreen = await join('parent-a', 'child-a1', 'sub-a');
    expect(await closed).toBe(ROOM_CLOSE_CODES.REPLACED);
    await vi.waitFor(() => expect(sibling.latest()?.players).toHaveLength(2));
    const ids = sibling.latest()?.players.map((p) => p.playerId);
    expect(new Set(ids).size).toBe(2);

    await Promise.all([sibling.room.leave(true), secondScreen.room.leave(true)]);
  });

  it('holds a dropped seat and gives it back on reconnect, without a duplicate', async () => {
    const sibling = await join('parent-a', 'child-a2', 'sub-a');
    const dropper = await join('parent-a', 'child-a1', 'sub-a');
    // Colyseus only holds a seat for a client that finished the join handshake. Receiving
    // presence proves it has, so wait for that before cutting the connection.
    await vi.waitFor(() => expect(herePlayers(sibling)).toBe(2));
    await vi.waitFor(() => expect(herePlayers(dropper)).toBe(2));
    const reconnected = new Promise<void>((resolve) => dropper.room.onReconnect(() => resolve()));

    // Cut the socket abruptly from the server side, as a network drop would.
    const serverRoom = matchMaker.getLocalRoomById(dropper.room.roomId);
    const serverClient = serverRoom?.clients.get(dropper.room.sessionId) as unknown as {
      ref: { terminate(): void };
    };
    serverClient.ref.terminate();

    await vi.waitFor(() =>
      expect(sibling.presence.flatMap((m) => m.players.map((p) => p.status))).toContain(
        'RECONNECTING',
      ),
    );
    await reconnected;
    await vi.waitFor(() => expect(herePlayers(sibling)).toBe(2));
    expect(sibling.latest()?.players).toHaveLength(2);

    await Promise.all([sibling.room.leave(true), dropper.room.leave(true)]);
  });

  it('closes a seat whose token expires, with the code that tells the client to rejoin', async () => {
    const expiring = await join('parent-a-expiring', 'child-a1', 'sub-a');
    const code = await new Promise<number>((resolve) => expiring.room.onLeave((c) => resolve(c)));
    expect(code).toBe(ROOM_CLOSE_CODES.SESSION_EXPIRED);
  });

  it('refuses a WebSocket upgrade from an origin that is not allowed', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({
        port,
        path: '/anything',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          Origin: 'https://evil.example',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        },
      });
      req.on('response', (res) => resolve(res.statusCode));
      req.on('upgrade', () => reject(new Error('upgrade should have been refused')));
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('logs no child ids', () => {
    expect(JSON.stringify(events)).not.toMatch(/child-|sub-a|sub-b/);
  });
});
