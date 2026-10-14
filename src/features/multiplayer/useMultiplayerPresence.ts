import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  IDLE_SNAPSHOT,
  type MultiplayerClient,
  type MultiplayerSnapshot,
} from './multiplayerClient';

export interface MultiplayerPresence {
  snapshot: MultiplayerSnapshot;
  /** Joins again after a failure or disconnect. */
  retry(): void;
}

const NO_CLIENT: MultiplayerClient = {
  getSnapshot: () => IDLE_SNAPSHOT,
  subscribe: () => () => undefined,
  join: async () => undefined,
  leave: async () => undefined,
};

/**
 * Joins this region's household room for as long as the component is
 * mounted, and leaves with consent on unmount, so the seat frees at once.
 * Pass `createClient: null` to stay single-player.
 */
export function useMultiplayerPresence(
  regionId: string,
  childId: string,
  createClient: (() => MultiplayerClient) | null,
): MultiplayerPresence {
  const [client, setClient] = useState<MultiplayerClient>(NO_CLIENT);

  useEffect(() => {
    if (!createClient) return undefined;
    const created = createClient();
    setClient(created);
    void created.join(regionId, childId);
    return () => {
      void created.leave();
      setClient(NO_CLIENT);
    };
  }, [createClient, regionId, childId]);

  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const retry = useCallback(() => {
    void client.join(regionId, childId);
  }, [client, regionId, childId]);

  return { snapshot, retry };
}
