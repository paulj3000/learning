import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';
import { enabledSummary } from './fixtures';

const holder = vi.hoisted(() => ({ client: null as FakeDjangoClient | null }));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));

import * as api from './api';

let fake: FakeDjangoClient;
beforeEach(() => {
  fake = fakeDjangoClient();
  holder.client = fake;
});

describe('scoring api', () => {
  it('reads the summary and sends no body', async () => {
    fake.on('GET', 'children/c1/scoring/', enabledSummary());
    await expect(api.getScoringSummary('c1')).resolves.toMatchObject({ enabled: true });
    expect(fake.calls).toEqual([{ method: 'GET', path: 'children/c1/scoring/' }]);
  });

  it('reads the disabled summary', async () => {
    fake.on('GET', 'children/c1/scoring/', { enabled: false, contractVersion: 1 });
    await expect(api.getScoringSummary('c1')).resolves.toEqual({ enabled: false, contractVersion: 1 });
  });

  it('passes the cursor and rejects invalid data', async () => {
    fake.on('GET', 'children/c1/scoring/awards/?after=a%201', { awards: [], cursor: null, hasMore: false });
    await expect(api.getScoringAwards('c1', 'a 1')).resolves.toEqual({ awards: [], cursor: null, hasMore: false });
    fake.on('GET', 'children/c1/scoring/awards/', { awards: 'x' });
    await expect(api.getScoringAwards('c1')).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('has no write function', () => {
    expect(Object.keys(api).sort()).toEqual(['getScoringAwards', 'getScoringSummary']);
  });
});
