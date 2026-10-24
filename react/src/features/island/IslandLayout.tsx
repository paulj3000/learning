import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from './IslandLayout.module.css';
import { ParentGate } from '../child-profile/ParentGate';
import { CalmStop } from '../session/CalmStop';
import { useSessionClock } from '../session/useSessionClock';

interface IslandLayoutProps {
  childId: string;
  children: ReactNode;
}

/**
 * Shared chrome for every child-mode screen: consistent map/log navigation
 * and a parent-gated exit (docs/UX_AND_ACCESSIBILITY.md "Use consistent
 * placement for companion, progress path, help, and exit").
 *
 * It is also where the session clock lives, for the same reason: it wraps
 * every child-mode screen, so there is exactly one clock and it survives
 * walking from the map into an adventure and back. A region that stages the
 * stop in its own world (Storykeeper Castle does) reads the same clock
 * rather than starting a second one.
 */
export function IslandLayout({ childId, children }: IslandLayoutProps) {
  const navigate = useNavigate();
  const [showGate, setShowGate] = useState(false);
  const { limitReached } = useSessionClock(childId);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <nav className={styles.nav} aria-label="Island">
          <Link className={styles.navLink} to={`/island/${childId}`}>
            Harbor map
          </Link>
          <Link className={styles.navLink} to={`/island/${childId}/log`}>
            Adventure log
          </Link>
        </nav>
        <button className={styles.exit} type="button" onClick={() => setShowGate(true)}>
          Adults: exit to parent space
        </button>
      </header>
      <main className={styles.main} id="main-content">
        {children}
      </main>
      <CalmStop limitReached={limitReached} />
      {showGate ? (
        <ParentGate
          title="Return to parent space?"
          description="Answer this quick check to leave the island and manage profiles."
          onCancel={() => setShowGate(false)}
          onSuccess={() => navigate('/home')}
        />
      ) : null}
    </div>
  );
}
