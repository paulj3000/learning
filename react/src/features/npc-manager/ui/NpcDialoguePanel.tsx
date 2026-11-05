import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { CONTROL_KEYS } from '../../region-play/regionPlayUi';
import styles from './NpcInteraction.module.css';
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
}

/**
 * One NPC's line of dialogue (LAI-NPC-014). Presentational: the dialogue controller (workstream
 * C) owns the conversation and passes the current line, choices and state in; every string is a
 * prop, so it is localizable and readable aloud.
 *
 * - The line is in an `aria-live="polite"` region, so each new line is announced.
 * - Choices are buttons; with no choices there is a Continue button. Close is always there.
 * - Focus moves into the panel when it opens (first choice, else Continue) and again on each
 *   new line, and returns to whatever had it before when the panel closes.
 * - Escape closes. The first-person control keys are kept from reaching the window while focus
 *   is inside, so choosing never walks the child away. Nothing traps focus.
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
}: NpcDialoguePanelProps) {
  const copy = { ...NPC_DIALOGUE_COPY, ...copyOverrides };
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (previous && previous !== document.body && document.contains(previous)) {
        previous.focus();
      }
    };
  }, []);

  const errorText = error === true ? copy.error : error || null;
  useEffect(() => {
    // Disabled buttons cannot hold focus: while busy, the panel itself keeps it.
    if (busy) panelRef.current?.focus();
    else (firstRef.current ?? closeRef.current ?? panelRef.current)?.focus();
  }, [nodeKey, busy, errorText, choices.length]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (ARROW_STEPS[event.key] !== undefined && moveFocus(ARROW_STEPS[event.key])) {
      event.preventDefault();
    }
    if (CONTROL_KEYS.has(event.key.toLowerCase())) event.stopPropagation();
  }

  /** Arrow keys step through the panel's enabled buttons (choices first), wrapping round. */
  function moveFocus(step: number): boolean {
    const buttons = [
      ...(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ];
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
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-busy={busy}
      tabIndex={-1}
      className={styles.panel}
      onKeyDown={onKeyDown}
    >
      <div className={styles.header}>
        {portraitUrl ? <img className={styles.portrait} src={portraitUrl} alt="" /> : null}
        <h2 id={titleId} className={styles.title}>
          {speakerName}
        </h2>
      </div>

      <div aria-live="polite">
        {text !== null ? <p className={styles.speech}>{text}</p> : null}
        {busy ? (
          <p className={styles.status} role="status">
            {copy.busy}
          </p>
        ) : null}
      </div>

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
        <button ref={closeRef} type="button" className={styles.button} onClick={onClose}>
          {copy.close}
        </button>
      </div>
    </section>
  );
}
