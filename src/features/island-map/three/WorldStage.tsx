import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './WorldStage.module.css';

/** True when the browser lets a page element go full screen (not iPhone Safari, not some embeds). */
function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true;
}

/**
 * The positioned box a 3D region's canvas and `WorldHud` share, plus a
 * "Full screen" toggle.
 *
 * The element that goes full screen is this stage's *parent* (each world
 * view's `.wrapper`), not the stage itself, so the interaction panels and
 * story sessions each view renders below the canvas stay visible while full
 * screen. `IslandWorldView.module.css` (`.wrapper:fullscreen`) lays that
 * parent out as a single viewport-high column with the stage filling
 * whatever the panels leave, so nothing needs page scrolling.
 */
export function WorldStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported] = useState(fullscreenSupported);

  useEffect(() => {
    // Captured now: React has already cleared `stageRef` by the time cleanup runs.
    const target = stageRef.current?.parentElement ?? null;
    const onChange = () => {
      setIsFullscreen(target !== null && document.fullscreenElement === target);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      // Leaving the region (e.g. "Go there") should not strand the child in full screen.
      if (target !== null && document.fullscreenElement === target) {
        void document.exitFullscreen().catch(() => undefined);
      }
    };
  }, []);

  const toggle = useCallback(() => {
    const target = stageRef.current?.parentElement;
    if (!target) return;
    if (document.fullscreenElement === target) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      // A refusal (e.g. a browser policy) just leaves the normal layout in place.
      void target.requestFullscreen().catch(() => undefined);
    }
  }, []);

  return (
    <div ref={stageRef} className={styles.stage} data-world-stage="">
      {children}
      {supported ? (
        <button
          type="button"
          className={styles.fullscreenButton}
          onClick={toggle}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      ) : null}
    </div>
  );
}
