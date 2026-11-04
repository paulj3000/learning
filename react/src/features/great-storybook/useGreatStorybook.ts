import { useEffect, useMemo, useRef, useState } from 'react';
import { storybookApiFor, type StorybookApi } from '../../api/play/storybookApi';
import type { AgeBandValue } from '../child-profile/constants';
import {
  newlyRestored,
  restoredIds,
  storybookProgress,
  visibleEntries,
  withRestored,
  type StorybookEntry,
  type StorybookPage,
  type StorybookProgress,
} from './pages';

/**
 * The Great Storybook as a child sees it (SC-R04-02): the book derived from the records
 * the castle already holds, merged with the server's own derivation, plus the moment a page
 * comes back.
 *
 * **Nothing here restores, grants or records anything.** A page is back exactly when its
 * record exists, so this only reads and displays. `onPageRestored` reports a page that came
 * back *during this visit*: it never fires on first load (a child who finished the Tale last
 * month is not told it just happened) and never because the server's answer arrived late,
 * because it watches the child's own state and not the server's.
 *
 * The server's copy is read once and again when the child's own set of restored pages changes.
 * A failure, or no Django API in this build, simply leaves the book as the records alone say.
 * `api` is injected for tests: omit it for the configured API, or pass `null` for none.
 */
export interface GreatStorybook {
  /** The whole book for this band, with the server's pages counted too. */
  progress: StorybookProgress;
  /** What to show: required pages, and the hidden bonus page only once found. */
  entries: readonly StorybookEntry[];
}

export function useGreatStorybook(options: {
  childId: string;
  band: AgeBandValue;
  worldChangeKeys: readonly string[];
  discoveryIds: readonly string[];
  api?: StorybookApi | null;
  onPageRestored?: (page: StorybookPage) => void;
  onBookRestored?: () => void;
}): GreatStorybook {
  const { childId, band, worldChangeKeys, discoveryIds, onPageRestored, onBookRestored } = options;
  const server = useMemo(
    () => (options.api === undefined ? storybookApiFor(childId) : (options.api ?? undefined)),
    [childId, options.api],
  );
  const local = useMemo(
    () => storybookProgress({ worldChangeKeys, discoveryIds }, band),
    [worldChangeKeys, discoveryIds, band],
  );
  const localKey = [...restoredIds(local)].sort().join(',');
  const [serverRestored, setServerRestored] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    server
      .get()
      .then((book) => {
        if (cancelled) return;
        setServerRestored(
          new Set(book.pages.filter((page) => page.restored).map((page) => page.id)),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [server, localKey]);

  const progress = useMemo(() => withRestored(local, serverRestored), [local, serverRestored]);

  // The moment a page comes back: only from the child's own state, and never on first load.
  const seen = useRef<ReadonlySet<string> | null>(null);
  const wasComplete = useRef<boolean | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = restoredIds(local);
      wasComplete.current = local.complete;
      return;
    }
    for (const page of newlyRestored(seen.current, local)) onPageRestored?.(page);
    if (local.complete && wasComplete.current === false) onBookRestored?.();
    seen.current = restoredIds(local);
    wasComplete.current = local.complete;
  }, [local, onPageRestored, onBookRestored]);

  const entries = useMemo(() => visibleEntries(progress), [progress]);
  return { progress, entries };
}
