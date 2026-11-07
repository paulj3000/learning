/**
 * Where a child goes in the Adventure Portal (AP-04). The one place that
 * spells these URLs for the portal, so a card, the shell and the exit can
 * never disagree about what "back to the hub" means.
 *
 * The hub is the Island Explorer (LAI-0808), which lives on the child's
 * homepage at `/island/:childId`. Pure: no React, no router.
 */

export type PortalDestination =
  | { kind: 'island-explorer' }
  | { kind: 'sailing-dock' }
  | { kind: 'island'; worldSlug: string }
  | { kind: 'place'; locationSlug: string }
  | { kind: 'area'; regionId: string }
  | { kind: 'adventure'; locationSlug: string; templateSlug: string }
  | { kind: 'adventure-log' }
  | { kind: 'quest-journal' }
  | { kind: 'library' };

function seg(value: string): string {
  return encodeURIComponent(value);
}

export function portalPath(childId: string, destination: PortalDestination): string {
  const root = `/island/${seg(childId)}`;
  switch (destination.kind) {
    case 'island-explorer':
      return root;
    case 'sailing-dock':
      return `${root}/travel`;
    case 'island':
      return `${root}/worlds/${seg(destination.worldSlug)}`;
    case 'place':
      return `${root}/locations/${seg(destination.locationSlug)}`;
    case 'area':
      // Same shape as `locationWorldPath` (ADR-032 part F).
      return `${root}/explore/${seg(destination.regionId)}`;
    case 'adventure':
      return `${root}/locations/${seg(destination.locationSlug)}/adventures/${seg(destination.templateSlug)}`;
    case 'adventure-log':
      return `${root}/log`;
    case 'quest-journal':
      return `${root}/quests`;
    case 'library':
      return `${root}/library`;
  }
}

/** The hub every "Leave island" returns to. */
export function islandExplorerPath(childId: string): string {
  return portalPath(childId, { kind: 'island-explorer' });
}

/** True on the Island Explorer itself, where "Leave island" has nowhere to go. */
export function isIslandExplorerPath(pathname: string, childId: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return trimmed === islandExplorerPath(childId);
}

/** Router state set on arrival from "Leave island", so the hub can say so calmly. */
export interface LeftIslandState {
  leftIsland: true;
}

export function isLeftIslandState(state: unknown): state is LeftIslandState {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { leftIsland?: unknown }).leftIsland === true
  );
}
