import {
  MAX_ROOM_CAPACITY,
  parseJoinOptions,
  parsePresenceMessage,
  parseWelcomeMessage,
  toAvatarKey,
} from './protocol';

const KEY = 'a'.repeat(64);

describe('parseJoinOptions', () => {
  it('accepts well-formed options', () => {
    expect(
      parseJoinOptions({ regionId: 'welcome-harbor', childProfileId: 'c-1', householdKey: KEY }),
    ).toEqual({
      regionId: 'welcome-harbor',
      childProfileId: 'c-1',
      householdKey: KEY,
    });
  });

  it('drops fields it does not know, so nothing extra rides along', () => {
    const parsed = parseJoinOptions({
      regionId: 'welcome-harbor',
      childProfileId: 'c-1',
      householdKey: KEY,
      nickname: 'Sam',
    });
    expect(parsed).not.toHaveProperty('nickname');
  });

  it.each([
    ['not an object', 'nope'],
    ['missing region', { childProfileId: 'c-1', householdKey: KEY }],
    ['region with spaces', { regionId: 'a b', childProfileId: 'c-1', householdKey: KEY }],
    ['child id with a slash', { regionId: 'r', childProfileId: '../x', householdKey: KEY }],
    ['a raw sub as household key', { regionId: 'r', childProfileId: 'c', householdKey: 'abc-123' }],
    [
      'upper-case household key',
      { regionId: 'r', childProfileId: 'c', householdKey: 'A'.repeat(64) },
    ],
  ])('rejects %s', (_label, value) => {
    expect(parseJoinOptions(value)).toBeNull();
  });
});

describe('toAvatarKey', () => {
  it('keeps authored avatar keys and nulls anything else', () => {
    expect(toAvatarKey('FOX')).toBe('FOX');
    expect(toAvatarKey('Hello, I live at 12 Elm St')).toBeNull();
    expect(toAvatarKey(7)).toBeNull();
  });
});

describe('server messages', () => {
  it('parses a welcome', () => {
    expect(parseWelcomeMessage({ playerId: 'p3' })).toEqual({ playerId: 'p3' });
    expect(parseWelcomeMessage({ playerId: 'child-uuid' })).toBeNull();
  });

  it('parses presence and sanitises avatar keys', () => {
    expect(
      parsePresenceMessage({
        players: [{ playerId: 'p1', avatarKey: 'not-a-key', slot: 0, status: 'HERE' }],
      }),
    ).toEqual({ players: [{ playerId: 'p1', avatarKey: null, slot: 0, status: 'HERE' }] });
  });

  it('rejects presence with a bad player, a bad slot or too many players', () => {
    expect(
      parsePresenceMessage({ players: [{ playerId: 'p1', slot: 0, status: 'GONE' }] }),
    ).toBeNull();
    expect(
      parsePresenceMessage({
        players: [{ playerId: 'p1', slot: MAX_ROOM_CAPACITY, status: 'HERE' }],
      }),
    ).toBeNull();
    const many = Array.from({ length: MAX_ROOM_CAPACITY + 1 }, (_, i) => ({
      playerId: `p${i + 1}`,
      slot: 0,
      status: 'HERE',
    }));
    expect(parsePresenceMessage({ players: many })).toBeNull();
  });
});
