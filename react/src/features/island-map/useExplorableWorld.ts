import { useCallback, useEffect, useState } from 'react';
import { listAllWorldChanges } from '../adventures/api';
import { getInventory } from '../rewards/api';
import { getWorldState, recordCharacterMet } from '../discovery/api';
import type { WorldInteractionContext } from './worldObjects';

/**
 * Loads everything the four secret-bearing regions need to decide what is
 * currently in their world (docs/ROADMAP.md Phase 26).
 *
 * Extracted rather than copied because Phase 26 turned a one-line fetch into
 * a three-way join, and four world views doing that inline would be four
 * places to get the fail-closed default wrong. The other four locations
 * (Phase 16's Dragon's Sanctuary, Fossil Ridge Camp, Castle Writing Room,
 * and Bolt's Workshop) hide nothing and keep their own single
 * `listAllWorldChanges` effect, so they do not fetch a backpack they never
 * read.
 *
 * `context` is `null` until the first load finishes; a view renders its
 * loading state until then rather than briefly rendering a world with every
 * secret closed.
 *
 * A failed load resolves to an empty context rather than an error state,
 * matching what every world view already did with `listAllWorldChanges`: a
 * child who cannot reach the backend still gets a walkable island with its
 * secrets closed, which is the safe direction.
 */
export interface ExplorableWorldState {
  context: WorldInteractionContext | null;
  /** Re-reads everything. Call after a discovery, so a newly opened door stops being locked. */
  refresh: () => Promise<void>;
  /** Records that the child met a character here. Fire-and-forget; never blocks the UI. */
  noteCharacterMet: (npcId: string) => void;
}

export function useExplorableWorld(childId: string): ExplorableWorldState {
  const [context, setContext] = useState<WorldInteractionContext | null>(null);

  const load = useCallback(async (): Promise<WorldInteractionContext> => {
    try {
      const [changes, inventory, worldState] = await Promise.all([
        listAllWorldChanges(childId),
        getInventory(childId),
        getWorldState(childId),
      ]);
      return {
        worldChangeKeys: changes.map((change) => change.changeKey),
        ownedItemIds: inventory.ownedItemIds,
        discoveryIds: worldState.discoveredIds,
      };
    } catch {
      return { worldChangeKeys: [], ownedItemIds: [], discoveryIds: [] };
    }
  }, [childId]);

  useEffect(() => {
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setContext(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const next = await load();
    setContext(next);
  }, [load]);

  const noteCharacterMet = useCallback(
    (npcId: string) => {
      // Deliberately not awaited and deliberately swallowing failures: this
      // is a record of a nicety, and a child should never be shown an error
      // because saying hello did not save.
      void recordCharacterMet(childId, npcId).catch(() => undefined);
    },
    [childId],
  );

  return { context, refresh, noteCharacterMet };
}
