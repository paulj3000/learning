import { useEffect, useState } from 'react';
import type { EngineRuntime } from '@lai/game-engine/core';
import { isGameplayEventType, validateGameplayEvent } from '@lai/game-engine/contracts';

/**
 * DEV ONLY (imported by the Playground only). The event log never holds child data: gameplay
 * and engine contracts carry semantic ids only, and this log records the event type plus the
 * semantic id fields, never a whole payload.
 */

export interface EventLogEntry {
  seq: number;
  kind: 'gameplay' | 'engine';
  /** Event type or name. An unrecognised gameplay claim shows as `invalid claim`. */
  type: string;
  ids: string[];
  /** A gameplay claim that failed validation (the host drops it). */
  dropped: boolean;
}

const MAX_ID_LENGTH = 128;

/** Semantic id values of a payload: string fields named `*Id`, and a `learningRef`'s ids. */
export function semanticIdsOf(payload: unknown): string[] {
  const ids: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (typeof value !== 'object' || value === null || depth > 2) {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string' && /Id$/.test(key)) {
        ids.push(entry.slice(0, MAX_ID_LENGTH));
      } else if (key === 'learningRef') {
        visit(entry, depth + 1);
      }
    }
  };
  visit(payload, 0);
  return ids;
}

export function describeEvent(name: string, payload: unknown, seq: number): EventLogEntry {
  if (name === 'gameplay.event') {
    const result = validateGameplayEvent(payload);
    if (!result.ok) {
      return { seq, kind: 'gameplay', type: 'invalid claim', ids: [], dropped: true };
    }
    const event = result.value;
    const type = isGameplayEventType(event.type) ? event.type : 'invalid claim';
    return { seq, kind: 'gameplay', type, ids: semanticIdsOf(event.payload), dropped: false };
  }
  return { seq, kind: 'engine', type: name, ids: semanticIdsOf(payload), dropped: false };
}

/** The last `limit` events on the runtime bus, newest last. */
export function useEventLog(
  runtime: EngineRuntime | null,
  limit = 20,
): { entries: readonly EventLogEntry[]; clear(): void } {
  const [entries, setEntries] = useState<readonly EventLogEntry[]>([]);

  useEffect(() => {
    setEntries([]);
    if (!runtime) {
      return undefined;
    }
    let seq = 0;
    return runtime.events.onAny(((name: string, payload: unknown) => {
      seq += 1;
      const entry = describeEvent(name, payload, seq);
      setEntries((current) => [...current, entry].slice(-limit));
    }) as never) as () => void;
  }, [runtime, limit]);

  return { entries, clear: () => setEntries([]) };
}
