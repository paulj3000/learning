import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './ChildModePlaceholder.module.css';
import { ParentGate } from '../features/child-profile/ParentGate';
import { getChildProfile } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';

/**
 * Placeholder child-mode shell (docs/ROADMAP.md Phase 1 "parent/child mode
 * separation"). The real island map, companion, and adventures arrive in
 * Phase 2; this establishes the route split and the parent-gated exit now.
 */
export function ChildModePlaceholder() {
  const { childId } = useParams<{ childId: string }>();
  const navigate = useNavigate();
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [showGate, setShowGate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!childId) return;
    void getChildProfile(childId).then((profile) => {
      if (!cancelled) setChildProfile(profile);
    });
    return () => {
      cancelled = true;
    };
  }, [childId]);

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>
        {childProfile ? `${childProfile.nickname} is on the island` : 'Welcome to the island'}
      </h1>
      <p className={styles.lead}>
        The map, companion, and adventures are being built. Check back soon for the first quests.
      </p>
      <button className={styles.exit} type="button" onClick={() => setShowGate(true)}>
        Adults: exit to parent space
      </button>
      {showGate ? (
        <ParentGate
          title="Return to parent space?"
          description="Answer this quick check to leave the island and manage profiles."
          onCancel={() => setShowGate(false)}
          onSuccess={() => navigate('/parent')}
        />
      ) : null}
    </div>
  );
}
