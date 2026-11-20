import type { ReactNode } from 'react';
import { useEngineRuntime, type UseEngineRuntimeOptions } from './useEngineRuntime';
import { DEFAULT_GAME_HOST_MESSAGES, type GameHostMessages } from './hostTypes';
import styles from './GameHost.module.css';

export interface GameHostProps extends UseEngineRuntimeOptions {
  /** Accessible name of the scene region (already localized). */
  label: string;
  /** Localized message catalog; missing keys fall back to the English defaults. */
  messages?: Partial<GameHostMessages>;
  /** Non-graphical alternative to the canvas, read by assistive technology. */
  fallback?: ReactNode;
  className?: string;
  /** Overlays (HUD, debug panels) drawn over the canvas. */
  children?: ReactNode;
}

/**
 * React host for the Game Engine Core: a canvas container plus loading, error and ready
 * states. React stays the presentation layer; the engine owns the scene. The canvas is
 * `aria-hidden`, so the region carries an accessible name and a text alternative
 * (docs/UX_AND_ACCESSIBILITY.md). Errors show only a safe child-facing message, never an
 * error message or stack.
 */
export function GameHost({ label, messages, fallback, className, children, ...options }: GameHostProps) {
  const { containerRef, status, errorKey, paused, retry } = useEngineRuntime(options);
  const text = { ...DEFAULT_GAME_HOST_MESSAGES, ...messages };

  return (
    <section
      className={[styles.host, className].filter(Boolean).join(' ')}
      role="region"
      aria-label={label}
      aria-busy={status === 'loading'}
      data-status={status}
      data-paused={paused ? 'true' : 'false'}
    >
      <div ref={containerRef} className={styles.canvasMount} data-testid="game-host-canvas" />
      <div className={styles.srOnly}>{fallback ?? text['gameHost.fallback']}</div>
      {status === 'loading' ? (
        <p className={styles.overlay} role="status">
          {text['gameHost.loading']}
        </p>
      ) : null}
      {status === 'error' && errorKey ? (
        <div className={styles.overlay} role="alert">
          <p>{text[errorKey]}</p>
          <button type="button" className={styles.retry} onClick={retry}>
            {text['gameHost.retry']}
          </button>
        </div>
      ) : null}
      {paused ? (
        <p className={styles.overlay} role="status">
          {text['gameHost.paused']}
        </p>
      ) : null}
      {status === 'ready' ? children : null}
    </section>
  );
}
