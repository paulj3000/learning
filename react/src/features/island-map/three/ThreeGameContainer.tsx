import { useEffect, useRef } from 'react';
import styles from './ThreeGameContainer.module.css';

/** Anything a Three.js engine handle needs to expose for cleanup. */
export interface ThreeEngineHandle {
  dispose(): void;
}

export interface ThreeGameContainerProps<TEngine extends ThreeEngineHandle> {
  /**
   * Builds the engine for this mount. Read once, on mount, and never again
   * for the lifetime of a given `instanceKey` — the boundary deliberately
   * does not recreate the engine on unrelated React re-renders, matching
   * `PhaserGameContainer`'s contract (docs/ROADMAP.md Phase 9). Pass a new
   * `instanceKey` to intentionally tear down and rebuild.
   */
  createEngine: (parent: HTMLDivElement) => TEngine;
  instanceKey?: string | number;
  className?: string;
  /**
   * Fired once, right after `createEngine`, so a parent page can keep a
   * reference for imperative calls (e.g. an on-screen "interact" button
   * for touch users) without this container itself knowing anything
   * `three`-specific about `TEngine`.
   */
  onEngineReady?: (engine: TEngine) => void;
}

/**
 * Owns a Three.js engine's lifecycle so nothing else in the app has to.
 * The `docs/ROADMAP.md` Phase 31 sibling of `PhaserGameContainer.tsx`, kept
 * renderer-agnostic (generic over `{ dispose(): void }`) rather than typed
 * to `three` directly, so this component never needs to import `three` and
 * its own test needs no mock for it.
 *
 * The canvas Three.js renders into is not meaningfully representable to
 * assistive technology, so it is `aria-hidden`; every view built on top of
 * this must offer a non-graphical alternate
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 42,
 * "must not make graphical movement the only way to use the application").
 */
export function ThreeGameContainer<TEngine extends ThreeEngineHandle>({
  createEngine,
  instanceKey,
  className,
  onEngineReady,
}: ThreeGameContainerProps<TEngine>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const createEngineRef = useRef(createEngine);
  createEngineRef.current = createEngine;
  const onEngineReadyRef = useRef(onEngineReady);
  onEngineReadyRef.current = onEngineReady;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return;
    }
    const engine = createEngineRef.current(parent);
    onEngineReadyRef.current?.(engine);
    return () => {
      engine.dispose();
    };
    // instanceKey intentionally controls recreation; createEngine is read
    // through a ref so changing the callback identity alone does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceKey]);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className ?? ''}`.trim()}
      aria-hidden="true"
    />
  );
}
