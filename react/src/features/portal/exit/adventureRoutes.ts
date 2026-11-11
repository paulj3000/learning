/**
 * Where a child goes in the Adventure Portal (AP-04). The one place that
 * spells these URLs for the portal, so a card, the shell and the exit can
 * never disagree about what "back to the hub" means.
 *
 * The hub is the Realm Explorer (AP-03) at `/island/:childId/realms`: every
 * "Leave island" returns there. "Realm" is the child-facing word for an
 * Island (catalog `World`); URLs below `/realms` use it, while API routes and
 * the older `/worlds/` hub keep the Island names until the naming migration.
 * The child's homepage (`island-explorer`, kept for its existing callers) is
 * Home. Pure: no React, no router.
 */

export type PortalDestination =
  | { kind: 'island-explorer' }
  | { kind: 'realm-explorer' }
  | { kind: 'realm'; realmSlug: string }
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
    case 'realm-explorer':
      return `${root}/realms`;
    case 'realm':
      return `${root}/realms/${seg(destination.realmSlug)}`;
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

/** The hub every "Leave island" returns to: the Realm Explorer (AP-03, AP-04). */
export function realmExplorerPath(childId: string): string {
  return portalPath(childId, { kind: 'realm-explorer' });
}

/**
 * True where there is no Realm to leave: Home, the Realm Explorer and a Realm's
 * preview page. These are browsing pages, so "Leave island" is not offered there.
 */
export function isPortalHubPath(pathname: string, childId: string): boolean {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const home = portalPath(childId, { kind: 'island-explorer' });
  const realms = realmExplorerPath(childId);
  return trimmed === home || trimmed === realms || trimmed.startsWith(`${realms}/`);
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
