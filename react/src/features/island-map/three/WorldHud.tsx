import { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './WorldHud.module.css';
import { ChattyAvatar } from '../../companion/ChattyAvatar';
import type { CameraMode } from './playerPresentation';

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
  /**
   * Action prompt mode (`interactionAssist`): the verb for what has focus
   * ("Open"). With `onInteract`, the label becomes one large button that
   * names the action, works by tap, click or E, and shows the E key only on
   * a device with a fine pointer (no keyboard is assumed on a tablet).
   */
  focusAction?: string | null;
  onInteract?: () => void;
  /** False when a companion shows its own backpack. Defaults to true. */
  showBackpack?: boolean;
  /**
   * A way out drawn on the stage itself, so it is there in full screen too,
   * where the page's own links are hidden. Never gated (LAI-0807).
   */
  exitLink?: { label: string; to: string };
  /**
   * LAI-JMP-01: present where the child can jump. On a touch device it
   * shows a large Jump button on the right edge, clear of the move-drag half
   * of the screen and of the Hint and Backpack column, so one thumb can move
   * while the other jumps. Keyboards use Space and gamepads A/Cross instead.
   */
  onJump?: () => void;
  /** Child-facing label of the Jump button. Defaults to "Jump". */
  jumpLabel?: string;
  /**
   * LAI-JMP-01a: the perspective in force, and how to switch it. With
   * `onToggleCamera` a camera button shows on every device (V and the gamepad
   * do the same), beside the Jump button on a touch screen.
   */
  cameraMode?: CameraMode;
  onToggleCamera?: () => void;
}

/** What the camera button calls each perspective, readable aloud. */
const CAMERA_VIEW_LABELS: Readonly<Record<CameraMode, string>> = {
  'third-person': 'Behind me',
  'first-person': 'My eyes',
};

/** True where a keyboard hint makes sense: a fine pointer (mouse, trackpad). Unknown means yes. */
function hasFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(pointer: fine)').matches;
}

/** True on a touch screen (any coarse pointer), where an on-screen Jump button is needed. Unknown means no. */
function hasCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(any-pointer: coarse)').matches;
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
  focusAction = null,
  onInteract,
  showBackpack = true,
  exitLink,
  onJump,
  jumpLabel = 'Jump',
  cameraMode = 'first-person',
  onToggleCamera,
}: WorldHudProps) {
  const [backpackOpen, setBackpackOpen] = useState(false);
  const showJump = onJump !== undefined && hasCoarsePointer();
  const actionPrompt = onInteract && focusedLabel && focusAction;

  return (
    <div className={styles.overlay}>
      <div className={styles.topRow}>
        {questCue ? <p className={styles.cue}>{questCue}</p> : <span />}
        <div className={styles.topRight}>
          {companionName ? (
            <div className={styles.companionCue}>
              <ChattyAvatar size={28} />
              <span className={styles.companionName}>{companionName}</span>
            </div>
          ) : null}
          {exitLink ? (
            <Link className={styles.exitLink} to={exitLink.to}>
              {exitLink.label}
            </Link>
          ) : null}
        </div>
      </div>

      <div className={styles.reticleWrap}>
        <div
          className={`${styles.reticle} ${focusedLabel ? styles.reticleFocused : ''}`.trim()}
          aria-hidden="true"
        />
        {actionPrompt ? (
          <button
            type="button"
            className={styles.actionPrompt}
            onClick={onInteract}
            aria-label={`${focusAction}: ${focusedLabel}`}
          >
            {hasFinePointer() ? (
              <kbd className={styles.actionKey} aria-hidden="true">
                E
              </kbd>
            ) : null}
            <span className={styles.actionVerb}>{focusAction}</span>
            <span className={styles.actionTarget}>{focusedLabel}</span>
          </button>
        ) : focusedLabel ? (
          <span className={styles.focusLabel}>{focusedLabel}: press E to talk</span>
        ) : null}
      </div>

      {showJump ? (
        <button
          type="button"
          className={styles.jumpButton}
          aria-label={jumpLabel}
          // Pointer down, not click: the jump happens the instant a thumb lands,
          // and a second finger can keep steering on the other half of the screen.
          onPointerDown={(event) => {
            event.preventDefault();
            onJump();
          }}
          // Keyboard or switch activation only (detail 0); a tap already jumped on pointer down.
          onClick={(event) => {
            if (event.detail === 0) onJump();
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <span className={styles.jumpIcon} aria-hidden="true">
            ⤒
          </span>
          <span className={styles.jumpText}>{jumpLabel}</span>
        </button>
      ) : null}

      {onToggleCamera ? (
        <button
          type="button"
          className={`${styles.cameraButton} ${showJump ? styles.cameraBesideJump : ''}`.trim()}
          aria-label={`View: ${CAMERA_VIEW_LABELS[cameraMode]}. Change view`}
          onClick={onToggleCamera}
          onContextMenu={(event) => event.preventDefault()}
        >
          {hasFinePointer() ? (
            <kbd className={styles.actionKey} aria-hidden="true">
              V
            </kbd>
          ) : null}
          <span className={styles.cameraIcon} aria-hidden="true">
            {cameraMode === 'third-person' ? '🧍' : '👀'}
          </span>
          <span className={styles.cameraText}>{CAMERA_VIEW_LABELS[cameraMode]}</span>
        </button>
      ) : null}

      <div className={styles.bottomRow}>
        {toastMessage ? <p className={styles.toast}>{toastMessage}</p> : <span />}
        {showBackpack ? (
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
        ) : null}
      </div>
    </div>
  );
}
