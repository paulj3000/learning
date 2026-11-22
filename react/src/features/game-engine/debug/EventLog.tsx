import type { EventLogEntry } from './useEventLog';
import styles from './debug.module.css';

export interface EventLogProps {
  entries: readonly EventLogEntry[];
  onClear?: () => void;
}

/** DEV ONLY. The last engine and gameplay events by type and semantic ids. */
export function EventLog({ entries, onClear }: EventLogProps) {
  return (
    <section className={styles.panel} aria-label="Event log">
      <header className={styles.panelHeader}>
        <h3>Event log</h3>
        {onClear ? (
          <button type="button" className={styles.smallButton} onClick={onClear}>
            Clear
          </button>
        ) : null}
      </header>
      {entries.length === 0 ? (
        <p className={styles.muted}>No events yet.</p>
      ) : (
        <ol className={styles.log} aria-live="off">
          {entries
            .slice()
            .reverse()
            .map((entry) => (
              <li
                key={entry.seq}
                data-kind={entry.kind}
                data-dropped={entry.dropped ? 'true' : 'false'}
              >
                <span className={styles.badge}>{entry.kind}</span> <strong>{entry.type}</strong>
                {entry.ids.length > 0 ? (
                  <span className={styles.ids}> {entry.ids.join(', ')}</span>
                ) : null}
                {entry.dropped ? <em> (dropped)</em> : null}
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
