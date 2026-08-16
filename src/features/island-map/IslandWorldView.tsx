import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import styles from './IslandWorldView.module.css';
import { PhaserGameContainer } from './PhaserGameContainer';
import { WorldEventBus } from './worldEvents';
import { WelcomeHarborScene, WORLD_HEIGHT, WORLD_WIDTH } from './scenes/WelcomeHarborScene';
import {
  findInteraction,
  isInteractionAvailable,
  WELCOME_HARBOR_INTERACTIONS,
  type WorldAction,
} from './worldObjects';
import { listAllWorldChanges, resumeOrStartSession } from '../adventures/api';
import { getAdventureTemplate } from '../adventures/content';

interface IslandWorldViewProps {
  childId: string;
  /** The child's already-chosen `ChildProfile.avatarKey`, resolved by the caller (`IslandWorldPage`). */
  avatarKey: string;
}

/**
 * The Phase 9 explorable Welcome Harbor
 * (docs/ROADMAP.md Phase 9, docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 28). Deliberately additive: the existing card-based `WelcomeHarbor`
 * route is untouched and remains a fully accessible way to reach every
 * location. Within this view itself, the "Things to do here" list
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 42)
 * offers the same interactions as walking around, so graphical movement is
 * never the only way to use this screen.
 */
export function IslandWorldView({ childId, avatarKey }: IslandWorldViewProps) {
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

  const availableInteractions = useMemo(
    () =>
      worldChangeKeys === null
        ? []
        : WELCOME_HARBOR_INTERACTIONS.filter((interaction) =>
            isInteractionAvailable(interaction, { worldChangeKeys }),
          ),
    [worldChangeKeys],
  );

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
    scene: [new WelcomeHarborScene(bus, { worldChangeKeys }, avatarKey)],
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
