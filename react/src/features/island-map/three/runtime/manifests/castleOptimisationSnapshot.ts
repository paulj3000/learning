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
    colliders: manifest.colliders.map((c) => [
      c.rect.id,
      c.rect.minX,
      c.rect.maxX,
      c.rect.minZ,
      c.rect.maxZ,
      c.minY,
      c.maxY,
    ]),
    zones: manifest.zones.map((z) => [
      z.rect.id,
      z.rect.minX,
      z.rect.maxX,
      z.rect.minZ,
      z.rect.maxZ,
    ]),
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

/**
 * Deliberate collider moves since the WS-C baseline was captured, applied to the baseline so the
 * comparison still catches every other change. Each entry is reviewed, never a blanket allowance.
 *
 * - The costume racks stand 0.7 m further south (z -9.2, was -8.5): an owner-QA fix in the shared
 *   movement stack (`e50fd17f`, ADR-060), where the child's 0.35 m body arrived touching rack c at
 *   the Trophy Room door. It reached the castle with the GE-072 engine baseline.
 */
export const BASELINE_COLLIDER_MOVES: Readonly<Record<string, { dz: number }>> = {
  'collider:costume-rack-a': { dz: -0.7 },
  'collider:costume-rack-b': { dz: -0.7 },
  'collider:costume-rack-c': { dz: -0.7 },
};

const round = (value: unknown) =>
  typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value;

/** Snapshot collider rows `[id, minX, maxX, minZ, maxZ, minY, maxY]`, rounded to a micrometre. */
export function roundedColliders(rows: readonly unknown[]): unknown[][] {
  return (rows as unknown[][]).map((row) => row.map(round));
}

/** The baseline's collider rows with the reviewed moves applied, rounded like `roundedColliders`. */
export function baselineCollidersWithMoves(rows: readonly unknown[]): unknown[][] {
  return roundedColliders(
    (rows as unknown[][]).map((row) => {
      const move = BASELINE_COLLIDER_MOVES[row[0] as string];
      if (!move) return row;
      const [id, minX, maxX, minZ, maxZ, minY, maxY] = row as [string, ...number[]];
      return [id, minX, maxX, minZ + move.dz, maxZ + move.dz, minY, maxY];
    }),
  );
}
