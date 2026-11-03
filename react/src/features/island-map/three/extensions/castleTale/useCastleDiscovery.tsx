import { useEffect, useMemo, useRef, useState } from 'react';
import { castleRoomsApiFor, type CastleRoomsApi } from '../../../../../api/play/castleRoomsApi';

/**
 * Which castle rooms a child has discovered (SC-R03-06): the server's saved
 * list, merged with the rooms this visit has been in.
 *
 * **Django is the record; this only displays and caches it.** The saved list is
 * read once, and each room the child enters is recorded once. Nothing here
 * decides what counts as a discovery: the server accepts the ids it knows and
 * refuses a secret not yet found, and a refusal, or no Django API in this
 * build, or a network failure, all mean the same thing: the room is still
 * marked for the visit, just not saved. None of them is ever shown to a child.
 *
 * `api` is injected so a test can pass a fake; leave it out for the configured
 * Django API, or pass `null` for none.
 */
export interface CastleDiscovery {
  /** Rooms known to be discovered: saved by the server, or entered this visit. */
  discovered: ReadonlySet<string>;
}

export function useCastleDiscovery(options: {
  childId: string;
  /** The room the child is in now, if any. Each new one is recorded once. */
  roomId: string | undefined;
  api?: CastleRoomsApi | null;
}): CastleDiscovery {
  const { childId, roomId } = options;
  const configured = useMemo(
    () => (options.api === undefined ? castleRoomsApiFor(childId) : (options.api ?? undefined)),
    [childId, options.api],
  );
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  // Whether the server's list has been read (or has failed), so a room is not recorded blind.
  const [loaded, setLoaded] = useState(!configured);
  // Read through a ref, so the recording effect does not re-run, and retry, whenever the set changes.
  const savedRef = useRef<ReadonlySet<string>>(saved);
  // Rooms already asked about this visit, so a refusal is not retried until the next arrival.
  const asked = useRef(new Set<string>());

  // The server's list, read once.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    configured
      .list()
      .then((rooms) => {
        if (cancelled) return;
        savedRef.current = new Set(rooms);
        setSaved(savedRef.current);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  // The room the child is in is marked for the visit at once, whatever the server says. Adjusting
  // state while rendering, as React recommends for state that follows a prop, rather than in an effect.
  const [lastRoom, setLastRoom] = useState<string | undefined>(undefined);
  if (roomId && roomId !== lastRoom) {
    setLastRoom(roomId);
    setVisited((previous) => (previous.has(roomId) ? previous : new Set(previous).add(roomId)));
  }

  // ...and recorded once, after the server's list is known.
  useEffect(() => {
    if (!roomId || !configured || !loaded) return;
    if (savedRef.current.has(roomId) || asked.current.has(roomId)) return;
    asked.current.add(roomId);
    let cancelled = false;
    configured
      .record(roomId)
      .then(() => {
        if (cancelled) return;
        savedRef.current = new Set(savedRef.current).add(roomId);
        setSaved(savedRef.current);
      })
      .catch(() => {
        // Not saved. Forget that we asked, so the next arrival here tries again.
        asked.current.delete(roomId);
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, configured, loaded]);

  const discovered = useMemo(() => new Set([...saved, ...visited]), [saved, visited]);
  return { discovered };
}
