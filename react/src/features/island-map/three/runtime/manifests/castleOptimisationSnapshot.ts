import type { ThreeLocationManifest } from '../locationManifest';

/**
 * The gameplay-bearing shape of the castle manifest (WS-C): every collider
 * rectangle, zone, interaction id, checkpoint, prop, NPC and platform. The
 * rendering optimisations (static box batching, estimator) must leave this
 * byte-identical, so the test compares it to a fixture captured before they
 * landed. Scenery ids are listed separately because merging is a render
 * concern: the ids stay, and extensions that look a root up still find it.
 */
export function gameplaySnapshot(manifest: ThreeLocationManifest): Record<string, unknown> {
  const platforming = manifest.platforming;
  return {
    colliders: manifest.colliders.map((c) => [c.rect.id, c.rect.minX, c.rect.maxX, c.rect.minZ, c.rect.maxZ, c.minY, c.maxY]),
    zones: manifest.zones.map((z) => [z.rect.id, z.rect.minX, z.rect.maxX, z.rect.minZ, z.rect.maxZ]),
    interactions: manifest.interactions.map((i) => i.id),
    checkpoints: manifest.checkpoints,
    props: manifest.props.map((p) => p.entityId),
    npcs: manifest.npcs.map((n) => n.entityId),
    collectibles: manifest.collectibles.map((c) => c.entityId),
    platforms: platforming?.platforms.map((p) => p.id) ?? [],
    pressurePlates: platforming?.pressurePlates?.map((p) => p.id) ?? [],
    courseCheckpoints: platforming?.checkpoints?.map((p) => p.id) ?? [],
    platformsByBand: Object.fromEntries(
      Object.entries(manifest.platformingByBand ?? {}).map(([band, spec]) => [
        band,
        spec?.platforms.map((p) => p.id) ?? [],
      ]),
    ),
    sceneryIds: manifest.scenery.map((s) => s.id),
  };
}
