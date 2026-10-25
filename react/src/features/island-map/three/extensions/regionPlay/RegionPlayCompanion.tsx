import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../../../auth/AuthContext';
import { tryParseRegionPlayConfig } from '../../../../region-play/regionPlayConfig';
import {
  chestStateChanges,
  resolveRegionPlayInteraction,
  type RegionPlayInteractionEvent,
} from '../../../../region-play/regionPlayInteractions';
import { useRegionPlay, type RegionPlayControls } from '../../../../region-play/useRegionPlay';
import type { LocationCompanionProps } from '../../runtime/viewExtensionRegistry';
import type { RegionPlaySceneApi } from './regionPlayScene';

/**
 * The React half of `region-play` (TR-7), mounted for the whole visit.
 *
 * - Starts or resumes the child's session once the region is loaded, and
 *   completes it at the calm stop. It never accepts a quest: Pip offers it
 *   and the child chooses (TR-D11).
 * - Keeps the chests in the scene matching the server: whenever the play
 *   state's region bootstrap changes, any chest drawn differently from the
 *   server's `isOpen` is changed through the scene half.
 * - Turns a claimed interaction (Pip, a chest) into a
 *   `RegionPlayInteractionEvent` and hands it, with the play controls, to
 *   `RegionPlayInteractionView`, the one component TR-8 replaces with the
 *   conversation and the challenge card.
 */

export interface RegionPlayInteractionViewProps {
  event: RegionPlayInteractionEvent;
  controls: RegionPlayControls;
  onClose(): void;
}

/** Child-facing copy for the TR-7 notice. Readable aloud, localizable. */
export const REGION_PLAY_NOTICE_COPY = {
  questOffer: 'has a quest for you.',
  noQuest: 'waves hello.',
  chestOpen: 'This chest is already open.',
  chestNotReady: 'This chest is not ready yet.',
  chestLocked: 'This chest is locked with a number puzzle.',
  close: 'Close',
} as const;

/**
 * TR-7's stand-in for the TR-8 UI: says what the child found and nothing
 * more. It has no answer buttons and cannot change anything.
 */
export function RegionPlayInteractionView({ event, onClose }: RegionPlayInteractionViewProps) {
  const copy = REGION_PLAY_NOTICE_COPY;
  let message: string;
  if (event.kind === 'npc') {
    const offering = event.quests.some((quest) => quest.status === 'AVAILABLE');
    message = `${event.label} ${offering ? copy.questOffer : copy.noQuest}`;
  } else if (event.isOpen) {
    message = copy.chestOpen;
  } else if (!event.challengeAvailable) {
    message = copy.chestNotReady;
  } else {
    message = copy.chestLocked;
  }
  return (
    <div role="status" aria-live="polite" data-region-play-event={event.kind}>
      <p>{message}</p>
      <button type="button" onClick={onClose}>
        {copy.close}
      </button>
    </div>
  );
}

export function RegionPlayCompanion(props: LocationCompanionProps) {
  const {
    childId,
    regionId,
    config,
    sceneApi,
    claimedInteraction,
    limitReached,
    onCloseInteraction,
  } = props;
  const auth = useAuth();
  const parsed = useMemo(() => tryParseRegionPlayConfig(config), [config]);
  const controls = useRegionPlay(childId, regionId, {
    onUnauthenticated: () => void auth.refresh(),
  });
  const { state, startSession, changeSession } = controls;

  // Enter: start or resume once per child and region, after the region loads.
  const startedFor = useRef<string | null>(null);
  const scope = `${childId}/${regionId}`;
  useEffect(() => {
    if (state.status !== 'ready' || state.session || startedFor.current === scope) return;
    startedFor.current = scope;
    void startSession();
  }, [scope, startSession, state.session, state.status]);

  // The calm stop ends the session; the room stays as it is.
  const sessionStatus = state.session?.status;
  useEffect(() => {
    if (limitReached && sessionStatus) void changeSession('complete');
  }, [changeSession, limitReached, sessionStatus]);

  // Chest appearance follows the server, never the interaction.
  const chests = state.bootstrap?.chests;
  useEffect(() => {
    const api = sceneApi as RegionPlaySceneApi | null;
    if (!api || !chests) return;
    const drawn = new Map<string, boolean>();
    for (const chest of chests) {
      const open = api.isChestOpen(chest.entityId);
      if (open !== undefined) drawn.set(chest.entityId, open);
    }
    for (const change of chestStateChanges(
      drawn,
      chests.filter((c) => drawn.has(c.entityId)),
    )) {
      api.setChestOpen(change.entityId, change.isOpen);
    }
  }, [chests, sceneApi]);

  const event =
    parsed && claimedInteraction && state.bootstrap
      ? resolveRegionPlayInteraction(
          parsed,
          state.bootstrap,
          claimedInteraction.id,
          state.session !== null,
        )
      : null;

  return event ? (
    <RegionPlayInteractionView event={event} controls={controls} onClose={onCloseInteraction} />
  ) : null;
}
