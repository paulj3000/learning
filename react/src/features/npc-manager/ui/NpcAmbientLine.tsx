import { useId } from 'react';
import styles from './NpcInteraction.module.css';
import { NPC_DIALOGUE_COPY, type NpcDialogueCopy } from './npcUiCopy';

export interface NpcAmbientLineProps {
  speakerName: string;
  /** The line (the caption while it is spoken). */
  text: string;
  /**
   * "Talk to Pirate Pip": shown instead of Continue when the line has choices, which need the
   * full dialogue panel. Null when the line has no choices.
   */
  talkLabel?: string | null;
  /** A request is in flight: buttons are disabled. */
  busy?: boolean;
  /**
   * `inline`: a compact one-row bubble for a world's stage slot (top centre of the stage: it
   * stays inside full screen and never covers the HUD or the reticle's action prompt).
   * `floating`: fixed to the top right of the page.
   */
  layout?: 'inline' | 'floating';
  copy?: Partial<NpcDialogueCopy>;
  onContinue(): void;
  onTalk(): void;
  onClose(): void;
}

/**
 * An NPC's unprompted line (a greeting, a welcome back, a reaction to a find), shown as a small
 * speech bubble instead of the modal dialogue panel (QA finding F-B). The child did not ask to
 * talk, so it never takes focus, never traps keys and never hides the world's HUD: the child can
 * keep playing, read it, close it, continue it, or open the full conversation.
 *
 * Accessibility (`docs/NPC_MANAGER_ACCESSIBILITY.md`): a labelled `region` whose line sits in an
 * atomic `aria-live="polite"` region with the speaker's name, so it is announced once without
 * moving focus; it stays until the child closes or continues it, or a newer unprompted line
 * replaces it (no dismissal timer); every button meets the 56 px target.
 */
export function NpcAmbientLine({
  speakerName,
  text,
  talkLabel = null,
  busy = false,
  layout = 'floating',
  copy: copyOverrides,
  onContinue,
  onTalk,
  onClose,
}: NpcAmbientLineProps) {
  const copy = { ...NPC_DIALOGUE_COPY, ...copyOverrides };
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={layout === 'inline' ? styles.ambientInline : styles.ambient}
      data-npc-ambient=""
    >
      <div className={styles.ambientBody}>
        <h2 id={titleId} className={styles.ambientTitle}>
          {speakerName}
        </h2>
        <div aria-live="polite" aria-atomic="true">
          <p className={styles.ambientSpeech}>
            {speakerName ? <span className={styles.visuallyHidden}>{speakerName}: </span> : null}
            <span>{text}</span>
          </p>
        </div>
      </div>
      <div className={styles.ambientActions}>
        {talkLabel ? (
          <button type="button" className={styles.primary} disabled={busy} onClick={onTalk}>
            {talkLabel}
          </button>
        ) : (
          <button type="button" className={styles.primary} disabled={busy} onClick={onContinue}>
            {copy.continue}
          </button>
        )}
        <button type="button" className={styles.button} onClick={onClose}>
          {copy.close}
        </button>
      </div>
    </section>
  );
}
