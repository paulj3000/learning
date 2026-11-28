import { describe, expect, it } from 'vitest';
import { WELCOME_HARBOR_INTERACTIONS, type WorldInteractionContext } from '../../../worldObjects';
import { walkInInteractionForZone } from '../manifestBindings';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import { WELCOME_HARBOR_MANIFEST } from './welcomeHarbor';

/**
 * LAI-2201: the 3D harbor as the island's hub. Every Phaser harbor interaction is in the manifest
 * with the same action and requirements, the bridge zone answers to the child's world changes, and
 * everything a child needs stands somewhere they can walk to.
 */

const FRESH: WorldInteractionContext = { worldChangeKeys: [] };
const REPAIRED: WorldInteractionContext = { worldChangeKeys: ['BRIDGE_REPAIRED'] };

const byId = (id: string) => WELCOME_HARBOR_MANIFEST.interactions.find((i) => i.id === id);

describe('Welcome Harbor hub (LAI-2201)', () => {
  it('validates against the source registries', () => {
    expect(validateLocationManifest(WELCOME_HARBOR_MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual(
      [],
    );
  });

  it('carries all twelve Phaser interactions unchanged, and keeps Pip', () => {
    expect(WELCOME_HARBOR_INTERACTIONS).toHaveLength(12);
    for (const phaser of WELCOME_HARBOR_INTERACTIONS) {
      const three = byId(phaser.id);
      expect(three, phaser.id).toBeDefined();
      expect(JSON.stringify(three?.action)).toBe(JSON.stringify(phaser.action));
      expect(JSON.stringify(three?.requirements ?? [])).toBe(
        JSON.stringify(phaser.requirements ?? []),
      );
    }
    expect(WELCOME_HARBOR_MANIFEST.npcs.map((npc) => npc.entityId)).toEqual(['pirate-pip']);
  });

  it('gives every tap interaction a prop and every walk-in interaction a zone', () => {
    const propInteractions = new Set(WELCOME_HARBOR_MANIFEST.props.map((p) => p.interactionId));
    const zoneIds = new Set(WELCOME_HARBOR_MANIFEST.zones.map((z) => z.rect.id));
    for (const interaction of WELCOME_HARBOR_INTERACTIONS) {
      if (interaction.trigger === 'TAP') {
        expect(propInteractions.has(interaction.id), interaction.id).toBe(true);
      } else {
        expect(zoneIds.has(interaction.zoneId ?? interaction.id), interaction.id).toBe(true);
      }
    }
  });

  it('starts the bridge adventure while it is broken, and offers the crossing once it is repaired', () => {
    expect(walkInInteractionForZone(WELCOME_HARBOR_MANIFEST, 'broken-bridge', FRESH)?.id).toBe(
      'broken-bridge',
    );
    expect(walkInInteractionForZone(WELCOME_HARBOR_MANIFEST, 'broken-bridge', REPAIRED)?.id).toBe(
      'moonlight-bridge-crossing',
    );
  });

  it('keeps the story-gated paths shut until their story is complete', () => {
    const gates: Record<string, string> = {
      'mountain-path': 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE',
      'fossil-ridge-path': 'DINOSAUR_EXPEDITION_COMPLETE',
      'bolts-workshop-path': 'ROBOT_RESCUE_COMPLETE',
    };
    for (const [zone, key] of Object.entries(gates)) {
      expect(walkInInteractionForZone(WELCOME_HARBOR_MANIFEST, zone, FRESH), zone).toBeUndefined();
      expect(
        walkInInteractionForZone(WELCOME_HARBOR_MANIFEST, zone, { worldChangeKeys: [key] })?.id,
        zone,
      ).toBe(zone);
    }
    for (const open of ['forest-entrance', 'castle-entrance']) {
      expect(walkInInteractionForZone(WELCOME_HARBOR_MANIFEST, open, FRESH)?.id).toBe(open);
    }
  });

  it('names BRIDGE_REPAIRED on the scenery and on the gap collider', () => {
    const broken = WELCOME_HARBOR_MANIFEST.scenery.filter((s) =>
      JSON.stringify(s.requirements ?? []).includes('WORLD_CHANGE_ABSENT'),
    );
    const mended = WELCOME_HARBOR_MANIFEST.scenery.filter((s) =>
      JSON.stringify(s.requirements ?? []).includes('WORLD_CHANGE_PRESENT'),
    );
    expect(broken.map((s) => s.id)).toEqual(['harbor-bridge-stubs', 'harbor-bridge-fallen-plank']);
    expect(mended.map((s) => s.id)).toEqual(['harbor-bridge-deck']);
    const gap = WELCOME_HARBOR_MANIFEST.colliders.find((c) => c.rect.id === 'harbor-bridge-gap');
    expect(gap?.requirements).toEqual([
      { type: 'WORLD_CHANGE_ABSENT', changeKey: 'BRIDGE_REPAIRED' },
    ]);
    expect(gap?.jumpable).toBeUndefined();
  });

  it('puts the two discoveries on a prop and a hidden zone', () => {
    expect(
      WELCOME_HARBOR_MANIFEST.props.find((p) => p.interactionId === 'harbor-door'),
    ).toBeDefined();
    expect(WELCOME_HARBOR_MANIFEST.hiddenInteractionIds).toEqual(['harbor-tide-pool']);
    expect(byId('harbor-door')?.action).toEqual({
      kind: 'DISCOVER',
      discoveryId: 'harbor-keepers-door',
    });
    expect(byId('harbor-tide-pool')?.action).toEqual({
      kind: 'DISCOVER',
      discoveryId: 'harbor-tide-pool',
    });
  });

  it('keeps every required target on open ground, outside every solid collider', () => {
    const solid = WELCOME_HARBOR_MANIFEST.colliders;
    const open = (x: number, z: number, context: WorldInteractionContext) =>
      !solid.some(
        (c) =>
          (c.requirements
            ? c.requirements.every((r) =>
                r.type === 'WORLD_CHANGE_ABSENT'
                  ? !context.worldChangeKeys.includes(r.changeKey)
                  : true,
              )
            : true) &&
          x >= c.rect.minX &&
          x <= c.rect.maxX &&
          z >= c.rect.minZ &&
          z <= c.rect.maxZ,
      );
    const targets: [string, number, number][] = [
      ...WELCOME_HARBOR_MANIFEST.props.map((p): [string, number, number] => [
        p.entityId,
        p.position.x,
        p.position.z,
      ]),
      ...WELCOME_HARBOR_MANIFEST.zones.map((z): [string, number, number] => [
        z.rect.id,
        (z.rect.minX + z.rect.maxX) / 2,
        (z.rect.minZ + z.rect.maxZ) / 2,
      ]),
    ];
    for (const [id, x, z] of targets) expect(open(x, z, FRESH), id).toBe(true);
    // The spawn, the dock, and Pip.
    expect(open(0, 8, FRESH)).toBe(true);
    expect(open(1.5, -1, FRESH)).toBe(true);
    // The bridge span is only open once repaired.
    expect(open(11, 0, FRESH)).toBe(false);
    expect(open(11, 0, REPAIRED)).toBe(true);
  });
});
