// @vitest-environment node
import { createAppSyncChildProfileLookup } from './appSyncChildProfiles';

const URL = 'https://example.appsync-api.us-west-1.amazonaws.com/graphql';

function respond(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status }),
  );
}

describe('createAppSyncChildProfileLookup', () => {
  it("forwards the parent's own token and asks only for the fields it needs", async () => {
    const fetchImpl = respond(200, {
      data: { getChildProfile: { id: 'c1', owner: 's::u', ownerSub: 's', avatarKey: 'FOX' } },
    });
    const lookup = createAppSyncChildProfileLookup(URL, fetchImpl as unknown as typeof fetch);
    await expect(lookup('id-token', 'c1')).resolves.toEqual({
      id: 'c1',
      owner: 's::u',
      ownerSub: 's',
      avatarKey: 'FOX',
    });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('id-token');
    const query = JSON.parse(init.body as string).query as string;
    expect(query).not.toContain('nickname');
    expect(query).not.toContain('photo');
  });

  it('returns null when the row is not this parent’s', async () => {
    const unauthorized = respond(200, {
      data: { getChildProfile: null },
      errors: [{ errorType: 'Unauthorized' }],
    });
    const lookup = createAppSyncChildProfileLookup(URL, unauthorized as unknown as typeof fetch);
    await expect(lookup('t', 'c1')).resolves.toBeNull();

    const missing = respond(200, { data: { getChildProfile: null } });
    await expect(
      createAppSyncChildProfileLookup(URL, missing as unknown as typeof fetch)('t', 'c1'),
    ).resolves.toBeNull();

    const rejectedToken = respond(401, {});
    await expect(
      createAppSyncChildProfileLookup(URL, rejectedToken as unknown as typeof fetch)('t', 'c1'),
    ).resolves.toBeNull();
  });

  it('throws on server errors so the caller can refuse with LOOKUP_FAILED', async () => {
    const failing = respond(500, {});
    await expect(
      createAppSyncChildProfileLookup(URL, failing as unknown as typeof fetch)('t', 'c1'),
    ).rejects.toThrow();
    const graphqlError = respond(200, { errors: [{ errorType: 'DynamoDB:Throttled' }] });
    await expect(
      createAppSyncChildProfileLookup(URL, graphqlError as unknown as typeof fetch)('t', 'c1'),
    ).rejects.toThrow();
  });
});
