import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import styles from './PhaserGameContainer.module.css';

export interface PhaserGameContainerProps {
  /**
   * Builds the game config for this mount. Read once, on mount, and never
   * again for the lifetime of a given `instanceKey` — the boundary
   * deliberately does not recreate `Phaser.Game` on unrelated React
   * re-renders (docs/ROADMAP.md Phase 9). Pass a new `instanceKey` (for
   * example, a scene/location id) to intentionally tear down and rebuild
   * the game.
   */
  createConfig: (parent: HTMLDivElement) => Phaser.Types.Core.GameConfig;
  instanceKey?: string | number;
  className?: string;
}

/**
 * Owns the `Phaser.Game` lifecycle so nothing else in the app has to. The
 * canvas Phaser renders into is not meaningfully representable to assistive
 * technology, so it is `aria-hidden`; every world view built on top of this
 * must offer a non-graphical alternate (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 42, "must not make graphical movement the only way to use the
 * application").
 */
export function PhaserGameContainer({
  createConfig,
  instanceKey,
  className,
}: PhaserGameContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const createConfigRef = useRef(createConfig);
  createConfigRef.current = createConfig;

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) {
      return;
    }
    const config = createConfigRef.current(parent);
    const game = new Phaser.Game({ ...config, parent });
    return () => {
      game.destroy(true);
    };
    // instanceKey intentionally controls recreation; createConfig is read
    // through a ref so changing the callback identity alone does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceKey]);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${className ?? ''}`.trim()}
      aria-hidden="true"
    />
  );
}
