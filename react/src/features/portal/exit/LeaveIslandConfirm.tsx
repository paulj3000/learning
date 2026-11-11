import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { PortalButton } from '../ui';
import { LEAVE_ISLAND_COPY } from './copy';

interface LeaveIslandConfirmProps {
  onLeave(): void;
  onStay(): void;
}

/**
 * The "are you sure" shown only when something is mid-way (AP-04: "confirm
 * exit where needed"). Two plain choices and nothing to answer: no
 * arithmetic, no quiz, no typed input. Focus starts on "Keep playing" so an
 * accidental double tap does not leave; Escape also keeps playing.
 */
export function LeaveIslandConfirm({ onLeave, onStay }: LeaveIslandConfirmProps) {
  const titleId = useId();
  const bodyId = useId();
  const stayRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayRef.current?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onStay();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
        className="flex w-full max-w-md flex-col gap-4 rounded-3xl bg-paper p-6 text-ink shadow-xl"
      >
        <h2 id={titleId} className="m-0 text-2xl">
          {LEAVE_ISLAND_COPY.confirmTitle}
        </h2>
        <p id={bodyId} className="m-0 text-lg">
          {LEAVE_ISLAND_COPY.confirmBody}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <PortalButton ref={stayRef} tone="tropical" size="lg" block onClick={onStay}>
            {LEAVE_ISLAND_COPY.stay}
          </PortalButton>
          <PortalButton tone="quiet" size="lg" block onClick={onLeave}>
            {LEAVE_ISLAND_COPY.leave}
          </PortalButton>
        </div>
      </div>
    </div>
  );
}
