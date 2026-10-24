import { useState } from 'react';
import styles from './CalmStop.module.css';

interface CalmStopProps {
  /** Whether the parent-configured time for this sitting has been reached. */
  limitReached: boolean;
  /** Rendered instead of the default note, when a region stages the stop in the world. */
  children?: React.ReactNode;
}

/**
 * The calm stopping point MVP scope item 11 has promised since the
 * beginning and never had.
 *
 * It is a **note, not a gate**. When the time a parent set has passed, a
 * quiet line appears saying this is a good moment to stop. Nothing closes,
 * nothing is taken away, the next tap still works, and a child in the middle
 * of a question is never interrupted - because the note sits beside the
 * screen rather than over it, and nothing here can end a step.
 *
 * What it deliberately does not do, from CLAUDE.md section 4's calm
 * engagement and section 12's exclusion of dark patterns:
 *
 * - **No countdown.** A child never watches time drain. The word "minutes"
 *   does not appear.
 * - **No streak, score, or come-back-tomorrow.** Stopping is not a loss and
 *   playing on is not a win. There is no reward for either.
 * - **No lockout, no nagging.** It can be dismissed, and once dismissed it
 *   stays dismissed for this sitting. A message that reappears until it is
 *   obeyed is a gate wearing a friendly face.
 *
 * The child-facing words are written to be read aloud, and to be true if a
 * grown-up is not there to read them: a good stopping place is a real thing
 * in a story, and this says so rather than announcing a rule.
 */
export function CalmStop({ limitReached, children }: CalmStopProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!limitReached || dismissed) return null;

  return (
    <aside className={styles.calmStop} aria-label="A good place to stop">
      <div className={styles.body}>
        {children ?? (
          <p className={styles.message}>
            This is a good place to stop for today. Your island will keep everything you made.
          </p>
        )}
      </div>
      <button type="button" className={styles.dismiss} onClick={() => setDismissed(true)}>
        Okay
      </button>
    </aside>
  );
}
