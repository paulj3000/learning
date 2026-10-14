// @vitest-environment node
import { householdKeyFor } from '../../src/features/multiplayer/householdKey';
import {
  createPlayerAuthenticator,
  PlayerAuthRejected,
  type ChildProfileRecord,
  type PlayerAuthDeps,
} from './auth';

const SUB = 'parent-sub-1';

async function setup(overrides: Partial<PlayerAuthDeps> = {}) {
  const profile: ChildProfileRecord = {
    id: 'child-a',
    ownerSub: SUB,
    owner: `${SUB}::parent@example.org`,
    avatarKey: 'OWL',
  };
  const deps: PlayerAuthDeps = {
    verifyIdToken: async (token) => {
      if (token !== 'good-token') throw new Error('bad signature');
      return { sub: SUB, expiresAt: 1_000_000 };
    },
    fetchOwnChildProfile: async (_token, id) => (id === profile.id ? profile : null),
    householdKeyFor,
    ...overrides,
  };
  const options = {
    regionId: 'welcome-harbor',
    childProfileId: 'child-a',
    householdKey: await householdKeyFor(SUB),
  };
  return { authenticate: createPlayerAuthenticator(deps), options };
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PlayerAuthRejected) return error.reason;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('createPlayerAuthenticator', () => {
  it('seats the owner of the child', async () => {
    const { authenticate, options } = await setup();
    await expect(authenticate('good-token', options)).resolves.toEqual({
      regionId: 'welcome-harbor',
      householdKey: options.householdKey,
      childProfileId: 'child-a',
      avatarKey: 'OWL',
      tokenExpiresAt: 1_000_000,
    });
  });

  it('refuses a connection with no token', async () => {
    const { authenticate, options } = await setup();
    expect(await rejection(authenticate(undefined, options))).toBe('MISSING_TOKEN');
  });

  it('refuses a token that does not verify', async () => {
    const { authenticate, options } = await setup();
    expect(await rejection(authenticate('forged-token', options))).toBe('INVALID_TOKEN');
  });

  it('refuses malformed options before touching the token', async () => {
    const verifyIdToken = vi.fn();
    const { authenticate } = await setup({ verifyIdToken });
    expect(await rejection(authenticate('good-token', { regionId: 'x' }))).toBe('BAD_OPTIONS');
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("refuses another family's household key", async () => {
    const { authenticate, options } = await setup();
    const otherKey = await householdKeyFor('someone-else');
    expect(
      await rejection(authenticate('good-token', { ...options, householdKey: otherKey })),
    ).toBe('NOT_YOUR_HOUSEHOLD');
  });

  it('refuses a child AppSync will not return to this parent', async () => {
    const { authenticate, options } = await setup();
    expect(
      await rejection(authenticate('good-token', { ...options, childProfileId: 'child-z' })),
    ).toBe('NOT_YOUR_CHILD');
  });

  it('refuses a returned row whose ownerSub is someone else', async () => {
    const { authenticate, options } = await setup({
      fetchOwnChildProfile: async (_t, id) => ({
        id,
        ownerSub: 'intruder',
        owner: null,
        avatarKey: null,
      }),
    });
    expect(await rejection(authenticate('good-token', options))).toBe('NOT_YOUR_CHILD');
  });

  it('falls back to the owner field for rows written before ownerSub', async () => {
    const { authenticate, options } = await setup({
      fetchOwnChildProfile: async (_t, id) => ({
        id,
        ownerSub: null,
        owner: `${SUB}::p`,
        avatarKey: 'FOX',
      }),
    });
    await expect(authenticate('good-token', options)).resolves.toMatchObject({ avatarKey: 'FOX' });
  });

  it('reports a failed lookup distinctly, and still refuses', async () => {
    const { authenticate, options } = await setup({
      fetchOwnChildProfile: async () => {
        throw new Error('timeout');
      },
    });
    expect(await rejection(authenticate('good-token', options))).toBe('LOOKUP_FAILED');
  });

  it('never forwards a non-authored avatar key', async () => {
    const { authenticate, options } = await setup({
      fetchOwnChildProfile: async (_t, id) => ({
        id,
        ownerSub: SUB,
        owner: null,
        avatarKey: 'free text',
      }),
    });
    await expect(authenticate('good-token', options)).resolves.toMatchObject({ avatarKey: null });
  });
});
