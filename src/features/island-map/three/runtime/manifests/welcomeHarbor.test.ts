import { describe, expect, it } from 'vitest';
import { WELCOME_HARBOR_MANIFEST } from './welcomeHarbor';
import { validateLocationManifest } from '../validateLocationManifest';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { WELCOME_HARBOR_CHECKPOINTS } from '../../../../discovery/checkpoints';
import { BUILDINGS, COLLECTIBLE_ID, NPC_ID, NPC_SPOT } from '../../welcomeHarborRegion';
import type { ThreeLocationManifest } from '../locationManifest';

/**
 * The Phase 1 proof that the manifest vocabulary can describe a real region
 * (`docs/engine/09_MIGRATION_PLAN.md` step 5) before any runtime renders it.
 * Parity with what `welcomeHarborScene.ts` builds is checked against the
 * same region constants the scene reads.
 */
describe('WELCOME_HARBOR_MANIFEST', () => {
  it('validates against the source-controlled registries with no issues', () => {
    expect(validateLocationManifest(WELCOME_HARBOR_MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual(
      [],
    );
  });

  it('is plain JSON that reloads unchanged', () => {
    const reloaded = JSON.parse(JSON.stringify(WELCOME_HARBOR_MANIFEST)) as ThreeLocationManifest;
    expect(reloaded).toEqual(WELCOME_HARBOR_MANIFEST);
  });

  it('needs no extensions: an ordinary region is pure manifest data', () => {
    expect(WELCOME_HARBOR_MANIFEST.extensions).toEqual([]);
  });

  it('keeps the saved checkpoint ids children already have in ChildWorldState', () => {
    expect(WELCOME_HARBOR_MANIFEST.checkpoints.ids).toEqual(
      WELCOME_HARBOR_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    );
  });

  it('keeps the semantic entity ids the scene emits today', () => {
    expect(WELCOME_HARBOR_MANIFEST.npcs.map((npc) => npc.entityId)).toEqual([NPC_ID]);
    expect(WELCOME_HARBOR_MANIFEST.npcs[0]?.position).toEqual(NPC_SPOT);
    expect(WELCOME_HARBOR_MANIFEST.collectibles.map((item) => item.entityId)).toEqual([
      COLLECTIBLE_ID,
    ]);
    expect(WELCOME_HARBOR_MANIFEST.buildings.map((building) => building.interiorZone.id)).toEqual(
      BUILDINGS.map((building) => building.interiorZone.id),
    );
  });

  it('routes talking to Pip through the existing NPC conversation action', () => {
    const pip = WELCOME_HARBOR_MANIFEST.npcs[0];
    const interaction = WELCOME_HARBOR_MANIFEST.interactions.find(
      (candidate) => candidate.id === pip?.interactionId,
    );
    expect(interaction?.action).toEqual({ kind: 'TALK_TO', npcId: 'pirate-pip' });
    expect(interaction?.title).toBe('Say hello to Pip');
  });

  it('keeps the building-entry toasts the view shows today', () => {
    expect(WELCOME_HARBOR_MANIFEST.buildings.map((building) => building.enterMessage)).toEqual([
      "You're inside the lookout tower.",
      "You're inside the dockside shed.",
    ]);
  });
});
