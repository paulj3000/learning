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
 * view's `.wrapper`), not the stage itself, so the dialogue and puzzle layers
 * each view renders beside the canvas (fixed to the viewport) stay visible
 * while full screen. `WorldView.module.css` (`.wrapper:fullscreen`)
 * lays that parent out as a single viewport-high column with the stage
 * filling it. Settings and exploration lists live in the stage toolbar's
 * menus (GE-101), so nothing takes height from the game.
 */
export function WorldStage({
  children,
  menus,
}: {
  children: ReactNode;
  /**
   * GE-101: the view's compact menus (`GameplayMenus`), shown in the stage toolbar beside
   * "Full screen". Settings and exploration lists go here, not below the stage, so full screen
   * gives the whole viewport to the game.
   */
  menus?: ReactNode;
}) {
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

  // GE-090-D8: in full screen, anything left in flow below the stage lifts its
  // bottom edge, and the exits with it, above the viewport's bottom. Since
  // GE-101 settings and lists are stage menus, so the gap is normally 0; it is
  // still measured (and followed on resize) for whatever a view adds there.
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
      {/*
        GE-101: one toolbar, bottom left, over the canvas: "Full screen" (or "Exit full
        screen", always reachable while full screen) and the view's menus. The layer covers the
        stage so an open menu panel can size itself to the stage; only its buttons take pointers.
      */}
      {supported || menus ? (
        <div className={styles.toolbarLayer} data-stage-toolbar="">
          <div className={styles.toolbar}>
            {supported ? (
              <button
                type="button"
                className={styles.fullscreenButton}
                onClick={toggle}
                onKeyDown={(event) => event.stopPropagation()}
                aria-pressed={isFullscreen}
              >
                {isFullscreen ? 'Exit full screen' : 'Full screen'}
              </button>
            ) : null}
            {menus}
          </div>
        </div>
      ) : null}
    </div>
  );
}
