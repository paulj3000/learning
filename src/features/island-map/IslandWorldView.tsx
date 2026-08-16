import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Phaser from 'phaser';
import styles from './IslandWorldView.module.css';
import { PhaserGameContainer } from './PhaserGameContainer';
import { WorldEventBus } from './worldEvents';
import { WelcomeHarborScene, WORLD_HEIGHT, WORLD_WIDTH } from './scenes/WelcomeHarborScene';
import { findInteraction, WELCOME_HARBOR_INTERACTIONS } from './worldObjects';
import { listAllWorldChanges } from '../adventures/api';

interface IslandWorldViewProps {
  childId: string;
}

/**
 * The Phase 9 explorable Welcome Harbor prototype
 * (docs/ROADMAP.md Phase 9, docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 28). Deliberately additive: the existing card-based `WelcomeHarbor`
 * route is untouched and remains the primary, fully accessible way to reach
 * every location — this view is reached by an opt-in link and always offers
 * a way back to it, since walking must never be the only way to navigate
 * the island (roadmap section 42).
 */
export function IslandWorldView({ childId }: IslandWorldViewProps) {
  const [worldChangeKeys, setWorldChangeKeys] = useState<string[] | null>(null);
  const [triggeredInteractionId, setTriggeredInteractionId] = useState<string | null>(null);
  const bus = useMemo(() => new WorldEventBus(), []);

  useEffect(() => {
    let cancelled = false;
    listAllWorldChanges(childId)
      .then((changes) => {
        if (!cancelled) {
          setWorldChangeKeys(changes.map((change) => change.changeKey));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorldChangeKeys([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [childId]);

  useEffect(() => {
    const unsubscribe = bus.on('INTERACTION_TRIGGERED', ({ interactionId }) => {
      setTriggeredInteractionId(interactionId);
    });
    return () => {
      unsubscribe();
      bus.removeAllListeners();
    };
  }, [bus]);

  const triggeredInteraction = triggeredInteractionId
    ? findInteraction(WELCOME_HARBOR_INTERACTIONS, triggeredInteractionId)
    : undefined;

  if (worldChangeKeys === null) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading the island...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>
        Use the arrow keys or WASD to walk. On a touch screen, tap where you want to go.
      </p>
      <PhaserGameContainer
        instanceKey={childId}
        createConfig={(parent) => buildGameConfig(parent, bus, worldChangeKeys)}
      />
      {triggeredInteraction ? (
        <InteractionPanel
          childId={childId}
          interaction={triggeredInteraction}
          onDismiss={() => setTriggeredInteractionId(null)}
        />
      ) : null}
      <Link className={styles.altNavLink} to={`/island/${childId}`}>
        Prefer not to walk? Use the location list instead
      </Link>
    </div>
  );
}

function buildGameConfig(
  parent: HTMLDivElement,
  bus: WorldEventBus,
  worldChangeKeys: string[],
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    parent,
    backgroundColor: '#1c3a52',
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [new WelcomeHarborScene(bus, { worldChangeKeys })],
  };
}

interface InteractionPanelProps {
  childId: string;
  interaction: (typeof WELCOME_HARBOR_INTERACTIONS)[number];
  onDismiss: () => void;
}

function InteractionPanel({ childId, interaction, onDismiss }: InteractionPanelProps) {
  return (
    <div className={styles.panel} role="dialog" aria-label={interaction.title}>
      <h2 className={styles.panelTitle}>{interaction.title}</h2>
      <div className={styles.panelActions}>
        {interaction.action.kind === 'NAVIGATE' ? (
          <Link className={styles.goLink} to={`/island/${childId}/${interaction.action.to}`}>
            Go there
          </Link>
        ) : (
          <p>{interaction.action.message}</p>
        )}
        <button type="button" className={styles.dismissButton} onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
