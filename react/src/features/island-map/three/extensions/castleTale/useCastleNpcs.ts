import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PlaySession, SessionStatus } from '../../../../../api/play/types';
import { prefersReducedMotion } from '../../../../../lib/motionPreference';
import type { AgeBandValue } from '../../../../child-profile/constants';
import {
  useNpcSceneHost,
  type NpcSceneHost,
  type NpcSceneHostDeps,
} from '../../../../npc-manager/host';
import type { WorldInteraction } from '../../../worldObjects';
import { handOverCastleNpcs, managedCastleNpcFor } from './castleNpcHandover';
import { acceptLegacyQuest, recordLegacyMeeting } from './castleNpcProgress';
import type { AnimationState } from '../../../../npc-manager/contracts/vocabulary';
import type { CastleQuillClip, CastleTaleSceneApi } from './castleTaleScene';

/** The castle's scripted Quill clips as NPC Manager animation states (contract section 6). */
export const QUILL_CLIP_STATES: Readonly<Record<CastleQuillClip, AnimationState>> = {
  Idle: 'idle',
  Talk: 'talk',
  Point: 'point',
  ReactConcerned: 'sad',
  Celebrate: 'celebrate',
};
const QUILL_NPC_ID = 'keeper-quill';

/** The castle is a Place in Django (no 3D Area), so the host asks the Place route. */
export const CASTLE_PLACE_SLUG = 'storykeeper-castle';

/** A manifest NPC the NPC Manager may serve instead. */
export interface CastleNpcHandover {
  entityId: string;
  npcId: string;
}

export interface UseCastleNpcsOptions {
  childId: string;
  ageBand: AgeBandValue;
  scene: CastleTaleSceneApi | null;
  handovers: readonly CastleNpcHandover[];
  claimedInteraction: WorldInteraction | null;
  onCloseInteraction(): void;
  /** Another panel (the tale, the story, a generic panel) is on screen. */
  suspended: boolean;
  /** Tests only. */
  deps?: NpcSceneHostDeps;
}

export interface CastleNpcs {
  host: NpcSceneHost;
  /** The tale began here (`resumed` false) or a session left open was picked up again. */
  notifyTaleStarted(resumed: boolean, templateSlug: string): void;
  /** The tale's session completed: Quill celebrates and says his "story told" line. */
  notifyTaleCompleted(templateSlug: string): void;
}

/**
 * Storykeeper's Castle on the NPC Manager (LAI-NPC-039): the same `useNpcSceneHost` Treasure
 * Cove uses, given the castle scene and the Place scope, plus the castle's half of the Pip
 * pattern. Nothing here is castle-specific NPC management; it is wiring.
 *
 * - **Exactly one Quill.** While the host serves a character, its manifest NPC is handed over
 *   (`setNpcProxy`: hidden, its focusable root following the managed one) and its `TALK_TO`
 *   interaction is claimed (`castleNpcHandover.ts`), so the managed conversation opens and the
 *   legacy `NpcConversation` does not. When the host serves nothing (no release, Django off, a
 *   failed load) nothing is handed over or claimed: the legacy Quill is unchanged.
 * - **Progression kept.** Talking first records what the legacy conversation recorded, and an
 *   `OFFER_QUEST` choice accepts through the castle's existing quest flow
 *   (`castleNpcProgress.ts`).
 * - **Adventure signals.** The tale starting, resuming and completing become the host's play
 *   outcomes (`notifyPlay`), so Quill reacts and the published lines for those triggers play
 *   once nothing else is on screen. Observation only: the Adventure Engine still decides all.
 */
export function useCastleNpcs(options: UseCastleNpcsOptions): CastleNpcs {
  const { childId, ageBand, scene, handovers, claimedInteraction, onCloseInteraction } = options;
  const npcScene = useMemo(() => scene?.npcHostScene?.() ?? null, [scene]);

  const onInteract = useCallback((npcId: string) => recordLegacyMeeting(childId, npcId), [childId]);
  const onQuestOffer = useCallback(
    (questId: string, npcId: string) => {
      void acceptLegacyQuest(childId, questId, npcId, ageBand);
    },
    [childId, ageBand],
  );
  const host = useNpcSceneHost({
    childId,
    scope: { kind: 'place', placeSlug: CASTLE_PLACE_SLUG },
    scene: npcScene,
    reducedMotion: prefersReducedMotion(),
    suspended: options.suspended,
    onInteract,
    onQuestOffer,
    ...(options.deps ? { deps: options.deps } : {}),
  });
  const hostRef = useRef(host);
  hostRef.current = host;
  const { managedNpcIds, notifyPlay } = host;

  // Exactly one Quill: a manifest NPC the host serves is handed over, and its talk is claimed.
  useEffect(() => {
    const served = handovers.filter((handover) => managedNpcIds.has(handover.npcId));
    if (served.length === 0) return undefined;
    const release = handOverCastleNpcs(served.map((handover) => handover.npcId));
    for (const { entityId, npcId } of served) {
      scene?.setNpcProxy?.(entityId, () => hostRef.current.positionOf(npcId));
    }
    // The castle's own gestures (hint pointing, concern, celebration) reach the managed Quill.
    const quillServed = served.some((handover) => handover.npcId === QUILL_NPC_ID);
    if (quillServed) {
      scene?.setQuillGestureSink?.((clip, facingYaw) => {
        hostRef.current.animate(QUILL_NPC_ID, QUILL_CLIP_STATES[clip], { facingYaw });
      });
    }
    return () => {
      release();
      for (const { entityId } of served) scene?.setNpcProxy?.(entityId, null);
      if (quillServed) scene?.setQuillGestureSink?.(null);
    };
  }, [scene, handovers, managedNpcIds]);

  // A claimed talk to a managed character opens the managed conversation, once per claim.
  const handledFor = useRef<WorldInteraction | null>(null);
  const suspendedRef = useRef(options.suspended);
  suspendedRef.current = options.suspended;
  useEffect(() => {
    if (!claimedInteraction || handledFor.current === claimedInteraction) return;
    const npcId = managedCastleNpcFor(claimedInteraction);
    if (!npcId) return;
    handledFor.current = claimedInteraction;
    // Mid-tale the tale's own card is the conversation; the tap is let go calmly.
    if (!suspendedRef.current) hostRef.current.interact(npcId, 'pointer');
    onCloseInteraction();
  }, [claimedInteraction, onCloseInteraction]);

  const notifyTaleStarted = useCallback(
    (resumed: boolean, templateSlug: string) =>
      notifyPlay({
        kind: 'session_upserted',
        result: { value: castleSession('ACTIVE', templateSlug), created: !resumed },
      }),
    [notifyPlay],
  );
  const notifyTaleCompleted = useCallback(
    (templateSlug: string) =>
      notifyPlay({ kind: 'session_changed', session: castleSession('COMPLETED', templateSlug) }),
    [notifyPlay],
  );

  return { host, notifyTaleStarted, notifyTaleCompleted };
}

/**
 * The castle's adventure session as a play outcome. Only `status` and `created` are read
 * (`signalsFromPlay`); the castle's session ids stay with the Adventure Engine.
 */
function castleSession(status: SessionStatus, templateSlug: string): PlaySession {
  return {
    sessionId: '',
    kind: 'ADVENTURE',
    regionId: CASTLE_PLACE_SLUG,
    templateSlug,
    locationSlug: CASTLE_PLACE_SLUG,
    status,
    startedAt: '',
    lastActivityAt: '',
    completedAt: null,
  };
}
