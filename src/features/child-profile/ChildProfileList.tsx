import { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './ChildProfileList.module.css';
import { ParentGate } from './ParentGate';
import { AGE_BAND_LABELS, MAX_CHILD_PROFILES } from './constants';
import type { ChildProfile } from './api';

interface ChildProfileListProps {
  childProfiles: ChildProfile[];
  onToggleActive: (childProfile: ChildProfile) => Promise<void>;
}

export function ChildProfileList({ childProfiles, onToggleActive }: ChildProfileListProps) {
  const [pendingGateFor, setPendingGateFor] = useState<ChildProfile | null>(null);
  const canAddChild = childProfiles.length < MAX_CHILD_PROFILES;

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Child profiles</h2>
        {canAddChild ? (
          <Link className={styles.addLink} to="/parent/children/new">
            Add child
          </Link>
        ) : (
          <p className={styles.hint}>
            You have reached the limit of {MAX_CHILD_PROFILES} child profiles.
          </p>
        )}
      </div>

      {childProfiles.length === 0 ? (
        <p className={styles.hint}>No child profiles yet. Add one to get started.</p>
      ) : (
        <ul className={styles.list}>
          {childProfiles.map((child) => (
            <li className={styles.card} key={child.id}>
              <div>
                <p className={styles.name}>{child.nickname}</p>
                <p className={styles.meta}>
                  {AGE_BAND_LABELS[child.ageBand]} · {child.active ? 'Active' : 'Deactivated'}
                </p>
              </div>
              <div className={styles.actions}>
                {child.active ? (
                  <Link className={styles.button} to={`/island/${child.id}`}>
                    Enter island
                  </Link>
                ) : null}
                <Link className={styles.buttonSecondary} to={`/parent/children/${child.id}/edit`}>
                  Edit
                </Link>
                <button
                  className={styles.buttonSecondary}
                  type="button"
                  onClick={() => setPendingGateFor(child)}
                >
                  {child.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingGateFor ? (
        <ParentGate
          title={pendingGateFor.active ? 'Deactivate this profile?' : 'Reactivate this profile?'}
          description={`Answer this quick check to ${
            pendingGateFor.active ? 'deactivate' : 'reactivate'
          } ${pendingGateFor.nickname}'s profile.`}
          onCancel={() => setPendingGateFor(null)}
          onSuccess={() => {
            const child = pendingGateFor;
            setPendingGateFor(null);
            void onToggleActive(child);
          }}
        />
      ) : null}
    </section>
  );
}
