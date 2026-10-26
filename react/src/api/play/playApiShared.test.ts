import { describe, expect, it, vi } from 'vitest';

const { request, djangoClient } = vi.hoisted(() => {
  const request = vi.fn();
  return { request, djangoClient: vi.fn(() => ({ request })) };
});
vi.mock('../backend', () => ({ djangoClient }));

import { playApiFor } from './playApi';
import { CHILD_A, jsonResponse, progressJson } from '../../test/playFixtures';

describe('playApiFor on the shared transport (LAI-0501B)', () => {
  it('sends Treasure Rush calls through the shared Django client, unchanged routes', async () => {
    const body = await jsonResponse(200, progressJson()).json();
    request.mockResolvedValueOnce({ status: 200, data: body });
    const api = playApiFor(CHILD_A, { enabled: true, baseUrl: 'https://lai.example' });
    await api.getProgress();
    expect(djangoClient).toHaveBeenCalledWith({ backend: 'django', baseUrl: 'https://lai.example' });
    expect(request).toHaveBeenCalledWith('GET', `children/${CHILD_A}/progress/`, {
      signal: undefined,
    });
  });
});
