import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import styles from './GameplayMenus.module.css';

/**
 * One compact menu on the gameplay stage (GE-101, `docs/engineering/game-engine/gameplay-ui-contract.md`).
 * Its button sits in the stage toolbar beside "Full screen"; its panel opens over the canvas.
 */
export interface GameplayMenu {
  /** Stable id, e.g. `explore` or `settings`. */
  id: string;
  /** The button's accessible name and visible text (visible from 600px wide). */
  label: string;
  /** A decorative glyph shown on the button; never the only name. */
  icon: string;
  /** The panel's heading. */
  title: string;
  /** The panel body; a function gets `close`, for an item that starts something (a dialogue). */
  content: ReactNode | ((close: () => void) => ReactNode);
}

/**
 * The stage's menu buttons and their panels: closed by default, at most one open, Escape or
 * "Close" shuts it and gives focus back to its button. The panel overlays the canvas, so opening
 * one never resizes the stage, and nothing here touches the engine: no camera reset, no reload.
 *
 * Key presses inside the toolbar and its panels stay there. The engine listens on `window` and
 * would otherwise take Space on a focused button as a jump (and cancel the button's own press),
 * or arrow keys on a list as walking. Key releases still reach it, so no key is left held.
 */
export function GameplayMenus({
  menus,
  suspended = false,
}: {
  menus: readonly GameplayMenu[];
  /**
   * True while a dialogue, puzzle or interaction panel is open: an open menu closes, so the
   * child sees one panel at a time. Focus is left to that panel.
   */
  suspended?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const open = menus.find((menu) => menu.id === openId) ?? null;

  // A menu that stops applying (e.g. camera switching turned off) closes rather than lingering.
  useEffect(() => {
    if (openId !== null && open === null) setOpenId(null);
  }, [openId, open]);

  useEffect(() => {
    if (suspended) setOpenId(null);
  }, [suspended]);

  // Keyed on the id: the view rebuilds `menus` on every render, and refocusing the panel then
  // would pull focus off the radio or button the child just used.
  const shownId = open?.id ?? null;
  useEffect(() => {
    if (shownId !== null) panelRef.current?.focus();
  }, [shownId]);

  const close = useCallback(() => {
    const id = openId;
    setOpenId(null);
    if (id !== null) buttons.current.get(id)?.focus();
  }, [openId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  };

  if (menus.length === 0) return null;
  return (
    <div className={styles.menus} role="group" aria-label="Game menus" onKeyDown={onKeyDown}>
      {menus.map((menu) => {
        const expanded = menu.id === openId;
        return (
          <button
            key={menu.id}
            ref={(element) => {
              if (element) buttons.current.set(menu.id, element);
              else buttons.current.delete(menu.id);
            }}
            type="button"
            className={styles.menuButton}
            aria-expanded={expanded}
            aria-controls={expanded ? `${baseId}-${menu.id}` : undefined}
            data-gameplay-menu={menu.id}
            onClick={() => setOpenId(expanded ? null : menu.id)}
          >
            <span aria-hidden="true">{menu.icon}</span>
            <span className={styles.menuLabel}>{menu.label}</span>
          </button>
        );
      })}
      {open ? (
        <div
          ref={panelRef}
          id={`${baseId}-${open.id}`}
          className={styles.panel}
          role="dialog"
          aria-labelledby={`${baseId}-${open.id}-title`}
          tabIndex={-1}
          data-gameplay-panel={open.id}
        >
          <div className={styles.panelHeader}>
            <h2 id={`${baseId}-${open.id}-title`} className={styles.panelTitle}>
              {open.title}
            </h2>
            <button type="button" className={styles.closeButton} onClick={close}>
              Close
            </button>
          </div>
          <div className={styles.panelBody}>
            {typeof open.content === 'function' ? open.content(close) : open.content}
          </div>
        </div>
      ) : null}
    </div>
  );
}
