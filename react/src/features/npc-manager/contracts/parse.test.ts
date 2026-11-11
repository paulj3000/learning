import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../api/errors';
import { parseCatalog, parseHint, parseInteraction, parseScene } from './parse';
import { assetRefKey } from './types';

const character = {
  npcId: 'pirate-pip',
  displayName: 'Pirate Pip',
  role: 'QUEST_GIVER',
  ageBands: [],
  personality: { traits: ['cheerful'], tone: 'warm' },
  dialogueMode: 'AUTHORED',
  voiceProfile: null,
  defaultVariant: 'classic',
  variants: [
    {
      variantKey: 'classic',
      displayName: 'Classic',
      model: { assetId: 'npc-pip', version: null },
      portrait: null,
      scale: 1,
      rotationOffsetY: 0,
      positionOffsetY: 0,
      animationMap: { idle: 'Idle', talk: 'Talk', unknownState: 'X' },
      extras: [],
    },
  ],
};

const scene = {
  contractVersion: 1,
  release: 3,
  scope: { place: 'pirate-builder-bay', area: 'treasure-rush-cove' },
  characters: { 'pirate-pip': character },
  placements: [
    {
      placementKey: 'cove-pip',
      npcId: 'pirate-pip',
      variant: 'classic',
      behavior: {
        key: 'pip-idle',
        type: 'stationary',
        parameters: { boundsRadius: 15, reactions: {}, facePlayer: true },
      },
      position: { x: 3, y: 0, z: 6 },
      rotationY: 0,
      scale: 1,
      interactionRadius: 2.5,
    },
  ],
};

describe('NPC contract parsers', () => {
  it('reads a scene and keeps only known animation states', () => {
    const parsed = parseScene(scene);
    expect(parsed.placements[0].behavior?.type).toBe('stationary');
    expect(parsed.characters['pirate-pip'].variants[0].animationMap).toEqual({
      idle: 'Idle',
      talk: 'Talk',
    });
  });

  it('rejects a placement whose variant is not in the response', () => {
    const bad = structuredClone(scene);
    bad.placements[0].variant = 'missing';
    expect(() => parseScene(bad)).toThrow(ApiError);
  });

  it('rejects an unsupported contract version', () => {
    expect(() => parseCatalog({ contractVersion: 2, release: 1, characters: [] })).toThrow(
      ApiError,
    );
  });

  it('reads an interaction with a node, choices and speech reference', () => {
    const parsed = parseInteraction({
      contractVersion: 1,
      release: 3,
      npcId: 'pirate-pip',
      conversationId: '6f1c7a52-0000-4000-8000-000000000001',
      dialogueKey: 'greeting',
      node: {
        nodeKey: 'hello',
        text: 'Ahoy!',
        emotion: 'happy',
        animationState: 'wave',
        audio: null,
        speech: {
          kind: 'npcDialogueNode',
          npcId: 'pirate-pip',
          release: 3,
          dialogueKey: 'greeting',
          nodeKey: 'hello',
        },
        allowAiHint: false,
      },
      choices: [{ choiceKey: 'ok', label: 'Okay', action: 'NONE' }],
      ended: false,
      questOffer: null,
    });
    expect(parsed.node?.animationState).toBe('wave');
    expect(parsed.choices).toHaveLength(1);
  });

  it('rejects an unknown choice action', () => {
    expect(() =>
      parseInteraction({
        contractVersion: 1,
        release: 1,
        npcId: 'x',
        conversationId: null,
        dialogueKey: null,
        node: null,
        choices: [{ choiceKey: 'a', label: 'A', action: 'GRANT_TREASURE' }],
        ended: true,
        questOffer: null,
      }),
    ).toThrow(ApiError);
  });

  it('reads a hint', () => {
    const parsed = parseHint({
      contractVersion: 1,
      hint: { text: 'Try counting the shells.', source: 'FALLBACK', speech: null },
    });
    expect(parsed.hint.source).toBe('FALLBACK');
  });

  it('builds resolver keys from frozen references', () => {
    expect(assetRefKey({ assetId: 'npc-pip', version: null })).toBe('npc-pip');
    expect(assetRefKey({ assetId: 'npc-pip', version: 4 })).toBe('npc-pip@4');
  });
});
