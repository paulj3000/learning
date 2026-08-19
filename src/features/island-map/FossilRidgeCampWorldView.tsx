import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Phaser from 'phaser';
import styles from './IslandWorldView.module.css';
import { PhaserGameContainer } from './PhaserGameContainer';
import { WorldEventBus } from './worldEvents';
import { FossilRidgeCampScene, WORLD_HEIGHT, WORLD_WIDTH } from './scenes/FossilRidgeCampScene';
import {
  findInteraction,
  isInteractionAvailable,
  FOSSIL_RIDGE_CAMP_INTERACTIONS,
  type WorldAction,
} from './worldObjects';
import { listAllWorldChanges, resumeOrStartSession } from '../adventures/api';
import { getAdventureTemplate } from '../adventures/content';
import { isLocationUnlocked } from '../island/locations';

const UNLOCK_REQUIREMENT = { changeKey: 'DINOSAUR_EXPEDITION_COMPLETE' };

interface FossilRidgeCampWorldViewProps {
  childId: string;
  /** The child's already-chosen `ChildProfile.avatarKey`, resolved by the caller (`FossilRidgeCampWorldPage`). */
  avatarKey: string;
}

/**
 * Fossil Ridge Camp's Phase 16 explorable environment (docs/ROADMAP.md
 * Phase 16, "Island Progression"), same shape as
 * `DragonsSanctuaryWorldView.tsx` — see that file's header comment for why
 * this is a small parallel view rather than a shared one, and for the
 * direct-URL unlock guard this location also needs.
 */
export function FossilRidgeCampWorldView({ childId, avatarKey }: FossilRidgeCampWorldViewProps) {
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
    ? findInteraction(FOSSIL_RIDGE_CAMP_INTERACTIONS, triggeredInteractionId)
    : undefined;

  const availableInteractions = useMemo(
    () =>
      worldChangeKeys === null
        ? []
        : FOSSIL_RIDGE_CAMP_INTERACTIONS.filter((interaction) =>
            isInteractionAvailable(interaction, { worldChangeKeys }),
          ),
    [worldChangeKeys],
  );

  if (worldChangeKeys === null) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading Fossil Ridge Camp...</p>
      </div>
    );
  }

  if (!isLocationUnlocked({ unlockRequirement: UNLOCK_REQUIREMENT }, worldChangeKeys)) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>
          This part of the island has not been discovered yet. Maybe a new story will lead you here.
        </p>
        <Link className={styles.altNavLink} to={`/island/${childId}`}>
          Back to the map
        </Link>
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
      <Link className={styles.altNavLink} to={`/island/${childId}/locations/fossil-ridge-camp`}>
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
    backgroundColor: '#c9a86a',
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [new FossilRidgeCampScene(bus, { worldChangeKeys }, avatarKey)],
  };
}

interface InteractionPanelProps {
  childId: string;
  interaction: (typeof FOSSIL_RIDGE_CAMP_INTERACTIONS)[number];
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
 * Resolves one `WorldAction` into UI. `START_ADVENTURE` is unused by this
 * location's own interactions today, but kept here (rather than a narrower
 * action union) so this view stays a drop-in match for every other
 * location's `*WorldView`, matching their own already-shipped precedent.
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
