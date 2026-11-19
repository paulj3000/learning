import { useEffect, useMemo, useRef, useState } from 'react';
import {
  castleDirectorApiFor,
  type CastleDirectorApi,
  type CastleDirectorEvent,
} from '../../api/play/castleDirectorApi';
import type { AgeBandValue } from '../child-profile/constants';
import { castleDefaultLine } from './castleDefaultLines';

/**
 * The castle's ambient line for the room the child is in (SC-R09-01).
 *
 * **Atmosphere only.** The line is authored; the server's Castle Director (a model that may only
 * pick an eligible id, or the deterministic default) chooses which. Showing it grants nothing,
 * records nothing but a display counter, and is never counted down or announced as missed.
 *
 * **The castle never waits for the server.** On any failure, or with no Django API in this
 * build, the room's one quiet default line is shown (`castleDefaultLines.ts`), so the castle is
 * fully playable without AI. The client keeps no event catalog and no eligibility rules: Django
 * owns the approved events and decides which are eligible (ADR-065).
 *
 * `api` is injected for tests: omit it for the configured API, or pass `null` for none.
 */
export interface CastleAmbientLine {
  eventId: string;
  lines: readonly string[];
  npcId: string | null;
  source: 'AI' | 'FALLBACK' | 'LOCAL';
}

/** The one character whose ambient lines the server may re-voice (ADR-065 decision 5). */
const FLAVOUR_NPC_ID = 'keeper-quill';

function newVisitId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-000000000000';
}

/** The quiet default for a room, shown when the server cannot answer. */
export function localAmbientLine(
  roomId: string,
  ageBand: AgeBandValue,
): CastleAmbientLine | undefined {
  const line = castleDefaultLine(roomId, ageBand);
  if (!line) return undefined;
  return { eventId: `quiet-${roomId}`, lines: [line], npcId: null, source: 'LOCAL' };
}

export function useCastleDirector(options: {
  childId: string;
  ageBand: AgeBandValue | undefined;
  /** The room the child is in now. A new room asks again; the first read of nothing does not. */
  roomId: string | undefined;
  api?: CastleDirectorApi | null;
}): CastleAmbientLine | undefined {
  const { childId, ageBand, roomId } = options;
  const api = useMemo(
    () =>
      options.api === undefined ? (childId ? castleDirectorApiFor(childId) : null) : options.api,
    [childId, options.api],
  );
  const [shown, setShown] = useState<{ roomId: string; line: CastleAmbientLine } | undefined>();
  const visitId = useRef<string>('');
  if (!visitId.current) visitId.current = newVisitId();

  useEffect(() => {
    if (!roomId || !ageBand) return;
    let cancelled = false;
    const local = () => localAmbientLine(roomId, ageBand);
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
      .then((event: CastleDirectorEvent) => {
        // The authored lines are on screen at once; Quill's flavour, if the server approves one,
        // replaces them when it arrives. A failure of any kind leaves the authored lines.
        const authored: CastleAmbientLine = {
          eventId: event.eventId,
          lines: event.lines,
          npcId: event.npcId,
          source: event.source,
        };
        show(authored);
        if (event.npcId === FLAVOUR_NPC_ID && api.flavour) {
          api
            .flavour(event.eventId)
            .then((flavour) => {
              // Only a server-validated AI line replaces the authored copy; FALLBACK is the
              // authored first line, which is already (fully) on screen.
              if (flavour.source === 'AI' && flavour.eventId === event.eventId && flavour.line) {
                show({ ...authored, lines: [flavour.line], source: 'AI' });
              }
            })
            .catch(() => undefined);
        }
      })
      .catch(() => show(local()));
    return () => {
      cancelled = true;
    };
  }, [roomId, ageBand, api]);

  // A line belongs to the room it was chosen for: never show a stale room's line.
  return shown && shown.roomId === roomId ? shown.line : undefined;
}
