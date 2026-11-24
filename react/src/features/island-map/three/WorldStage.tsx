import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './WorldStage.module.css';
import { LeaveIslandButton } from '../../portal/exit';

/**
 * The custom property, set on the full-screen element, that says how far the
 * stage's bottom edge sits above the viewport's (GE-090-D8). The stage's exits
 * sit on that edge; `ChildShell.module.css` adds it to
 * `--child-stage-exits-inset`, so fixed dialogue panels stay clear of them.
 */
export const STAGE_BOTTOM_GAP = '--child-stage-bottom-gap';

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

  // GE-090-D8: in full screen, settings below the stage (camera view, sprint)
  // lift its bottom edge, and the exits with it, above the viewport's bottom.
  // Measure the gap and publish it, and follow any later resize.
  useEffect(() => {
    if (!isFullscreen) return;
    const stage = stageRef.current;
    const target = stage?.parentElement;
    if (!stage || !target) return;
    const update = () => {
      const gap = Math.max(
        0,
        Math.round(window.innerHeight - stage.getBoundingClientRect().bottom),
      );
      target.style.setProperty(STAGE_BOTTOM_GAP, `${gap}px`);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(stage);
    observer?.observe(target);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      target.style.removeProperty(STAGE_BOTTOM_GAP);
    };
  }, [isFullscreen]);

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
      {/*
        AP-04: full screen covers the island's top bar, so the child's own
        exit comes with it. Only in full screen, so the page never shows two
        "Leave island" buttons. Outside child mode it renders nothing.
      */}
      {isFullscreen ? (
        <div className={styles.leaveSlot}>
          <LeaveIslandButton />
        </div>
      ) : null}
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
