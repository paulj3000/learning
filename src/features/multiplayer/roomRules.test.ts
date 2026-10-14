import {
  admitPlayer,
  createIslandRoomState,
  expiredSessionIds,
  markDropped,
  markReconnected,
  presenceOf,
  removePlayer,
  type IslandRoomState,
  type SeatCandidate,
} from './roomRules';

const HOUSEHOLD = 'h'.repeat(64);

function candidate(overrides: Partial<SeatCandidate> = {}): SeatCandidate {
  return {
    sessionId: 's1',
    regionId: 'welcome-harbor',
    householdKey: HOUSEHOLD,
    childProfileId: 'child-a',
    avatarKey: 'FOX',
    tokenExpiresAt: 10_000,
    ...overrides,
  };
}

function seat(state: IslandRoomState, overrides: Partial<SeatCandidate>): IslandRoomState {
  const result = admitPlayer(state, candidate(overrides));
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const empty = () => createIslandRoomState('welcome-harbor', HOUSEHOLD, 3);

describe('admitPlayer', () => {
  it('seats two children with their own player ids and slots', () => {
    const state = seat(seat(empty(), {}), { sessionId: 's2', childProfileId: 'child-b' });
    expect(presenceOf(state).players).toEqual([
      { playerId: 'p1', avatarKey: 'FOX', slot: 0, status: 'HERE' },
      { playerId: 'p2', avatarKey: 'FOX', slot: 1, status: 'HERE' },
    ]);
  });

  it('refuses another region or household', () => {
    expect(admitPlayer(empty(), candidate({ regionId: 'pirate-builder-bay' }))).toEqual({
      ok: false,
      reason: 'WRONG_ROOM',
    });
    expect(admitPlayer(empty(), candidate({ householdKey: 'x'.repeat(64) }))).toEqual({
      ok: false,
      reason: 'WRONG_ROOM',
    });
  });

  it('refuses a fourth child when capacity is three', () => {
    let state = empty();
    for (const id of ['a', 'b', 'c']) state = seat(state, { sessionId: id, childProfileId: id });
    expect(admitPlayer(state, candidate({ sessionId: 'd', childProfileId: 'd' }))).toEqual({
      ok: false,
      reason: 'ROOM_FULL',
    });
  });

  it('moves a rejoining child to the new session instead of adding a duplicate', () => {
    const first = seat(empty(), {});
    const result = admitPlayer(first, candidate({ sessionId: 's9', tokenExpiresAt: 99_000 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.replacedSessionId).toBe('s1');
    expect(result.state.players).toHaveLength(1);
    expect(result.player).toMatchObject({
      sessionId: 's9',
      playerId: 'p1',
      slot: 0,
      tokenExpiresAt: 99_000,
    });
  });

  it('also replaces a seat that was waiting to reconnect', () => {
    const dropped = markDropped(seat(empty(), {}), 's1');
    const result = admitPlayer(dropped, candidate({ sessionId: 's2' }));
    expect(result.ok && result.player.status).toBe('HERE');
    expect(result.ok && result.replacedSessionId).toBe('s1');
  });

  it('reuses the lowest free slot after someone leaves', () => {
    let state = seat(seat(empty(), {}), { sessionId: 's2', childProfileId: 'child-b' });
    state = removePlayer(state, 's1');
    state = seat(state, { sessionId: 's3', childProfileId: 'child-c' });
    expect(presenceOf(state).players.map((p) => [p.playerId, p.slot])).toEqual([
      ['p3', 0],
      ['p2', 1],
    ]);
  });
});

describe('connection lifecycle', () => {
  it('marks a dropped player as reconnecting, then back', () => {
    const dropped = markDropped(seat(empty(), {}), 's1');
    expect(presenceOf(dropped).players[0].status).toBe('RECONNECTING');
    expect(presenceOf(markReconnected(dropped, 's1')).players[0].status).toBe('HERE');
  });

  it('removing a replaced session does not remove the child who replaced it', () => {
    const first = seat(empty(), {});
    const replaced = seat(first, { sessionId: 's2' });
    expect(removePlayer(replaced, 's1').players).toHaveLength(1);
  });

  it('ignores unknown sessions', () => {
    const state = seat(empty(), {});
    expect(markDropped(state, 'nope')).toBe(state);
    expect(removePlayer(state, 'nope')).toBe(state);
  });

  it('lists sessions whose token has expired', () => {
    const state = seat(seat(empty(), { tokenExpiresAt: 5 }), {
      sessionId: 's2',
      childProfileId: 'child-b',
      tokenExpiresAt: 50,
    });
    expect(expiredSessionIds(state, 10)).toEqual(['s1']);
  });
});

describe('presenceOf', () => {
  it('never includes the child profile id', () => {
    const json = JSON.stringify(presenceOf(seat(empty(), { childProfileId: 'secret-child-id' })));
    expect(json).not.toContain('secret-child-id');
    expect(json).not.toContain('sessionId');
  });
});
