import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDjangoClient, type FakeDjangoClient } from '../../test/fakeDjangoClient';

const holder = vi.hoisted(() => ({ client: null as FakeDjangoClient | null }));
vi.mock('../../api/djangoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/djangoClient')>()),
  djangoClient: () => holder.client,
}));

import {
  clearNpcState,
  getNpcState,
  initialRelationshipState,
  listNpcStates,
  recordDialogueNode,
} from './api';
import type { DialogueNode } from './types';

const greeting: DialogueNode = {
  id: 'pip-greeting',
  conditions: [{ type: 'ALWAYS' }],
  text: 'Ahoy!',
  choices: [],
  setsMemoryFlags: ['metPip'],
  awardsRelationshipPoints: 1,
};

function npc(overrides: Record<string, unknown> = {}) {
  return {
    npcId: 'pirate-pip',
    relationshipPoints: 1,
    relationshipLevel: 'STRANGER',
    memoryFlags: { metPip: true },
    seenNodeIds: ['pip-greeting'],
    firstMetAt: '2026-08-01T00:00:00+00:00',
    lastInteractedAt: '2026-08-01T00:00:00+00:00',
    ...overrides,
  };
}

const NPCS = 'children/child-1/npc-memory/';
let api: FakeDjangoClient;

beforeEach(() => {
  api = fakeDjangoClient();
  holder.client = api;
});

describe('NPC state on Django (AMP-03)', () => {
  it('reads every NPC the child has met, and a fresh state for one never met', async () => {
    api.on('GET', NPCS, { npcs: [npc()] });
    expect(await listNpcStates('child-1')).toEqual([
      {
        npcId: 'pirate-pip',
        relationshipPoints: 1,
        memoryFlags: { metPip: true },
        seenNodeIds: ['pip-greeting'],
      },
    ]);
    expect(await getNpcState('child-1', 'cove-keeper')).toEqual(
      initialRelationshipState('cove-keeper'),
    );
  });

  it('drops malformed memory flags rather than trusting them', async () => {
    api.on('GET', NPCS, { npcs: [npc({ memoryFlags: { metPip: true, sneaky: 'yes' } })] });
    expect((await getNpcState('child-1', 'pirate-pip')).memoryFlags).toEqual({ metPip: true });
  });

  it('sends only the node id; points, flags and level come from the server', async () => {
    api.on('POST', `${NPCS}pirate-pip/dialogue/`, {
      npc: npc({ relationshipPoints: 2, seenNodeIds: ['pip-greeting', 'x'] }),
      levelIncreased: true,
    });
    const result = await recordDialogueNode('child-1', 'pirate-pip', greeting);
    expect(api.calls).toEqual([
      {
        method: 'POST',
        path: `${NPCS}pirate-pip/dialogue/`,
        body: { nodeId: 'pip-greeting' },
      },
    ]);
    expect(result.state.relationshipPoints).toBe(2);
    expect(result.relationshipLevel).toBe('ACQUAINTANCE');
    expect(result.levelIncreased).toBe(true);
  });

  it('a parent clears every NPC memory with one DELETE', async () => {
    api.on('DELETE', NPCS, null);
    await clearNpcState('child-1');
    expect(api.calls).toEqual([{ method: 'DELETE', path: NPCS }]);
  });
});
