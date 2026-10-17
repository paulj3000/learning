import { useMemo, useRef } from 'react';
import styles from '../IslandWorldView.module.css';
import { ThreeGameContainer } from './ThreeGameContainer';
import { createSandboxEngine, type SandboxEngine } from './sandboxScene';
import { useSandboxBridge } from './useSandboxBridge';
import { WorldEngineEventBus } from './worldEngineEvents';
import { useExplorableWorld } from '../useExplorableWorld';

interface ThreeSandboxWorldViewProps {
  childId: string;
}

/**
 * The Phase 31 Three.js sandbox (`docs/ROADMAP.md` Phase 31, ADR-008 in
 * `docs/DECISIONS.md`): an early, intentionally rough look at the
 * first-person world the island is migrating toward, not a finished
 * location. No learning objective or adventure template lives here yet —
 * Phase 32 is what turns this boundary into a real region. Deliberately
 * parallel to `PirateBuilderBayWorldView.tsx` (its own `WorldEventBus` +
 * a non-graphical alternate list of the same things the graphical scene
 * can do), the same pattern the Phaser side already uses.
 */
export function ThreeSandboxWorldView({ childId }: ThreeSandboxWorldViewProps) {
  const { context, noteCharacterMet } = useExplorableWorld(childId);
  const bus = useMemo(() => new WorldEngineEventBus(), []);
  useSandboxBridge(bus, noteCharacterMet);
  const engineRef = useRef<SandboxEngine | null>(null);

  if (context === null) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading the sandbox...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>
        This is an early look, not a full adventure yet. Move: WASD or the arrow keys. Look: click
        the screen, then move your mouse (or drag with two fingers on a touch screen: left side to
        move, right side to look). Walk up to Pip to say hello.
      </p>
      <ThreeGameContainer
        instanceKey={childId}
        createEngine={(parent) => createSandboxEngine(parent, bus)}
        onEngineReady={(engine) => {
          engineRef.current = engine;
        }}
      />
      <details className={styles.thingsToDo}>
        <summary>Things to do here</summary>
        <ul className={styles.thingsToDoList}>
          <li>
            <button
              type="button"
              className={styles.thingsToDoButton}
              onClick={() => noteCharacterMet('pirate-pip')}
            >
              Say hello to Pip
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.thingsToDoButton}
              onClick={() => engineRef.current?.interact()}
            >
              Interact with what you're looking at
            </button>
          </li>
        </ul>
      </details>
    </div>
  );
}
