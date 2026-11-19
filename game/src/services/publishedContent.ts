/**
 * Published Content port: loads a Django-published Area scene or adventure definition by id
 * and version (ADR-047: Django is authoritative after import; staff edit through versioned
 * revisions). Results are **untrusted JSON**: callers pass them through
 * `checkContentCompatibility` and `validateAdventure` before use.
 */

import { defineService } from '../core/services';

export interface PublishedContentRef {
  id: string;
  /** The published revision. Omitted means the latest published one. */
  version?: number;
}

export interface PublishedContentPort {
  /** A published 3D Area scene, or null when none is published under that id and version. */
  loadArea(ref: PublishedContentRef): Promise<unknown | null>;
  /** A published adventure definition (`contentSource: 'DJANGO_PUBLISHED'`), or null. */
  loadAdventure(ref: PublishedContentRef): Promise<unknown | null>;
}

export const PUBLISHED_CONTENT = defineService<PublishedContentPort>('lai.publishedContent');

export function createFakePublishedContent(content: {
  areas?: Record<string, unknown>;
  adventures?: Record<string, unknown>;
} = {}): PublishedContentPort {
  const lookup = (table: Record<string, unknown> | undefined, ref: PublishedContentRef): unknown | null => {
    const exact = ref.version === undefined ? undefined : table?.[`${ref.id}@${ref.version}`];
    return exact ?? table?.[ref.id] ?? null;
  };
  return {
    loadArea: async (ref) => lookup(content.areas, ref),
    loadAdventure: async (ref) => lookup(content.adventures, ref),
  };
}
