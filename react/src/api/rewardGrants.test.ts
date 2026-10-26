import { describe, expect, it, vi } from 'vitest';

const amplify = vi.hoisted(() => ({
  getInventory: vi.fn(),
  grantRewards: vi.fn(),
  clearInventory: vi.fn(),
}));
vi.mock('./amplify/rewards', () => amplify);
vi.mock('../lib/data-client', () => ({ client: { models: {}, mutations: {} } }));

import { createDjangoAdventures, type AdventuresApi } from './adventures';
import { createDjangoRewards, rewardsApi, type RewardsApi } from './rewards';
import { djangoTestClient } from '../test/apiFixtures';
import { CHILD_A, SESSION_ID, errorJson, jsonResponse } from '../test/playFixtures';

const MEDAL = {
  itemId: 'medal',
  displayName: 'Medal',
  description: 'A medal',
  category: 'KEEPSAKE',
  assetId: '',
};

function grantJson(overrides: Record<string, unknown> = {}) {
  return {
    grantId: '7b1c0000-0000-4000-8000-000000000009',
    ruleId: 'reward-finale',
    source: 'ADVENTURE_COMPLETED',
    message: 'A medal!',
    items: [MEDAL],
    grantedAt: '2026-10-26T10:00:00+00:00',
    ...overrides,
  };
}

const SESSION = {
  id: SESSION_ID,
  childId: CHILD_A,
  adventureSlug: 'finale',
  templateVersion: 1,
  status: 'COMPLETED',
  currentStepId: 'end',
  hintLevel: 0,
  startedAt: '2026-10-26T10:00:00+00:00',
  lastActivityAt: '2026-10-26T10:00:00+00:00',
  completedAt: '2026-10-26T10:00:00+00:00',
};

function adventures(...responses: Response[]) {
  const harness = djangoTestClient(...responses);
  return { ...harness, api: createDjangoAdventures(harness.client) as Required<AdventuresApi> };
}

function rewards(...responses: Array<Response | Error>) {
  const harness = djangoTestClient(...responses);
  return { ...harness, api: createDjangoRewards(harness.client) as Required<RewardsApi> };
}

describe('rewards on Django gameplay responses (LAI-0604)', () => {
  it('reads what an answer earned, newly granted, for an immediate celebration', async () => {
    const { api } = adventures(
      jsonResponse(200, {
        correctness: 'not_applicable',
        supportLevel: 0,
        action: 'ADVANCE',
        nextStepId: 'done',
        attemptNumber: 1,
        replayed: false,
        session: SESSION,
        rewards: { grants: [{ ...grantJson(), newlyGranted: true }], newItems: [MEDAL] },
      }),
    );
    const result = await api.submitAdventureAnswer(SESSION_ID, { kind: 'world-change' }, 0, {
      childProfileId: CHILD_A,
      stepId: 'fix',
    });
    expect(result.rewards?.newItems).toEqual([MEDAL]);
    expect(result.rewards?.grants[0]).toMatchObject({ ruleId: 'reward-finale', newlyGranted: true });
  });

  it('reads a replay as previously granted, with nothing new to show', async () => {
    const { api } = adventures(
      jsonResponse(200, {
        correctness: 'correct',
        supportLevel: 0,
        action: 'ADVANCE',
        nextStepId: 'x',
        attemptNumber: 1,
        replayed: true,
        session: SESSION,
        rewards: { grants: [{ ...grantJson(), newlyGranted: false }], newItems: [] },
      }),
    );
    const { rewards: outcome } = await api.submitAdventureAnswer(SESSION_ID, { kind: 'narrative' }, 0, {
      childProfileId: CHILD_A,
      stepId: 's',
    });
    expect(outcome).toEqual({ grants: [{ ...grantJson(), newlyGranted: false }], newItems: [] });
  });

  it('keeps answering working against a server that sends no rewards field', async () => {
    const { api } = adventures(
      jsonResponse(200, { correctness: 'correct', supportLevel: 0, action: 'RETRY', session: SESSION }),
    );
    const result = await api.submitAdventureAnswer(SESSION_ID, { kind: 'narrative' }, 0, {
      childProfileId: CHILD_A,
      stepId: 's',
    });
    expect(result.rewards).toBeUndefined();
  });

  it('carries completion rewards on the completed session', async () => {
    const { api } = adventures(
      jsonResponse(200, {
        session: SESSION,
        step: null,
        progress: { completedStepIds: [] },
        contentCurrent: true,
        allowedActions: [],
        canComplete: false,
        rewards: { grants: [{ ...grantJson(), newlyGranted: true }], newItems: [MEDAL] },
      }),
    );
    const completed = await api.completeSession(SESSION_ID, {
      childProfileId: CHILD_A,
      adventureSlug: 'finale',
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.rewards?.newItems).toEqual([MEDAL]);
  });

  it('rejects a rewards object off the contract', async () => {
    const { api } = adventures(
      jsonResponse(200, {
        correctness: 'correct',
        supportLevel: 0,
        action: 'RETRY',
        session: SESSION,
        rewards: { grants: [{ ruleId: 'x' }], newItems: [] },
      }),
    );
    await expect(
      api.submitAdventureAnswer(SESSION_ID, { kind: 'narrative' }, 0, {
        childProfileId: CHILD_A,
        stepId: 's',
      }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });
  });
});

describe('Django reward history (LAI-0604)', () => {
  it('lists the child’s grants from the child-scoped route', async () => {
    const { api, call } = rewards(jsonResponse(200, { rewards: [grantJson()] }));
    await expect(api.listRewardGrants(CHILD_A)).resolves.toEqual([grantJson()]);
    expect(call()).toMatchObject({
      url: `https://lai.example/api/v1/children/${CHILD_A}/rewards/`,
      method: 'GET',
    });
  });

  it('reads one grant, null when it is unknown or not this child’s', async () => {
    const { api, call } = rewards(
      jsonResponse(200, grantJson()),
      jsonResponse(404, errorJson('not_found')),
    );
    await expect(api.getRewardGrant(CHILD_A, grantJson().grantId)).resolves.toEqual(grantJson());
    expect(call().url).toBe(
      `https://lai.example/api/v1/children/${CHILD_A}/rewards/${grantJson().grantId}/`,
    );
    await expect(api.getRewardGrant(CHILD_A, 'nope')).resolves.toBeNull();
  });

  it('reports a network failure, typed', async () => {
    const { api } = rewards(new TypeError('Failed to fetch'));
    await expect(api.listRewardGrants(CHILD_A)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('Amplify reward history', () => {
  it('describes fired rules from the bundled reward table, with no grant time', async () => {
    amplify.getInventory.mockResolvedValue({
      ownedItemIds: ['bridge-builders-hammer'],
      grantedRuleIds: ['reward-bridge-repaired', 'a-rule-no-longer-authored'],
    });
    const [grant, ...rest] = await rewardsApi.listRewardGrants(CHILD_A);
    expect(rest).toEqual([]);
    expect(grant).toMatchObject({
      grantId: 'reward-bridge-repaired',
      source: 'ADVENTURE_COMPLETED',
      grantedAt: null,
    });
    expect(grant?.items.map((item) => item.itemId)).toEqual([
      'bridge-builders-hammer',
      'explorer-backpack',
    ]);
    await expect(rewardsApi.getRewardGrant(CHILD_A, 'reward-bridge-repaired')).resolves.toMatchObject({
      ruleId: 'reward-bridge-repaired',
    });
  });
});
