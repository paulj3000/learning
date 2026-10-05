import { describe, expect, it } from 'vitest';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import { resolveEnvironment, resolveStatusLine, resolveThingsToDoNotes } from '../sceneLayout';
import {
  SANCTUARY_CHANGE_KEYS,
  dragonScaleChangeKey,
  fireRuneChangeKey,
} from '../../../../dragons-sanctuary/types';
import { DRAGON_SCALE_SPOTS, FIRE_RUNE_SPOTS, SEALED_GATES } from '../../dragonsSanctuaryRegion';
import { DRAGONS_SANCTUARY_MANIFEST as MANIFEST } from './dragonsSanctuary';
import type { ThreeLocationManifest } from '../locationManifest';

const state = (...worldChangeKeys: string[]) => ({
  worldChangeKeys,
  ownedItemIds: [],
  discoveryIds: [],
});
const ALL_RUNES = FIRE_RUNE_SPOTS.map((rune) => fireRuneChangeKey(rune.id));

describe("Dragon's Sanctuary manifest", () => {
  it('is valid against the real content registries', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('survives a JSON round trip unchanged (acceptance A3)', () => {
    const reloaded = JSON.parse(JSON.stringify(MANIFEST)) as ThreeLocationManifest;
    expect(reloaded).toEqual(MANIFEST);
    expect(validateLocationManifest(reloaded, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('warms the valley once the forge is lit', () => {
    expect(resolveEnvironment(MANIFEST).backgroundColor).toBe(0x6a6472);
    expect(
      resolveEnvironment(MANIFEST, state(SANCTUARY_CHANGE_KEYS.FORGE_LIT)).backgroundColor,
    ).toBe(0xe8b98a);
  });

  it('tells the child where the sanctuary stands, in the three authored states', () => {
    expect(resolveStatusLine(MANIFEST)).toBe(
      'The forge is cold and dark. Ember is waiting up at her roost.',
    );
    expect(resolveStatusLine(MANIFEST, state(...ALL_RUNES))).toBe(
      'You have all three fire runes. The hearth is waiting.',
    );
    expect(resolveStatusLine(MANIFEST, state(SANCTUARY_CHANGE_KEYS.FORGE_LIT))).toBe(
      'The forge is burning, and the whole valley is warm again.',
    );
  });

  it('drops each rune hint as that rune is found', () => {
    const none = resolveThingsToDoNotes(MANIFEST);
    expect(none.filter((note) => note.includes('fire rune'))).toHaveLength(3);
    const oneFound = resolveThingsToDoNotes(MANIFEST, state(ALL_RUNES[0]!));
    expect(oneFound.filter((note) => note.includes('fire rune'))).toHaveLength(2);
    expect(oneFound).not.toContain('A fire rune is hidden behind the Keeper Lodge.');
    const allFound = resolveThingsToDoNotes(MANIFEST, state(...ALL_RUNES));
    expect(allFound).toContain(
      'You have found all three fire runes. Take them to the hearth inside the forge.',
    );
    expect(allFound.filter((note) => note.startsWith('A fire rune'))).toEqual([]);
    const lit = resolveThingsToDoNotes(MANIFEST, state(SANCTUARY_CHANGE_KEYS.FORGE_LIT));
    expect(lit).toContain('All three fire runes are set in the hearth.');
    // The scale note is unconditional, in every state.
    for (const notes of [none, oneFound, allFound, lit]) {
      expect(notes).toContain('There are 3 dragon scales hidden around the sanctuary.');
    }
  });

  it('records a found rune and a found scale against their authored keys', () => {
    for (const rune of FIRE_RUNE_SPOTS) {
      const collectible = MANIFEST.collectibles.find((item) => item.entityId === rune.id);
      expect(collectible?.worldChange).toEqual({
        changeType: 'RUNE_FOUND',
        changeKey: fireRuneChangeKey(rune.id),
      });
      // Gone from the valley once found, and once the forge burns.
      expect(collectible?.requirements).toEqual([
        { type: 'WORLD_CHANGE_ABSENT', changeKey: fireRuneChangeKey(rune.id) },
        { type: 'WORLD_CHANGE_ABSENT', changeKey: SANCTUARY_CHANGE_KEYS.FORGE_LIT },
      ]);
    }
    for (const scale of DRAGON_SCALE_SPOTS) {
      const collectible = MANIFEST.collectibles.find((item) => item.entityId === scale.id);
      expect(collectible?.worldChange?.changeKey).toBe(dragonScaleChangeKey(scale.id));
      expect(collectible?.elevation).toBe(scale.y);
    }
  });

  it('gives each sealed gate its authored locked line, never a refusal', () => {
    for (const gate of SEALED_GATES) {
      const interaction = MANIFEST.interactions.find((candidate) => candidate.id === gate.id);
      expect(interaction?.action).toEqual({
        kind: 'SHOW_MESSAGE',
        message: gate.lockedMessage,
      });
      expect(MANIFEST.props.some((prop) => prop.entityId === gate.id)).toBe(true);
      expect(MANIFEST.colliders.some((item) => item.rect.id === `collider:${gate.id}`)).toBe(true);
    }
  });

  it('derives both buildings’ walls from the buildings themselves', () => {
    expect(MANIFEST.buildings.map((building) => building.id)).toEqual(['keeper-lodge', 'forge']);
    expect(MANIFEST.colliders.map((collider) => collider.rect.id)).not.toContain(
      'collider:keeper-lodge:north',
    );
    // The doorway stays a real gap: the lodge opens east, the forge west.
    expect(MANIFEST.buildings[0]!.wallSides).toEqual(['north', 'south', 'west']);
    expect(MANIFEST.buildings[1]!.wallSides).toEqual(['north', 'south', 'east']);
  });

  it('hands every bespoke piece to the sanctuary-art extension', () => {
    const binding = MANIFEST.extensions.find(
      (extension) => extension.extensionId === 'sanctuary-art',
    );
    expect(binding?.config.runeEntityIds).toEqual(FIRE_RUNE_SPOTS.map((rune) => rune.id));
    expect(binding?.config.scaleEntityIds).toEqual(DRAGON_SCALE_SPOTS.map((scale) => scale.id));
    expect(binding?.config.forgeChangeKey).toBe(SANCTUARY_CHANGE_KEYS.FORGE_LIT);
    // Every entity it draws has no art of its own.
    for (const prop of MANIFEST.props) expect(prop.assetId).toBeUndefined();
    for (const collectible of MANIFEST.collectibles) expect(collectible.assetId).toBeUndefined();
  });
});
