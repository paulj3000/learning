import { describe, expect, it } from 'vitest';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import { resolveEnvironment, resolveStatusLine } from '../sceneLayout';
import { CLOCKWORK_CHANGE_KEYS, goldenGearChangeKey } from '../../../../clockwork-harbor/types';
import { DARK_LIGHTHOUSE_ADVENTURES } from '../../../../adventures/content';
import { GOLDEN_GEAR_SPOTS, NPC_SPOTS } from '../../clockworkHarborRegion';
import { CLOCKWORK_HARBOR_MANIFEST as MANIFEST } from './clockworkHarbor';
import type { ThreeLocationManifest } from '../locationManifest';

const FIXED = {
  worldChangeKeys: [CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED],
  ownedItemIds: [],
  discoveryIds: [],
};

describe('Clockwork Harbor manifest', () => {
  it('is valid against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('survives a JSON round trip unchanged (acceptance A3)', () => {
    const reloaded = JSON.parse(JSON.stringify(MANIFEST)) as ThreeLocationManifest;
    expect(reloaded).toEqual(MANIFEST);
    expect(validateLocationManifest(reloaded, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('lifts the sky and the light once the lighthouse turns again', () => {
    expect(resolveEnvironment(MANIFEST)).toEqual({
      backgroundColor: 0x6b7f92,
      lighting: { ambientIntensity: 0.45, sunIntensity: 0.55 },
    });
    expect(resolveEnvironment(MANIFEST, FIXED)).toEqual({
      backgroundColor: 0x8fc7e6,
      lighting: { ambientIntensity: 0.65, sunIntensity: 0.8 },
    });
  });

  it('tells the child what state the harbor is in, in one line', () => {
    expect(resolveStatusLine(MANIFEST)).toBe(
      'The lighthouse is dark. The Harbor Master is waiting on the dock.',
    );
    expect(resolveStatusLine(MANIFEST, FIXED)).toBe(
      'The lighthouse is turning again, and the harbor gate is open.',
    );
  });

  it('shuts the harbor gate, and its collider, only while the lighthouse is dark', () => {
    const gate = MANIFEST.scenery.find((item) => item.id === 'harbor-gate');
    const collider = MANIFEST.colliders.find((item) => item.rect.id === 'collider:harbor-gate');
    const absent = [
      { type: 'WORLD_CHANGE_ABSENT', changeKey: CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED },
    ];
    expect(gate?.requirements).toEqual(absent);
    expect(collider?.requirements).toEqual(absent);
  });

  it('records every golden gear against its authored change key, and gates it on the same key', () => {
    // The audit's live bug: the per-region view only toasted, so a gear a
    // child had already found was built again on the next visit.
    expect(MANIFEST.collectibles).toHaveLength(GOLDEN_GEAR_SPOTS.length);
    for (const spot of GOLDEN_GEAR_SPOTS) {
      const gear = MANIFEST.collectibles.find((item) => item.entityId === spot.id);
      expect(gear?.worldChange?.changeKey).toBe(goldenGearChangeKey(spot.id));
      expect(gear?.requirements).toEqual([
        { type: 'WORLD_CHANGE_ABSENT', changeKey: goldenGearChangeKey(spot.id) },
      ]);
      expect(gear?.elevation).toBe(spot.y);
      // No `assetId`: `clockwork-machinery` draws the brass ring.
      expect(gear?.assetId).toBeUndefined();
    }
  });

  it('places both NPCs with their own imported character and a talk interaction', () => {
    expect(MANIFEST.npcs).toHaveLength(NPC_SPOTS.length);
    for (const npc of MANIFEST.npcs) {
      const spot = NPC_SPOTS.find((candidate) => candidate.id === npc.entityId);
      expect(npc.assetId).toBe(spot?.assetId);
      const interaction = MANIFEST.interactions.find(
        (candidate) => candidate.id === npc.interactionId,
      );
      expect(interaction?.action).toEqual({ kind: 'TALK_TO', npcId: npc.entityId });
    }
  });

  it('hands the machine to the adaptive entrance, with every authored variant', () => {
    const binding = MANIFEST.extensions.find(
      (extension) => extension.extensionId === 'adaptive-adventure-entrance',
    );
    expect(binding?.config.variantSlugs).toEqual(
      DARK_LIGHTHOUSE_ADVENTURES.map((variant) => variant.slug),
    );
    expect(binding?.config.domain).toBe('math');
    // ...and the machine is a prop with no art of its own.
    const machine = MANIFEST.props[0];
    expect(machine?.assetId).toBeUndefined();
    expect(machine?.interactionId).toBe(binding?.config.interactionId);
  });

  it('names every district the child walks into', () => {
    expect(MANIFEST.zones.map((zone) => zone.enterMessage)).toEqual([
      "You're at the harbor gate.",
      "You're at the docks.",
      "You're at the lighthouse.",
      "You're at the marketplace.",
    ]);
  });
});
