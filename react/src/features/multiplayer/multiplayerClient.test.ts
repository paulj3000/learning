import { createMultiplayerClient, type MultiplayerClient } from './multiplayerClient';
import { ROOM_CLOSE_CODES, type IslandJoinOptions } from './protocol';
import {
  MultiplayerJoinError,
  type MultiplayerTransport,
  type TransportRoomHandlers,
} from './transport';

interface FakeJoin {
  options: IslandJoinOptions;
  idToken: string;
  handlers: TransportRoomHandlers;
  left: boolean;
}

function fakeTransport(failWith?: MultiplayerJoinError) {
  const joins: FakeJoin[] = [];
  const transport: MultiplayerTransport = {
    async join(options, idToken, handlers) {
      if (failWith) throw failWith;
      const join: FakeJoin = { options, idToken, handlers, left: false };
      joins.push(join);
      return {
        async leave() {
          join.left = true;
        },
      };
    },
  };
  return { transport, joins };
}

let tokenNumber = 0;
const getIdentity = async () => ({ idToken: `token-${++tokenNumber}`, sub: 'parent-sub' });

async function joined(transport: MultiplayerTransport): Promise<MultiplayerClient> {
  const client = createMultiplayerClient({ transport, getIdentity });
  await client.join('welcome-harbor', 'child-a');
  return client;
}

describe('createMultiplayerClient', () => {
  it('starts idle', () => {
    const client = createMultiplayerClient({ transport: fakeTransport().transport, getIdentity });
    expect(client.getSnapshot().status).toBe('IDLE');
  });

  it('joins with a household key, never the raw sub', async () => {
    const { transport, joins } = fakeTransport();
    const client = await joined(transport);
    expect(client.getSnapshot().status).toBe('CONNECTED');
    expect(joins[0].options.regionId).toBe('welcome-harbor');
    expect(joins[0].options.childProfileId).toBe('child-a');
    expect(joins[0].options.householdKey).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(joins[0].options)).not.toContain('parent-sub');
  });

  it('tracks welcome and presence, and notifies subscribers', async () => {
    const { transport, joins } = fakeTransport();
    const client = await joined(transport);
    const listener = vi.fn();
    client.subscribe(listener);
    joins[0].handlers.onWelcome({ playerId: 'p1' });
    joins[0].handlers.onPresence({
      players: [{ playerId: 'p1', avatarKey: 'FOX', slot: 0, status: 'HERE' }],
    });
    expect(client.getSnapshot()).toMatchObject({
      selfPlayerId: 'p1',
      players: [{ playerId: 'p1' }],
    });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('shows reconnecting while the transport recovers the seat', async () => {
    const { transport, joins } = fakeTransport();
    const client = await joined(transport);
    joins[0].handlers.onDropped();
    expect(client.getSnapshot().status).toBe('RECONNECTING');
    joins[0].handlers.onReconnected();
    expect(client.getSnapshot().status).toBe('CONNECTED');
  });

  it('reports a failed join without throwing', async () => {
    const { transport } = fakeTransport(new MultiplayerJoinError('UNAUTHORIZED'));
    const client = await joined(transport);
    expect(client.getSnapshot()).toMatchObject({ status: 'FAILED', failure: 'UNAUTHORIZED' });
  });

  it('treats an unexpected error as unavailable', async () => {
    const client = createMultiplayerClient({
      transport: fakeTransport().transport,
      getIdentity: async () => {
        throw new Error('no session');
      },
    });
    await client.join('welcome-harbor', 'child-a');
    expect(client.getSnapshot()).toMatchObject({ status: 'FAILED', failure: 'UNAVAILABLE' });
  });

  it('says so when another screen took the seat', async () => {
    const { transport, joins } = fakeTransport();
    const client = await joined(transport);
    joins[0].handlers.onClosed(ROOM_CLOSE_CODES.REPLACED);
    expect(client.getSnapshot()).toMatchObject({
      status: 'DISCONNECTED',
      failure: 'REPLACED',
      players: [],
    });
  });

  it('rejoins once with a fresh token when the session expires', async () => {
    const { transport, joins } = fakeTransport();
    const client = await joined(transport);
    joins[0].handlers.onClosed(ROOM_CLOSE_CODES.SESSION_EXPIRED);
    await vi.waitFor(() => expect(joins).toHaveLength(2));
    expect(joins[1].idToken).not.toBe(joins[0].idToken);
    await vi.waitFor(() => expect(client.getSnapshot().status).toBe('CONNECTED'));

    joins[1].handlers.onClosed(ROOM_CLOSE_CODES.SESSION_EXPIRED);
    expect(client.getSnapshot()).toMatchObject({
      status: 'DISCONNECTED',
      failure: 'CONNECTION_LOST',
    });
    expect(joins).toHaveLength(2);
  });

  it('leaves with consent and ignores late callbacks from the old room', async () => {
    const { transport, joins } = fakeTransport();
    const client = await joined(transport);
    await client.leave();
    expect(joins[0].left).toBe(true);
    joins[0].handlers.onPresence({
      players: [{ playerId: 'p2', avatarKey: null, slot: 1, status: 'HERE' }],
    });
    expect(client.getSnapshot()).toMatchObject({ status: 'IDLE', players: [] });
  });

  it('leaves the old room when joining again', async () => {
    const { transport, joins } = fakeTransport();
    const client = await joined(transport);
    await client.join('welcome-harbor', 'child-b');
    expect(joins[0].left).toBe(true);
    expect(joins).toHaveLength(2);
  });
});
