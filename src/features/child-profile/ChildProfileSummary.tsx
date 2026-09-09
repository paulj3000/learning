import { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './ChildProfileSummary.module.css';
import { ChildAvatar } from './ChildAvatar';
import { ParentGate } from './ParentGate';
import { AGE_BAND_LABELS } from './constants';
import type { ChildProfile } from './api';

interface ChildProfileSummaryProps {
  childProfile: ChildProfile;
  onToggleActive: (childProfile: ChildProfile) => Promise<void>;
}

/**
 * The selected child's identity and the actions that belong to the profile
 * itself, for the parent dashboard.
 *
 * This replaces the old card list: choosing between children moved to the
 * header dropdown (`ChildSwitcher`), so what is left here is everything that
 * was per-card, now shown once for the child in view. Deactivating still goes
 * through `ParentGate`, since it is a change a child must not be able to make
 * by tapping around.
 */
export function ChildProfileSummary({ childProfile, onToggleActive }: ChildProfileSummaryProps) {
  const [gateOpen, setGateOpen] = useState(false);

  return (
    <section className={styles.summary}>
      <div className={styles.identity}>
        {/* Decorative: the nickname beside it is the accessible name. */}
        <ChildAvatar
          avatarKey={childProfile.avatarKey}
          photoKey={childProfile.avatarPhotoKey}
          size="large"
        />
        <div>
          <p className={styles.name}>{childProfile.nickname}</p>
          <p className={styles.meta}>
            {AGE_BAND_LABELS[childProfile.ageBand]} &middot;{' '}
            {childProfile.active ? 'Active' : 'Deactivated'}
          </p>
        </div>
      </div>
      <div className={styles.actions}>
        {childProfile.active ? (
          <Link className={styles.button} to={`/island/${childProfile.id}`}>
            Enter island
          </Link>
        ) : null}
        <Link className={styles.buttonSecondary} to={`/home/children/${childProfile.id}/edit`}>
          Edit
        </Link>
        <button className={styles.buttonSecondary} type="button" onClick={() => setGateOpen(true)}>
          {childProfile.active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>

      {gateOpen ? (
        <ParentGate
          title={childProfile.active ? 'Deactivate this profile?' : 'Reactivate this profile?'}
          description={`Answer this quick check to ${
            childProfile.active ? 'deactivate' : 'reactivate'
          } ${childProfile.nickname}'s profile.`}
          onCancel={() => setGateOpen(false)}
          onSuccess={() => {
            setGateOpen(false);
            void onToggleActive(childProfile);
          }}
        />
      ) : null}
    </section>
  );
}
