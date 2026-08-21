import { describe, expect, it, vi, beforeEach } from 'vitest';

const { list, create, update, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      ChildNpcState: { list, create, update, delete: remove },
    },
  },
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

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    childProfileId: 'child-1',
    npcId: 'pirate-pip',
    relationshipPoints: 0,
    relationshipLevel: 'STRANGER',
    memoryFlags: {},
    seenNodeIds: [],
    firstMetAt: '2026-08-01T00:00:00.000Z',
    lastInteractedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ data: [] });
  create.mockResolvedValue({ data: row() });
  update.mockResolvedValue({ data: row() });
  remove.mockResolvedValue({ data: row() });
});

describe('getNpcState', () => {
  it('returns a fresh unmet state when the child has never met this NPC', async () => {
    expect(await getNpcState('child-1', 'pirate-pip')).toEqual(
      initialRelationshipState('pirate-pip'),
    );
  });

  it('reads a stored row and validates its flags', async () => {
    list.mockResolvedValue({
      data: [
        row({
          relationshipPoints: 6,
          memoryFlags: { metPip: true, nickname: 'Sam' },
          seenNodeIds: ['pip-greeting'],
        }),
      ],
    });
    const state = await getNpcState('child-1', 'pirate-pip');
    expect(state.relationshipPoints).toBe(6);
    // The non-boolean value is dropped rather than trusted.
    expect(state.memoryFlags).toEqual({ metPip: true });
    expect(state.seenNodeIds).toEqual(['pip-greeting']);
  });

  it('does not read another child’s row', async () => {
    list.mockResolvedValue({ data: [row({ childProfileId: 'child-2', relationshipPoints: 9 })] });
    const state = await getNpcState('child-1', 'pirate-pip');
    expect(state.relationshipPoints).toBe(0);
  });
});

describe('listNpcStates', () => {
  it('returns only this child’s NPCs', async () => {
    list.mockResolvedValue({
      data: [row(), row({ id: 'row-2', childProfileId: 'child-2', npcId: 'bolt' })],
    });
    const states = await listNpcStates('child-1');
    expect(states.map((state) => state.npcId)).toEqual(['pirate-pip']);
  });
});

describe('recordDialogueNode', () => {
  it('creates a row on the first meeting, awarding points and flags', async () => {
    const result = await recordDialogueNode('child-1', 'pirate-pip', greeting);

    expect(create).toHaveBeenCalledTimes(1);
    const written = create.mock.calls[0][0];
    expect(written.childProfileId).toBe('child-1');
    expect(written.npcId).toBe('pirate-pip');
    expect(written.relationshipPoints).toBe(1);
    expect(written.memoryFlags).toEqual({ metPip: true });
    expect(written.seenNodeIds).toEqual(['pip-greeting']);
    expect(written.firstMetAt).toBe(written.lastInteractedAt);

    expect(result.relationshipLevel).toBe('STRANGER');
    expect(result.levelIncreased).toBe(false);
  });

  it('updates an existing row rather than creating a second one', async () => {
    list.mockResolvedValue({
      data: [row({ relationshipPoints: 1, memoryFlags: { metPip: true } })],
    });
    await recordDialogueNode('child-1', 'pirate-pip', greeting);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].id).toBe('row-1');
  });

  it('does not award points again for a node already seen', async () => {
    list.mockResolvedValue({
      data: [row({ relationshipPoints: 4, seenNodeIds: ['pip-greeting'] })],
    });
    await recordDialogueNode('child-1', 'pirate-pip', greeting);

    const written = update.mock.calls[0][0];
    expect(written.relationshipPoints).toBe(4);
    expect(written.seenNodeIds).toEqual(['pip-greeting']);
  });

  it('reports a level increase when the award crosses a threshold', async () => {
    list.mockResolvedValue({ data: [row({ relationshipPoints: 1 })] });
    const result = await recordDialogueNode('child-1', 'pirate-pip', greeting);

    expect(result.state.relationshipPoints).toBe(2);
    expect(result.relationshipLevel).toBe('ACQUAINTANCE');
    expect(result.levelIncreased).toBe(true);
    expect(update.mock.calls[0][0].relationshipLevel).toBe('ACQUAINTANCE');
  });

  it('never lowers a stored relationship level', async () => {
    list.mockResolvedValue({
      data: [row({ relationshipPoints: 12, seenNodeIds: ['pip-greeting'] })],
    });
    const result = await recordDialogueNode('child-1', 'pirate-pip', greeting);
    expect(result.relationshipLevel).toBe('TRUSTED_FRIEND');
    expect(result.levelIncreased).toBe(false);
  });

  it('merges new flags into stored ones', async () => {
    list.mockResolvedValue({ data: [row({ memoryFlags: { heardAboutBridge: true } })] });
    await recordDialogueNode('child-1', 'pirate-pip', greeting);
    expect(update.mock.calls[0][0].memoryFlags).toEqual({
      heardAboutBridge: true,
      metPip: true,
    });
  });
});

describe('clearNpcState', () => {
  it('deletes only this child’s rows', async () => {
    list.mockResolvedValue({
      data: [
        row(),
        row({ id: 'row-2', npcId: 'bolt' }),
        row({ id: 'row-3', childProfileId: 'child-2' }),
      ],
    });
    await clearNpcState('child-1');
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls.map((call) => call[0].id).sort()).toEqual(['row-1', 'row-2']);
  });
});
