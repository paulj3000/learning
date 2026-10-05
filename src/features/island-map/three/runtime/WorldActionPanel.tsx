import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from '../../IslandWorldView.module.css';
import { DiscoveryAction } from '../../DiscoveryAction';
import { NpcConversation } from '../../NpcConversation';
import type { WorldAction, WorldInteraction } from '../../worldObjects';
import { resumeOrStartSession } from '../../../adventures/api';
import { resolveAdventureForAgeBand } from '../../../adventures/content';
import { adventureStartErrorMessage } from '../../../catalog/availabilityApi';
import type { AgeBandValue } from '../../../child-profile/constants';

/**
 * The one dialog that turns a `WorldInteraction` into UI for a
 * manifest-driven location (`docs/engine/10_IMPLEMENTATION_PHASES.md`
 * Phase 4). It replaces the `InteractionPanel`/`InteractionPanelAction` pair
 * that Pirate Builder Bay, Wonderwild Forest and Storykeeper Castle each
 * carry a copy of; those views keep their copies until they migrate.
 *
 * Every branch hands off to the system that owns the meaning: the NPC
 * System for `TALK_TO`, the Discovery Engine for `DISCOVER`, the Adventure
 * Engine (through `resumeOrStartSession`, the single start path that
 * enforces catalog availability) for `START_ADVENTURE`, and the Story
 * Engine's own page for `START_STORY`. Nothing here grades, rewards or
 * records progress itself.
 */
export interface WorldActionPanelProps {
  childId: string;
  ageBand: AgeBandValue;
  interaction: WorldInteraction;
  onDismiss: () => void;
  /** Called after a discovery is recorded, so the view can refresh what is available. */
  onDiscovered: () => void;
}

export function WorldActionPanel({
  childId,
  ageBand,
  interaction,
  onDismiss,
  onDiscovered,
}: WorldActionPanelProps) {
  return (
    <div className={styles.panel} role="dialog" aria-label={interaction.title}>
      <h2 className={styles.panelTitle}>{interaction.title}</h2>
      <div className={styles.panelActions}>
        <WorldActionBody
          childId={childId}
          ageBand={ageBand}
          action={interaction.action}
          onDiscovered={onDiscovered}
          onDismiss={onDismiss}
        />
        <button type="button" className={styles.dismissButton} onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

interface WorldActionBodyProps {
  childId: string;
  ageBand: AgeBandValue;
  action: WorldAction;
  onDiscovered: () => void;
  onDismiss: () => void;
}

function WorldActionBody({
  childId,
  ageBand,
  action,
  onDiscovered,
  onDismiss,
}: WorldActionBodyProps) {
  switch (action.kind) {
    case 'NAVIGATE':
      return (
        <Link className={styles.goLink} to={`/island/${childId}/${action.to}`}>
          Go there
        </Link>
      );
    case 'SHOW_MESSAGE':
      return <p>{action.message}</p>;
    case 'DISCOVER':
      return (
        <DiscoveryAction
          childId={childId}
          discoveryId={action.discoveryId}
          onDiscovered={onDiscovered}
        />
      );
    case 'TALK_TO':
      return (
        <NpcConversation
          childId={childId}
          npcId={action.npcId}
          ageBand={ageBand}
          onEnd={onDismiss}
        />
      );
    case 'START_STORY':
      // The Story Engine's own page: the same `ChildStoryProgress` the
      // Adventure Library opens, so this is a second entry point, never a
      // second copy (ADR-019).
      return (
        <Link className={styles.goLink} to={`/island/${childId}/stories/${action.storySlug}`}>
          Open the story
        </Link>
      );
    case 'START_ADVENTURE':
      return (
        <StartAdventureButton
          childId={childId}
          ageBand={ageBand}
          locationSlug={action.locationSlug}
          templateSlug={action.templateSlug}
        />
      );
  }
}

interface StartAdventureButtonProps {
  childId: string;
  ageBand: AgeBandValue;
  locationSlug: string;
  templateSlug: string;
}

function StartAdventureButton({
  childId,
  ageBand,
  locationSlug,
  templateSlug,
}: StartAdventureButtonProps) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One authored spot serves every age band (`resolveAdventureForAgeBand`).
  const definition = resolveAdventureForAgeBand(locationSlug, templateSlug, ageBand);
  if (!definition) {
    return <p>This adventure is not available for your age yet.</p>;
  }
  const resolved = definition;

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      await resumeOrStartSession(childId, resolved);
      navigate(`/island/${childId}/locations/${locationSlug}/adventures/${resolved.slug}`);
    } catch (startError) {
      setError(adventureStartErrorMessage(startError));
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
