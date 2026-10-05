/**
 * The one URL shape for every manifest-driven 3D location
 * (`docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 6, ADR-025 part F).
 *
 * `explore/` rather than the roadmap's suggested `location/`: the 2D
 * location card already owns `locations/:locationSlug`, and the Phaser
 * pages own `world/*`, so a distinct segment keeps the three apart instead
 * of one letter apart.
 */
export const LOCATION_WORLD_ROUTE = '/island/:childId/explore/:regionId';

export function locationWorldPath(childId: string, regionId: string): string {
  return `/island/${encodeURIComponent(childId)}/explore/${encodeURIComponent(regionId)}`;
}
