import { useState } from 'react';
import styles from './WorldHud.module.css';
import { ChattyAvatar } from '../../companion/ChattyAvatar';

export interface WorldHudBackpackItem {
  id: string;
  displayName: string;
}

export interface WorldHudProps {
  /** A one-line reminder of the child's current quest, or `null` if they have none active. */
  questCue: string | null;
  /** The companion's display name (e.g. "Chatty"), or `null` before a companion is chosen. */
  companionName: string | null;
  /** Child-facing label of whatever the reticle is centered on right now (e.g. "Pip"), or `null`. */
  focusedLabel: string | null;
  /** A short-lived message (e.g. "You're inside the lookout tower."), or `null`. */
  toastMessage: string | null;
  backpackItems: readonly WorldHudBackpackItem[];
}

/**
 * The Phase 32 minimal child-readable HUD (`docs/ROADMAP.md` Phase 32:
 * "a minimal child-readable HUD (quest cue, companion cue, inventory entry
 * point, focus/interaction reticle)").
 *
 * A plain overlay `<div>`, not a Three.js scene object, per ADR-008 in
 * `docs/DECISIONS.md`: nothing here reads or writes game state directly, it
 * only renders what `WelcomeHarborWorldView.tsx` already computed from real
 * domain reads. `pointer-events: none` on the overlay (and everywhere
 * except its own buttons, `WorldHud.module.css`) so it never blocks
 * pointer-lock clicks or drag-to-look touches on the canvas beneath it.
 */
export function WorldHud({
  questCue,
  companionName,
  focusedLabel,
  toastMessage,
  backpackItems,
}: WorldHudProps) {
  const [backpackOpen, setBackpackOpen] = useState(false);

  return (
    <div className={styles.overlay}>
      <div className={styles.topRow}>
        {questCue ? <p className={styles.cue}>{questCue}</p> : <span />}
        {companionName ? (
          <div className={styles.companionCue}>
            <ChattyAvatar size={28} />
            <span className={styles.companionName}>{companionName}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.reticleWrap}>
        <div
          className={`${styles.reticle} ${focusedLabel ? styles.reticleFocused : ''}`.trim()}
          aria-hidden="true"
        />
        {focusedLabel ? (
          <span className={styles.focusLabel}>{focusedLabel}: press E to talk</span>
        ) : null}
      </div>

      <div className={styles.bottomRow}>
        {toastMessage ? <p className={styles.toast}>{toastMessage}</p> : <span />}
        <div style={{ position: 'relative', pointerEvents: 'auto' }}>
          <button
            type="button"
            className={styles.inventoryButton}
            onClick={() => setBackpackOpen((open) => !open)}
            aria-expanded={backpackOpen}
          >
            Backpack ({backpackItems.length})
          </button>
          {backpackOpen ? (
            <div className={styles.inventoryPanel} role="dialog" aria-label="Backpack">
              <p className={styles.inventoryPanelTitle}>Your backpack</p>
              {backpackItems.length === 0 ? (
                <p className={styles.inventoryEmpty}>Nothing here yet.</p>
              ) : (
                <ul className={styles.inventoryList}>
                  {backpackItems.map((item) => (
                    <li key={item.id}>{item.displayName}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
