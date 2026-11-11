import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { CONTROL_KEYS } from '../../region-play/regionPlayUi';
import styles from './NpcInteraction.module.css';
import { NpcReplayIcon } from './NpcIcons';
import { NPC_DIALOGUE_COPY, type NpcDialogueCopy } from './npcUiCopy';

const ARROW_STEPS: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

export interface NpcDialogueChoiceView {
  key: string;
  label: string;
}

export interface NpcDialoguePanelProps {
  speakerName: string;
  /** A resolved image URL (from the asset resolver), or null for no portrait. */
  portraitUrl?: string | null;
  /** The line to show (and caption when speech plays); null while the first line loads. */
  text: string | null;
  /** Changes whenever a new line is shown, so focus moves to its first control. */
  nodeKey?: string | null;
  choices?: readonly NpcDialogueChoiceView[];
  /** A request is in flight: controls are disabled and the busy line is announced. */
  busy?: boolean;
  /** A calm, child-facing message, or true for the default one. */
  error?: string | boolean | null;
  copy?: Partial<NpcDialogueCopy>;
  onChoose(choiceKey: string): void;
  onContinue(): void;
  onClose(): void;
  /** Shows a retry button next to the error. */
  onRetry?(): void;
  /**
   * Shows the "Hear it again" button, which replays the current line's voice. Leave it unset
   * when the line has no voice or the child would not hear it (muted): the caption is enough.
   */
  onReplay?(): void;
  /** Keeps the replay button visible but disabled (for example while the voice is loading). */
  replayDisabled?: boolean;
  /**
   * Where focus goes when the panel closes and the element that had focus before it opened is
   * gone (the Talk prompt hides while a conversation is open). Return null to leave focus alone.
   */
  returnFocusTo?(): HTMLElement | null;
  /**
   * An unprompted line (a greeting, a welcome back, a reaction): shown as a non-modal speech
   * bubble that leaves the world's HUD visible and usable (QA finding F-B). It never takes or
   * traps focus and never restores it; Escape and the arrow keys still work while focus is
   * inside. Conversations the child starts are always the modal panel.
   */
  ambient?: boolean;
}

/**
 * One NPC's line of dialogue (LAI-NPC-014). Presentational: the dialogue controller (workstream
 * C) owns the conversation and passes the current line, choices and state in; every string is a
 * prop, so it is localizable and readable aloud.
 *
 * Accessibility (LAI-NPC-014, LAI-NPC-038; `docs/NPC_MANAGER_ACCESSIBILITY.md`):
 *
 * - A labelled modal dialog (`aria-labelledby` the speaker's name).
 * - The line is the caption: always visible while it is spoken, muted, loading or failed, and
 *   never dismissed by a timer. It sits in its own atomic `aria-live="polite"` region with the
 *   speaker's name (visually hidden), so each new line is announced once, with who said it.
 *   The busy line is a separate `role="status"`, so the two never nest and double-read.
 * - Choices are buttons; with no choices there is a Continue button. Close is always there, and
 *   "Hear it again" when the host offers a replay.
 * - Focus moves into the panel when it opens (first choice, else Continue) and again on each
 *   new line. Tab and Shift+Tab cycle inside the panel while it is open; arrow keys step through
 *   its buttons. Focus returns to whatever had it before (else `returnFocusTo`) on close, and
 *   nothing is trapped after that.
 * - Escape closes. The first-person control keys are kept from reaching the window while focus
 *   is inside, so choosing never walks the child away.
 * - `ambient`: the same caption, choices and buttons in a labelled, non-modal region placed
 *   clear of the HUD. Focus is left where the child had it (no move, no trap, no restore), and
 *   the line is still announced once through the same live region.
 */
