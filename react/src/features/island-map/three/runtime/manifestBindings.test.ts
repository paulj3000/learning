import { describe, expect, it } from 'vitest';
import {
  availableInteractions,
  focusLabel,
  interactionForEntity,
  walkInInteractionForZone,
  zoneEnterMessage,
} from './manifestBindings';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import type { ThreeLocationManifest } from './locationManifest';

const EMPTY = { worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] };

const WITH_GATED_ZONE: ThreeLocationManifest = {
  ...WELCOME_HARBOR_MANIFEST,
  zones: [
    { rect: { id: 'pier', minX: -1, maxX: 1, minZ: 9, maxZ: 11 }, enterMessage: 'On the pier.' },
  ],
  interactions: [
    ...WELCOME_HARBOR_MANIFEST.interactions,
    {
      id: 'pier-boat',
      type: 'LOCATION',
      trigger: 'APPROACH',
      title: 'Sail away',
      targetId: 'boat',
      zoneId: 'pier',
      requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'BRIDGE_REPAIRED' }],
      action: { kind: 'NAVIGATE', to: 'worlds' },
    },
  ],
};

describe('manifestBindings', () => {
  it('labels focused NPCs, and nothing else', () => {
    expect(focusLabel(WELCOME_HARBOR_MANIFEST, 'pirate-pip')).toBe('Pip');
    expect(focusLabel(WELCOME_HARBOR_MANIFEST, 'harbor-collectible-gem')).toBeNull();
    expect(focusLabel(WELCOME_HARBOR_MANIFEST, null)).toBeNull();
  });

  it('resolves an interacted NPC to its bound interaction', () => {
    expect(interactionForEntity(WELCOME_HARBOR_MANIFEST, 'pirate-pip', EMPTY)?.id).toBe(
      'harbor-say-hello-to-pip',
    );
    expect(
      interactionForEntity(WELCOME_HARBOR_MANIFEST, 'harbor-collectible-gem', EMPTY),
    ).toBeUndefined();
  });

  it('opens a walk-in interaction only once its requirements are met', () => {
    expect(walkInInteractionForZone(WITH_GATED_ZONE, 'pier', EMPTY)).toBeUndefined();
    expect(
      walkInInteractionForZone(WITH_GATED_ZONE, 'pier', {
        ...EMPTY,
        worldChangeKeys: ['BRIDGE_REPAIRED'],
      })?.id,
    ).toBe('pier-boat');
  });

  it('finds the authored toast for a building or zone', () => {
    expect(zoneEnterMessage(WITH_GATED_ZONE, 'lookout-tower:interior')).toBe(
      "You're inside the lookout tower.",
    );
    expect(zoneEnterMessage(WITH_GATED_ZONE, 'pier')).toBe('On the pier.');
    expect(zoneEnterMessage(WITH_GATED_ZONE, 'welcome-harbor:dock')).toBeUndefined();
  });

  it('lists only interactions available right now', () => {
    expect(
      availableInteractions(WITH_GATED_ZONE, EMPTY).map((interaction) => interaction.id),
    ).toEqual(['harbor-say-hello-to-pip']);
  });
});
