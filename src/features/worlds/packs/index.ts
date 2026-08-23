/**
 * Content pack loading (docs/ROADMAP.md Phase 29, "content packaging and
 * lazy loading").
 *
 * A pack is fetched through a dynamic `import()` rather than a top-level
 * one, so no screen pays for a world it is not showing and adding the tenth
 * world does not grow the ninth world's bundle. The loader is cached per
 * world, because a pack is immutable authored content: loading it twice
 * would parse the same constant twice for no benefit.
 *
 * What this does *not* lazily load, stated plainly because the difference
 * matters: the authored content itself. `ADVENTURE_TEMPLATES`,
 * `ALL_ITEMS`, `QUEST_DEFINITIONS`, and their neighbours are still
 * statically imported registries, because engines read them synchronously
 * (`getQuestDefinition`, `resolveAdventureForAgeBand`, `grantRewards`) and
 * making those async would be a rewrite of every engine rather than a
 * packaging change. The bytes that actually dominate a world - its tilemaps,
 * decor, and Phaser scene - are already code-split per route in
 * `AppRoutes.tsx`, which is where the payoff is. See the Phase 29 known
 * limitations in docs/IMPLEMENTATION_STATUS.md.
 */
import { CREATURE_CARE_COVE_SLUG, HOME_WORLD_SLUG } from '../slugs';
import type { WorldContentPack } from '../types';

type PackLoader = () => Promise<WorldContentPack>;

export const WORLD_PACK_LOADERS: Readonly<Record<string, PackLoader>> = {
  [HOME_WORLD_SLUG]: () => import('./homeIsland').then((module) => module.HOME_ISLAND_PACK),
  [CREATURE_CARE_COVE_SLUG]: () =>
    import('./creatureCareCove').then((module) => module.CREATURE_CARE_COVE_PACK),
};

const cache = new Map<string, Promise<WorldContentPack>>();

/**
 * The content pack for one world, loaded once per session.
 *
 * Rejects for an unknown slug rather than resolving to an empty pack: an
 * empty pack would render as a world with nothing in it, which looks like
 * broken content rather than a typo in a route parameter.
 */
export function loadWorldContentPack(worldSlug: string): Promise<WorldContentPack> {
  const cached = cache.get(worldSlug);
  if (cached) return cached;

  const loader = WORLD_PACK_LOADERS[worldSlug];
  if (!loader) {
    return Promise.reject(new Error(`No content pack is registered for world "${worldSlug}".`));
  }

  const pending = loader().catch((error: unknown) => {
    // A failed load must not poison the cache: a dropped network on the
    // first attempt would otherwise make the world permanently unloadable
    // for the rest of the session.
    cache.delete(worldSlug);
    throw error;
  });
  cache.set(worldSlug, pending);
  return pending;
}

/** Every world's pack, for validation and for adult-facing content tooling. */
export async function loadAllWorldContentPacks(): Promise<WorldContentPack[]> {
  return Promise.all(Object.keys(WORLD_PACK_LOADERS).map((slug) => loadWorldContentPack(slug)));
}

/** Test seam: forgets what has been loaded so a test can observe a cold load. */
export function resetWorldContentPackCache(): void {
  cache.clear();
}
