import { describe, expect, it } from 'vitest';
import {
  advanceDialogue,
  availableChoices,
  dialogueOutcome,
  findDanglingChoices,
  findDialogueNode,
  selectDialogueNode,
} from './dialogue';
import type { NpcContext, NpcDefinition } from './types';

const npc: NpcDefinition = {
  id: 'pirate-pip',
  displayName: 'Pirate Pip',
  role: 'test',
  homeLocationSlug: 'pirate-builder-bay',
  interactionId: 'meet-pirate-pip',
  schedule: [],
  dialogue: [
    {
      id: 'done',
      conditions: [{ type: 'MEMORY_FLAG', flag: 'bridgeQuestCompleted', equals: true }],
      text: 'Thank you for the bridge!',
      choices: [],
      awardsRelationshipPoints: 3,
    },
    {
      id: 'offer',
      conditions: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'ACQUAINTANCE' }],
      text: 'Will you help with the bridge?',
      choices: [
        { id: 'yes', label: 'Yes!', nextNodeId: 'accepted' },
        {
          id: 'secret',
          label: 'Tell me a secret',
          nextNodeId: 'accepted',
          conditions: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'TRUSTED_FRIEND' }],
        },
      ],
      setsMemoryFlags: ['heardAboutBridge'],
      awardsRelationshipPoints: 2,
    },
    {
      id: 'accepted',
      conditions: [{ type: 'ALWAYS' }],
      followUpOnly: true,
      text: 'Wonderful, let us begin.',
      choices: [],
    },
    {
      id: 'greeting',
      conditions: [{ type: 'ALWAYS' }],
      text: 'Ahoy!',
      choices: [],
      setsMemoryFlags: ['metPip'],
      awardsRelationshipPoints: 1,
    },
  ],
  questOffers: [],
};

function context(overrides: Partial<NpcContext> = {}): NpcContext {
  return {
    npcId: 'pirate-pip',
    timeOfDay: 'MORNING',
    relationshipLevel: 'STRANGER',
    memoryFlags: {},
    worldChangeKeys: [],
    completedQuestIds: [],
    ...overrides,
  };
}

describe('selectDialogueNode', () => {
  it('falls through to the general greeting for a first-time visitor', () => {
    expect(selectDialogueNode(npc, context())?.id).toBe('greeting');
  });

  it('prefers the more specific node when its conditions pass', () => {
    expect(selectDialogueNode(npc, context({ relationshipLevel: 'ACQUAINTANCE' }))?.id).toBe(
      'offer',
    );
  });

  it('picks the first matching node in authored order', () => {
    const ctx = context({
      relationshipLevel: 'FRIEND',
      memoryFlags: { bridgeQuestCompleted: true },
    });
    expect(selectDialogueNode(npc, ctx)?.id).toBe('done');
  });

  it('never opens a conversation on a follow-up node, even when it matches first', () => {
    // `accepted` carries ALWAYS conditions and sits before `greeting`, so
    // first-match-wins would otherwise drop the child mid-conversation.
    expect(selectDialogueNode(npc, context())?.id).not.toBe('accepted');
  });

  it('returns null when no node matches', () => {
    const noMatch: NpcDefinition = {
      ...npc,
      dialogue: [
        {
          id: 'locked',
          conditions: [{ type: 'RELATIONSHIP_AT_LEAST', level: 'TRUSTED_FRIEND' }],
          text: 'Secret',
          choices: [],
        },
      ],
    };
    expect(selectDialogueNode(noMatch, context())).toBeNull();
  });
});

describe('availableChoices', () => {
  it('hides choices the child does not qualify for', () => {
    const node = findDialogueNode(npc, 'offer');
    expect(node).not.toBeNull();
    const shown = availableChoices(node!, context({ relationshipLevel: 'ACQUAINTANCE' }));
    expect(shown.map((choice) => choice.id)).toEqual(['yes']);
  });

  it('shows a gated choice once qualified', () => {
    const node = findDialogueNode(npc, 'offer')!;
    const shown = availableChoices(node, context({ relationshipLevel: 'TRUSTED_FRIEND' }));
    expect(shown.map((choice) => choice.id)).toEqual(['yes', 'secret']);
  });
});

describe('advanceDialogue', () => {
  it('follows a choice to its next node', () => {
    const node = findDialogueNode(npc, 'offer')!;
    const next = advanceDialogue(npc, node.choices[0], context());
    expect(next?.id).toBe('accepted');
  });

  it('ends the conversation when a choice has no next node', () => {
    expect(advanceDialogue(npc, { id: 'bye', label: 'Bye!' }, context())).toBeNull();
  });

  it('ends warmly rather than throwing on a content typo', () => {
    expect(
      advanceDialogue(npc, { id: 'oops', label: 'Oops', nextNodeId: 'missing' }, context()),
    ).toBeNull();
  });
});

describe('dialogueOutcome', () => {
  it('awards points and flags the first time a node is reached', () => {
    const node = findDialogueNode(npc, 'greeting')!;
    expect(dialogueOutcome(node, [])).toEqual({
      memoryFlagsToSet: ['metPip'],
      relationshipPointsAwarded: 1,
    });
  });

  it('does not award points again for a node already seen', () => {
    const node = findDialogueNode(npc, 'greeting')!;
    expect(dialogueOutcome(node, ['greeting'])).toEqual({
      memoryFlagsToSet: ['metPip'],
      relationshipPointsAwarded: 0,
    });
  });

  it('reports no award for a node that grants none', () => {
    const node = findDialogueNode(npc, 'accepted')!;
    expect(dialogueOutcome(node, [])).toEqual({
      memoryFlagsToSet: [],
      relationshipPointsAwarded: 0,
    });
  });
});

describe('findDanglingChoices', () => {
  it('is empty for well-formed content', () => {
    expect(findDanglingChoices(npc)).toEqual([]);
  });

  it('reports a choice pointing at a missing node', () => {
    const broken: NpcDefinition = {
      ...npc,
      dialogue: [
        {
          id: 'start',
          conditions: [{ type: 'ALWAYS' }],
          text: 'Hello',
          choices: [{ id: 'go', label: 'Go', nextNodeId: 'nowhere' }],
        },
      ],
    };
    expect(findDanglingChoices(broken)).toEqual([
      { nodeId: 'start', choiceId: 'go', nextNodeId: 'nowhere' },
    ]);
  });
});