export function NpcDialoguePanel({
  speakerName,
  portraitUrl = null,
  text,
  nodeKey = null,
  choices = [],
  busy = false,
  error = null,
  copy: copyOverrides,
  onChoose,
  onContinue,
  onClose,
  onRetry,
  onReplay,
  replayDisabled = false,
  returnFocusTo,
  ambient = false,
}: NpcDialoguePanelProps) {
  const copy = { ...NPC_DIALOGUE_COPY, ...copyOverrides };
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef(returnFocusTo);
  useEffect(() => {
    onCloseRef.current = onClose;
    returnFocusRef.current = returnFocusTo;
  });

  useEffect(() => {
    if (ambient) return undefined; // a bubble never took focus, so it gives none back
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous && previous !== document.body && document.contains(previous)) {
        previous.focus();
        return;
      }
      // Only take focus back if it was lost (it was inside the panel that just went away).
      const active = document.activeElement;
      if (active && active !== document.body) return;
      returnFocusRef.current?.()?.focus();
    };
  }, [ambient]);

  const errorText = error === true ? copy.error : error || null;
  useEffect(() => {
    if (ambient) return; // never pull focus away from the world or its HUD
    // Disabled buttons cannot hold focus: while busy, the panel itself keeps it.
    if (busy) panelRef.current?.focus();
    else (firstRef.current ?? closeRef.current ?? panelRef.current)?.focus();
  }, [ambient, nodeKey, busy, errorText, choices.length]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key === 'Tab') {
      if (!ambient) trapTab(event);
      return;
    }
    if (ARROW_STEPS[event.key] !== undefined && moveFocus(ARROW_STEPS[event.key])) {
      event.preventDefault();
    }
    if (CONTROL_KEYS.has(event.key.toLowerCase())) event.stopPropagation();
  }

  function enabledButtons(): HTMLButtonElement[] {
    return [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ];
  }

  /** Tab and Shift+Tab wrap round inside the panel while it is open. */
  function trapTab(event: KeyboardEvent<HTMLElement>) {
    const buttons = enabledButtons();
    if (buttons.length === 0) {
      event.preventDefault();
      return;
    }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (active === last || !buttons.includes(active as HTMLButtonElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Arrow keys step through the panel's enabled buttons (choices first), wrapping round. */
  function moveFocus(step: number): boolean {
    const buttons = enabledButtons();
    if (buttons.length === 0) return false;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      current === -1
        ? step > 0
          ? 0
          : buttons.length - 1
        : (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
    return true;
  }

  const showContinue = choices.length === 0 && text !== null && !errorText;

  return (
    <section
      ref={panelRef}
      {...(ambient ? { 'data-npc-ambient': '' } : { role: 'dialog', 'aria-modal': 'true' })}
      aria-labelledby={titleId}
      aria-busy={busy}
      tabIndex={-1}
      className={ambient ? `${styles.panel} ${styles.bubble}` : styles.panel}
      onKeyDown={onKeyDown}
    >
      <div className={styles.header}>
        {portraitUrl ? <img className={styles.portrait} src={portraitUrl} alt="" /> : null}
        <h2 id={titleId} className={styles.title}>
          {speakerName}
        </h2>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {text !== null ? (
          <p className={styles.speech}>
            {speakerName ? <span className={styles.visuallyHidden}>{speakerName}: </span> : null}
            <span>{text}</span>
          </p>
        ) : null}
      </div>
      <div role="status">{busy ? <p className={styles.status}>{copy.busy}</p> : null}</div>

      {errorText ? (
        <p className={styles.error} role="alert">
          {errorText}
        </p>
      ) : null}

      {choices.length > 0 && !errorText ? (
        <div className={styles.choices} role="group" aria-label={copy.choicesLabel}>
          {choices.map((choice, index) => (
            <button
              key={choice.key}
              ref={index === 0 ? firstRef : undefined}
              type="button"
              className={styles.choice}
              disabled={busy}
              onClick={() => onChoose(choice.key)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.actions}>
        {errorText && onRetry ? (
          <button
            ref={firstRef}
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={onRetry}
          >
            {copy.retry}
          </button>
        ) : null}
        {showContinue ? (
          <button
            ref={firstRef}
            type="button"
            className={styles.primary}
            disabled={busy}
            onClick={onContinue}
          >
            {copy.continue}
          </button>
        ) : null}
        {onReplay && !errorText && text !== null ? (
          <button
            type="button"
            className={styles.button}
            disabled={busy || replayDisabled}
            onClick={onReplay}
          >
            <NpcReplayIcon className={styles.icon} />
            <span>{copy.replay}</span>
          </button>
        ) : null}
        <button ref={closeRef} type="button" className={styles.button} onClick={onClose}>
          {copy.close}
        </button>
      </div>
    </section>
  );
}
