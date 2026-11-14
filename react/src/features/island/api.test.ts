import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const holder = vi.hoisted(() => ({ client: null as FakeDjangoClient | null }));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));

import { getCompanionProfile, getOrCreateCompanionProfile } from './api';

const COMPANION = 'children/child-1/companion/';
const CHATTY = {
  companionType: 'CHATTY_PARROT',
  displayName: 'Chatty',
  chosenAt: '2026-11-01T10:00:00+00:00',
};

let api: FakeDjangoClient;
beforeEach(() => {
  api = fakeDjangoClient();
  holder.client = api;
});

describe('companion choice on Django (AMP-03)', () => {
  it('reads null before the child chooses', async () => {
    api.on('GET', COMPANION, { companion: null });
    expect(await getCompanionProfile('child-1')).toBeNull();
  });

  it('chooses Chatty by type only; the name comes from the server', async () => {
    api.on('PUT', COMPANION, { companion: CHATTY });
    const companion = await getOrCreateCompanionProfile('child-1');
    expect(api.calls).toEqual([
      { method: 'PUT', path: COMPANION, body: { companionType: 'CHATTY_PARROT' } },
    ]);
    expect(companion).toEqual({ childProfileId: 'child-1', ...CHATTY });
  });

  it('refuses a companion type it does not know', async () => {
    holder.client = fakeDjangoClient().on('GET', COMPANION, {
      companion: { ...CHATTY, companionType: 'DRAGON' },
    });
    await expect(getCompanionProfile('child-1')).rejects.toMatchObject({
      kind: 'invalid_response',
    });
  });
});
