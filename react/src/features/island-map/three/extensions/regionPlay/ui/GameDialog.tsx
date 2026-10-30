import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CONTROL_KEYS } from '../../../../../region-play/regionPlayUi';
import styles from './RegionPlayPanels.module.css';

export interface GameDialogProps {
  titleId: string;
  title: string;
  onClose(): void;
  className?: string;
  children: ReactNode;
}

/**
 * The shell every Treasure Rush panel uses (TR-8).
 *
 * - Moves focus to its heading when it opens, so a screen reader announces
 *   it and the keyboard starts inside it, and hands focus back to wherever
 *   it was when it closes.
 * - Escape closes it. Nothing traps focus: Tab can always leave, and the
 *   panel is not modal over the rest of the page.
 * - Keeps the first-person controls' keys (`CONTROL_KEYS`) from reaching the
 *   window while focus is inside, so choosing an answer never walks the
 *   child away or re-opens what they are looking at. The engine's own
 *   pointer lock is already released when the interaction opens.
 */
export function GameDialog({ titleId, title, onClose, className, children }: GameDialogProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (CONTROL_KEYS.has(event.key.toLowerCase())) event.stopPropagation();
  }

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={[styles.panel, className].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.title}>
        {title}
      </h2>
      {children}
    </section>
  );
}
