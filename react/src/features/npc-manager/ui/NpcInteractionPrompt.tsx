import { useEffect, useRef, type PointerEvent, type Ref } from 'react';
import type { InputMethod } from '../contracts/engine';
import styles from './NpcInteraction.module.css';
import { NpcTalkIcon } from './NpcIcons';

export interface NpcInteractionPromptProps {
  /** The full, localized label, e.g. `talkToLabel('Pirate Pip')` ("Talk to Pirate Pip"). */
  label: string;
  /** The child asked to talk; `via` says how (for the engine's `npc.interact_requested`). */
  onInteract(via: InputMethod): void;
  /**
   * Optional global shortcut (one character, e.g. `'e'`). Off by default. When set, pressing it
   * anywhere on the page interacts, unless focus is in a text field or another handler already
   * used the key; the key is shown on the button.
   */
  hotkey?: string | null;
  className?: string;
  /** The underlying button, so a host can return focus to it after a conversation. */
  buttonRef?: Ref<HTMLButtonElement>;
}

/**
 * The "Talk to ..." button shown while an NPC is approached (LAI-NPC-014). A real `<button>`:
 * pointer, touch (at least 48 px tall), and Enter/Space when focused all work; the optional
 * `hotkey` adds a keyboard shortcut for first-person play. Presentational: the host decides when
 * to show it (between `npc.approached` and `npc.left`) and forwards `onInteract` to the runtime.
 *
 * Accessibility (LAI-NPC-038): a speech-bubble icon sits next to the text for pre-readers (the
 * text alone is the accessible name), the target is at least 56 px tall for ages 3 to 4, there is
 * no hover-only affordance, and a single tap activates it (`touch-action: manipulation`).
 */
export function NpcInteractionPrompt({
  label,
  onInteract,
  hotkey = null,
  className,
  buttonRef,
}: NpcInteractionPromptProps) {
  const lastPointer = useRef<InputMethod | null>(null);
  const onInteractRef = useRef(onInteract);
  useEffect(() => {
    onInteractRef.current = onInteract;
  });

  useEffect(() => {
    if (!hotkey) return undefined;
    const key = hotkey.toLowerCase();
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.key.toLowerCase() !== key) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      onInteractRef.current('keyboard');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    lastPointer.current = event.pointerType === 'touch' ? 'touch' : 'pointer';
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className={[styles.prompt, className].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        // A click with no pointer down before it came from Enter or Space.
        const via = event.detail === 0 ? 'keyboard' : (lastPointer.current ?? 'pointer');
        lastPointer.current = null;
        onInteract(via);
      }}
      aria-keyshortcuts={hotkey ? hotkey.toUpperCase() : undefined}
    >
      <NpcTalkIcon className={styles.icon} />
      <span>{label}</span>
      {hotkey ? (
        <span className={styles.key} aria-hidden="true">
          {hotkey.toUpperCase()}
        </span>
      ) : null}
    </button>
  );
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(target.type);
  }
  return false;
}
