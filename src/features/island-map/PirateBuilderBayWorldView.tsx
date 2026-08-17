import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import styles from './IslandWorldView.module.css';
import { PhaserGameContainer } from './PhaserGameContainer';
import { WorldEventBus } from './worldEvents';
import { PirateBuilderBayScene, WORLD_HEIGHT, WORLD_WIDTH } from './scenes/PirateBuilderBayScene';
import {
  findInteraction,
  isInteractionAvailable,
  PIRATE_BUILDER_BAY_INTERACTIONS,
  type WorldAction,
} from './worldObjects';
import { listAllWorldChanges, resumeOrStartSession } from '../adventures/api';
import { getAdventureTemplate } from '../adventures/content';

interface PirateBuilderBayWorldViewProps {
  childId: string;
  /** The child's already-chosen `ChildProfile.avatarKey`, resolved by the caller (`PirateBuilderBayWorldPage`). */
  avatarKey: string;
}

/**
 * Pirate Builder Bay's Phase 11 explorable environment
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 30):
 * the first fully spatial adventure location. Deliberately parallel to
 * `IslandWorldView` (Welcome Harbor's Phase 9/10 equivalent) rather than a
 * shared component — each location's world view is a small amount of wiring
 * around a shared `PhaserGameContainer`/`LocationScene` engine plus its own
 * interaction list, so duplicating this wiring is cheaper and safer than
 * threading a third config prop through the one already-shipped, tested
 * Welcome Harbor view. The "Things to do here" list offers the same
 * interactions as walking around, so graphical movement is never the only
 * way to use this screen (roadmap section 42).
 */
export function PirateBuilderBayWorldView({ childId, avatarKey }: PirateBuilderBayWorldViewProps) {
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
    ? findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, triggeredInteractionId)
    : undefined;

  const availableInteractions = useMemo(
    () =>
      worldChangeKeys === null
        ? []
        : PIRATE_BUILDER_BAY_INTERACTIONS.filter((interaction) =>
            isInteractionAvailable(interaction, { worldChangeKeys }),
          ),
    [worldChangeKeys],
  );

  if (worldChangeKeys === null) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading Pirate Builder Bay...</p>
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
        createConfig={(parent) => buildGameConfig(parent, bus, worldChangeKeys, avatarKey)}
      />
      {triggeredInteraction ? (
        <InteractionPanel
          childId={childId}
          interaction={triggeredInteraction}
          onDismiss={() => setTriggeredInteractionId(null)}
        />
      ) : null}
      <details className={styles.thingsToDo}>
        <summary>Things to do here</summary>
        <ul className={styles.thingsToDoList}>
          {availableInteractions.map((interaction) => (
            <li key={interaction.id}>
              <button
                type="button"
                className={styles.thingsToDoButton}
                onClick={() => setTriggeredInteractionId(interaction.id)}
              >
                {interaction.title}
              </button>
            </li>
          ))}
        </ul>
      </details>
      <Link className={styles.altNavLink} to={`/island/${childId}/locations/pirate-builder-bay`}>
        Prefer not to walk? Use the location page instead
      </Link>
    </div>
  );
}

function buildGameConfig(
  parent: HTMLDivElement,
  bus: WorldEventBus,
  worldChangeKeys: string[],
  avatarKey: string,
): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    parent,
    backgroundColor: '#1c3a52',
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [new PirateBuilderBayScene(bus, { worldChangeKeys }, avatarKey)],
  };
}

interface InteractionPanelProps {
  childId: string;
  interaction: (typeof PIRATE_BUILDER_BAY_INTERACTIONS)[number];
  onDismiss: () => void;
}

function InteractionPanel({ childId, interaction, onDismiss }: InteractionPanelProps) {
  return (
    <div className={styles.panel} role="dialog" aria-label={interaction.title}>
      <h2 className={styles.panelTitle}>{interaction.title}</h2>
      <div className={styles.panelActions}>
        <InteractionPanelAction childId={childId} action={interaction.action} />
        <button type="button" className={styles.dismissButton} onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

interface InteractionPanelActionProps {
  childId: string;
  action: WorldAction;
}

/**
 * Resolves one `WorldAction` into UI. `START_ADVENTURE` is the world event
 * bus actually driving the deterministic Adventure Engine (roadmap section
 * 8): it creates or resumes the session before navigating, rather than only
 * linking to a route.
 */
function InteractionPanelAction({ childId, action }: InteractionPanelActionProps) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (action.kind === 'NAVIGATE') {
    return (
      <Link className={styles.goLink} to={`/island/${childId}/${action.to}`}>
        Go there
      </Link>
    );
  }

  if (action.kind === 'SHOW_MESSAGE') {
    return <p>{action.message}</p>;
  }

  const startAdventureAction = action;

  async function handleStart() {
    const definition = getAdventureTemplate(startAdventureAction.templateSlug);
    if (!definition) {
      setError('This adventure is not available right now.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      await resumeOrStartSession(childId, definition);
      navigate(
        `/island/${childId}/locations/${startAdventureAction.locationSlug}/adventures/${startAdventureAction.templateSlug}`,
      );
    } catch {
      setError('Something went wrong starting the adventure. Please try again.');
      setStarting(false);
    }
  }

  return (
    <>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={styles.goLink}
        onClick={() => void handleStart()}
        disabled={starting}
      >
        {starting ? 'Starting...' : 'Start the adventure'}
      </button>
    </>
  );
}
