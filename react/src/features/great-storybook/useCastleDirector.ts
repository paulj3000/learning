import { useEffect, useMemo, useRef, useState } from 'react';
import {
  castleDirectorApiFor,
  type CastleDirectorApi,
  type CastleDirectorEvent,
} from '../../api/play/castleDirectorApi';
import type { AgeBandValue } from '../child-profile/constants';
import {
  CASTLE_EVENTS,
  defaultEvent,
  linesFor,
  type CastleEvent,
  type CastleEventState,
} from './castleEvents';

/**
 * The castle's ambient line for the room the child is in (SC-R09-01).
 *
 * **Atmosphere only.** The line is authored; the server's Castle Director (a model that may only
 * pick an eligible id, or the deterministic default) chooses which. Showing it grants nothing,
 * records nothing but a display counter, and is never counted down or announced as missed.
 *
 * **The castle never waits for the server.** On any failure, or with no Django API in this
 * build, the same `eligibleEvents` rules run locally and `defaultEvent` is used, so the castle is
 * fully playable without AI. The local answer is a little more cautious than the server's
 * (progress it cannot see is treated as absent) and counts repeats only within this visit.
 *
 * `api` is injected for tests: omit it for the configured API, or pass `null` for none.
 */
export interface CastleAmbientLine {
  eventId: string;
  lines: readonly string[];
  npcId: string | null;
  source: 'AI' | 'FALLBACK' | 'LOCAL';
}

/** The castle's place slug; the client sees world change keys without their place. */
const CASTLE_PLACE = 'storykeeper-castle';

function newVisitId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-000000000000';
}

export function localAmbientLine(
  catalog: readonly CastleEvent[],
  state: CastleEventState,
): CastleAmbientLine | undefined {
  const event = defaultEvent(catalog, state);
  if (!event) return undefined;
  return {
    eventId: event.id,
    lines: linesFor(event, state.ageBand),
    npcId: event.npcId,
    source: 'LOCAL',
  };
}

export function useCastleDirector(options: {
  childId: string;
  ageBand: AgeBandValue | undefined;
  /** The room the child is in now. A new room asks again; the first read of nothing does not. */
  roomId: string | undefined;
  worldChangeKeys: readonly string[];
  api?: CastleDirectorApi | null;
  catalog?: readonly CastleEvent[];
}): CastleAmbientLine | undefined {
  const { childId, ageBand, roomId, worldChangeKeys, catalog = CASTLE_EVENTS } = options;
  const api = useMemo(
    () =>
      options.api === undefined ? (childId ? castleDirectorApiFor(childId) : null) : options.api,
    [childId, options.api],
  );
  const [shown, setShown] = useState<{ roomId: string; line: CastleAmbientLine } | undefined>();
  const visitId = useRef<string>('');
  if (!visitId.current) visitId.current = newVisitId();
  // Repeats counted for this visit only, for the local rules.
  const localCounts = useRef<Record<string, number>>({});
  const keysRef = useRef(worldChangeKeys);
  keysRef.current = worldChangeKeys;

  useEffect(() => {
    if (!roomId || !ageBand) return;
    let cancelled = false;
    const local = (): CastleAmbientLine | undefined => {
      const counts = localCounts.current;
      const line = localAmbientLine(catalog, {
        ageBand,
        roomId,
        conditions: {
          worldChanges: keysRef.current.map((key) => ({ place: CASTLE_PLACE, key })),
          questStatuses: {},
          relationshipLevels: {},
        },
        shownCounts: counts,
        lastShownVisit: Object.fromEntries(Object.keys(counts).map((id) => [id, 1])),
        currentVisitIndex: 1,
      });
      if (line) counts[line.eventId] = (counts[line.eventId] ?? 0) + 1;
      return line;
    };
    const show = (line: CastleAmbientLine | undefined) => {
      if (!cancelled && line) setShown({ roomId, line });
    };
    if (!api) {
      show(local());
      return () => {
        cancelled = true;
      };
    }
    api
      .choose(roomId, visitId.current)
      .then((event: CastleDirectorEvent) =>
        show({
          eventId: event.eventId,
          lines: event.lines,
          npcId: event.npcId,
          source: event.source,
        }),
      )
      .catch(() => show(local()));
    return () => {
      cancelled = true;
    };
  }, [roomId, ageBand, api, catalog]);

  // A line belongs to the room it was chosen for: never show a stale room's line.
  return shown && shown.roomId === roomId ? shown.line : undefined;
}
