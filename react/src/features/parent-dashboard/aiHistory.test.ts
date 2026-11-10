import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../api/client';

import { aiHistoryStore, createDjangoAiHistoryStore, readSafetyEvent } from './api';

const EVENT = {
  id: 'e1',
  category: 'companion-guardrail',
  severity: 'MEDIUM',
  source: 'SYSTEM',
  actionTaken: 'Replaced with authored fallback content.',
  reviewStatus: 'OPEN',
  createdAt: '2026-11-01T10:00:00+00:00',
};

describe('Django AI history store (LAI-0706)', () => {
  it('lists the child safety events from Django and drops malformed rows', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      data: { results: [EVENT, { id: 1 }, { ...EVENT, id: 'e2', severity: 'EXTREME' }] },
    }));
    const store = createDjangoAiHistoryStore({ request } as unknown as ApiClient);
    const events = await store.listSafetyEvents('child 1');
    expect(request).toHaveBeenCalledWith('GET', 'children/child%201/ai/safety-events/');
    expect(events).toEqual([
      {
        id: 'e1',
        category: 'companion-guardrail',
        severity: 'MEDIUM',
        actionTaken: 'Replaced with authored fallback content.',
        reviewStatus: 'OPEN',
        createdAt: '2026-11-01T10:00:00+00:00',
      },
    ]);
  });

  it('clears the history with one DELETE', async () => {
    const request = vi.fn(async () => ({ status: 200, data: {} }));
    await createDjangoAiHistoryStore({ request } as unknown as ApiClient).clearAIHistory('c1');
    expect(request).toHaveBeenCalledWith('DELETE', 'children/c1/ai/history/');
  });

  it('always reads from Django: there is no Amplify store any more (AMP-03)', async () => {
    const request = vi.fn(async () => ({ status: 200, data: { results: [] } }));
    expect(
      await aiHistoryStore({ request } as unknown as ApiClient).listSafetyEvents('c1'),
    ).toEqual([]);
    expect(request).toHaveBeenCalledWith('GET', 'children/c1/ai/safety-events/');
    expect(readSafetyEvent(null)).toBeUndefined();
  });
});
