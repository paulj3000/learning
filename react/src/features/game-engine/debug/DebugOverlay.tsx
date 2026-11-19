import { useEffect, useState } from 'react';
import type { DiagnosticsSnapshot, EngineRuntime } from '@lai/game-engine/core';
import styles from './debug.module.css';

export interface DebugOverlayProps {
  runtime: EngineRuntime | null;
  /** How often the snapshot is read. Not per frame. Default 500 ms. */
  intervalMs?: number;
  collisionVisible: boolean;
  onCollisionVisibleChange(visible: boolean): void;
}

const fixed = (value: number | undefined, digits = 1) => (value === undefined ? '-' : value.toFixed(digits));

/**
 * DEV ONLY (imported by the Playground only; never by a production route). Shows engine
 * diagnostics read from `runtime.diagnostics.snapshot()` on an interval.
 */
export function DebugOverlay({ runtime, intervalMs = 500, collisionVisible, onCollisionVisibleChange }: DebugOverlayProps) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null);

  useEffect(() => {
    if (!runtime) {
      setSnapshot(null);
      return undefined;
    }
    const read = () => setSnapshot(runtime.diagnostics.snapshot());
    read();
    const id = window.setInterval(read, intervalMs);
    return () => window.clearInterval(id);
  }, [runtime, intervalMs]);

  const gauges = snapshot?.gauges ?? {};
  const rendererGauges = Object.entries(gauges).filter(([name]) => name.startsWith('renderer.'));
  const timings = Object.entries(snapshot?.systemTimingsMs ?? {});

  return (
    <aside className={styles.overlay} aria-label="Engine diagnostics">
      <label className={styles.toggle}>
        <input type="checkbox" checked={collisionVisible} onChange={(e) => onCollisionVisibleChange(e.target.checked)} />
        Show collision
      </label>
      <dl className={styles.stats}>
        <dt>FPS</dt>
        <dd data-testid="debug-fps">{fixed(snapshot?.frame.fps, 0)}</dd>
        <dt>Frame ms</dt>
        <dd data-testid="debug-frame-ms">{fixed(snapshot?.frame.meanFrameMs)}</dd>
        <dt>Worst ms</dt>
        <dd>{fixed(snapshot?.frame.maxFrameMs)}</dd>
        <dt>Dropped s</dt>
        <dd data-testid="debug-dropped">{fixed(snapshot?.frame.droppedSeconds, 2)}</dd>
        <dt>Entities</dt>
        <dd data-testid="debug-entities">{gauges.entities ?? '-'}</dd>
        <dt>Resources</dt>
        <dd data-testid="debug-resources">{gauges.resources ?? '-'}</dd>
        {rendererGauges.map(([name, value]) => (
          <div key={name} className={styles.row}>
            <dt>{name.replace('renderer.', '')}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {timings.length > 0 ? (
        <>
          <h4>Systems (ms)</h4>
          <ul className={styles.list}>
            {timings.map(([id, ms]) => (
              <li key={id}>
                {id}: {ms.toFixed(2)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {snapshot && snapshot.warnings.length > 0 ? (
        <>
          <h4>Warnings</h4>
          <ul className={styles.list} data-testid="debug-warnings">
            {snapshot.warnings.map((w) => (
              <li key={w.code}>
                {w.code}
                {w.repeats > 0 ? ` x${w.repeats + 1}` : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}
