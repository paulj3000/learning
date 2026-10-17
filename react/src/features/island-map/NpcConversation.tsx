import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './NpcConversation.module.css';
import { ConverseInteraction } from '../interaction/components/ConverseInteraction';
import { findNpc } from '../npc/content';
import { advanceDialogue, availableChoices, selectDialogueNode } from '../npc/dialogue';
import { recordDialogueNode } from '../npc/api';
import { timeOfDayForDate } from '../npc/schedule';
import type { DialogueNode, NpcContext, NpcDefinition, RelationshipLevel } from '../npc/types';
import { requestCompanionTurn } from '../companion/api';
import { getChildProfile } from '../child-profile/api';
import { buildQuestContext, listQuestStates, startQuest, syncQuestProgress } from '../quests/api';
import { QUEST_DEFINITIONS } from '../quests/content';
import {
  npcContextFromQuestContext,
  offerableQuests,
  questContextWithNpcState,
  type OfferableQuest,
} from '../quests/offers';
import type { QuestContext, QuestState } from '../quests/types';
import type { AgeBandValue } from '../child-profile/constants';

interface NpcConversationProps {
  childId: string;
  npcId: string;
  /** The child's own band; a character never asks for help with a quest outside it. */
  ageBand: AgeBandValue;
  /** Closes the world view's interaction panel when the child says goodbye. */
  onEnd: () => void;
}

/**
 * The conversation screen for one island character (docs/ROADMAP.md Phase 23
 * and Phase 25, shipped in the Phase 26.5 NPC Conversation UI).
 *
 * Three engines have been complete and unreachable behind this one component.
 * The NPC System (Phase 23) has decided what a character says since it was
 * built, the Interaction Library (Phase 22) has had a bounded `CONVERSE`
 * renderer, and the Quest Engine (Phase 25) has been able to run three quests
 * that nothing could start, because starting them meant a child talking to
 * Pip, Quill, or Bolt and there was no way to talk to anyone. This is that
 * way, and it is deliberately thin: every decision below is made by a pure
 * function in one of those engines, and nothing here authors copy, chooses a
 * line, or judges whether a quest may begin.
 *
 * Two properties are worth stating because they are load-bearing rather than
 * incidental:
 *
 * - **AI only where a designer opted in.** A node is re-voiced by Chatty
 *   only if it carries a `narration` hint (Phase 23's bounded contract,
 *   filled in here after Phase 27). Everything else renders as its authored
 *   text, and so does a narrated node whenever the call fails, the response
 *   is rejected, or a parent has AI switched off. What Chatty may say is
 *   bounded twice over: `allowedTopic` is the only topic sent, and
 *   `fallbackText` (the authored line itself) is sent as `authoredBaseText`,
 *   which the persona may rephrase but never contradict.
 * - **AI never changes what happens.** Which node is shown, which choices
 *   are offered, which flags are set, and whether a quest may be offered are
 *   all decided before any generation call and are never re-read from it.
 *   Re-voicing changes the wording of one line and nothing else.
 * - **No free text, ever.** Replies are the authored `DialogueChoice` list
 *   and nothing else, rendered by the Interaction Library's own bounded
 *   `CONVERSE` component, per CLAUDE.md section 2.
 */
export function NpcConversation({ childId, npcId, ageBand, onEnd }: NpcConversationProps) {
  const npc = findNpc(npcId);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [questContext, setQuestContext] = useState<QuestContext | null>(null);
  const [npcContext, setNpcContext] = useState<NpcContext | null>(null);
  const [questStates, setQuestStates] = useState<readonly QuestState[]>([]);
  const [node, setNode] = useState<DialogueNode | null>(null);
  const [friendshipLine, setFriendshipLine] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptedQuest, setAcceptedQuest] = useState<{ id: string; title: string } | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  /**
   * Chatty's re-voicing of the current node, or null for the authored line.
   * Fails closed: `aiEnabled` starts false and is only raised once the
   * profile actually says so, so a profile that cannot be read narrates
   * nothing rather than narrating against a parent's setting.
   */
  const [narratedText, setNarratedText] = useState<string | null>(null);
  /**
   * A ref rather than state on purpose. `showNode` is a dependency of the
   * load effect below, so making it depend on an `aiEnabled` *state* value
   * that the same effect sets would re-run the whole load - re-reading the
   * quest context and recording the opening node a second time. The ref is
   * written before the opening node is shown, so the first line is narrated
   * too.
   */
  const aiEnabledRef = useRef(false);
  /** The node a narration call was started for, so a slow reply cannot land on a later line. */
  const narratingNodeIdRef = useRef<string | null>(null);

  /**
   * Records that a node was shown, and folds what that changed back into both
   * contexts rather than reloading them.
   *
   * The fold matters for more than speed: Bolt's own quest offer is gated on
   * the `metBolt` flag his greeting sets, so without it a child would say
   * hello, be told nothing, and have to walk away and come back before he
   * could ask for help.
   */
  const showNode = useCallback(
    async (next: DialogueNode) => {
      setNode(next);
      setNarratedText(null);
      narratingNodeIdRef.current = next.id;
      if (next.narration && aiEnabledRef.current) {
        // Fire-and-forget, exactly like the adventure runner's companion
        // calls: the conversation is already on screen in its authored form,
        // and re-voicing is presentation that arrives or does not.
        void requestCompanionTurn({
          childProfileId: childId,
          ageBand,
          intent: 'NARRATE',
          stepSummary: next.narration.allowedTopic,
          authoredBaseText: next.narration.fallbackText,
          aiEnabled: true,
        }).then((result) => {
          if (narratingNodeIdRef.current !== next.id) return;
          if (result.source === 'AI') setNarratedText(result.turn.spokenText);
        });
      }
      try {
        const result = await recordDialogueNode(childId, npcId, next);
        setNpcContext((previous) =>
          previous
            ? {
                ...previous,
                memoryFlags: result.state.memoryFlags,
                relationshipLevel: result.relationshipLevel,
              }
            : previous,
        );
        setQuestContext((previous) =>
          previous
            ? questContextWithNpcState(
                previous,
                npcId,
                result.state.memoryFlags,
                result.state.relationshipPoints,
              )
            : previous,
        );
        if (result.levelIncreased) {
          setFriendshipLine(friendshipBeat(npc, result.relationshipLevel));
        }
      } catch {
        // A conversation that cannot be saved is still a conversation the
        // child gets to have. The alternative - an error where a character
        // should be - would be worse and would teach nothing.
      }
    },
    [childId, npcId, npc, ageBand],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!npc) {
        setLoadState('error');
        return;
      }
      try {
        const [context, states, child] = await Promise.all([
          buildQuestContext(childId),
          listQuestStates(childId),
          // Read here rather than threaded through eight world views: the
          // screen already loads its own context, and a failure to read it
          // must mean "no AI", which a missing prop could not guarantee.
          getChildProfile(childId).catch(() => null),
        ]);
        if (cancelled) return;
        aiEnabledRef.current = child?.aiEnabled ?? false;
        const forNpc = npcContextFromQuestContext(npc.id, context, timeOfDayForDate(new Date()));
        setQuestContext(context);
        setNpcContext(forNpc);
        setQuestStates(states);
        setLoadState('ready');
        const opening = selectDialogueNode(npc, forNpc);
        if (opening) void showNode(opening);
      } catch {
        if (!cancelled) setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId, npc, showNode]);

  async function handleChoice(choiceId: string) {
    if (!npc || !node || !npcContext) return;
    const choice = node.choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;
    const next = advanceDialogue(npc, choice, npcContext);
    if (!next) {
      // The end of the tree, and the point of the whole screen: whatever this
      // character can ask for is offered now, once the talking is done.
      setNode(null);
      return;
    }
    await showNode(next);
  }

  async function handleAccept(offer: OfferableQuest) {
    setBusy(true);
    setAcceptError(null);
    try {
      const state = await startQuest(childId, offer.definition);
      // Adding the new state is what takes the quest back out of `offers`:
      // `isQuestAvailable` is false for anything already started, so the
      // acceptance line below is what the child sees in its place.
      setQuestStates((previous) => [...previous, state]);
      setAcceptedQuest({ id: offer.definition.id, title: offer.definition.title });
      // The child may already have done the first thing the quest asks for,
      // most often by having just talked their way through this conversation.
      // Projecting straight away means the journal is right the moment they
      // open it, rather than one step behind (`syncQuestProgress`).
      await syncQuestProgress(childId).catch(() => undefined);
    } catch {
      setAcceptError('That did not save. You can try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  if (!npc || loadState === 'error') {
    return (
      <p className={styles.line}>
        {npc ? npc.displayName : 'Someone'} waves hello, but is too busy to talk just now.
      </p>
    );
  }

  if (loadState === 'loading') {
    return <p className={styles.line}>Walking over to say hello...</p>;
  }

  const choices = node && npcContext ? availableChoices(node, npcContext) : [];
  const offers =
    npcContext && questContext
      ? offerableQuests(npc, npcContext, QUEST_DEFINITIONS, questStates, questContext, ageBand)
      : [];

  return (
    <div className={styles.conversation}>
      {friendshipLine ? <p className={styles.friendship}>{friendshipLine}</p> : null}

      {node ? (
        choices.length > 0 ? (
          <ConverseInteraction
            prompt={narratedText ?? node.text}
            responses={choices.map((choice) => ({ id: choice.id, label: choice.label }))}
            disabled={busy}
            onSelect={(choiceId) => void handleChoice(choiceId)}
          />
        ) : (
          // An authored node with no choice the child qualifies for still gets
          // read out; it just ends the exchange, which is what an empty
          // `choices` array already means (`advanceDialogue`).
          <p className={styles.line}>{narratedText ?? node.text}</p>
        )
      ) : null}

      {node === null ? (
        <>
          {acceptedQuest ? (
            <p className={styles.line}>
              {acceptedQuest.title} is in your quest journal now.{' '}
              <Link className={styles.journalLink} to={`/island/${childId}/quests`}>
                Open the journal
              </Link>
            </p>
          ) : null}

          {offers.map((offer) => (
            <div className={styles.offer} key={offer.definition.id}>
              <p className={styles.offerSummary}>{offer.offer.summary}</p>
              <div className={styles.offerButtons}>
                <button
                  type="button"
                  className={styles.acceptButton}
                  disabled={busy}
                  onClick={() => void handleAccept(offer)}
                >
                  {busy ? 'One moment...' : 'Yes, I will help!'}
                </button>
              </div>
            </div>
          ))}

          {acceptError ? (
            <p className={styles.error} role="alert">
              {acceptError}
            </p>
          ) : null}

          <button type="button" className={styles.endButton} onClick={onEnd}>
            Goodbye for now
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * The one line a child sees when a friendship grows. Authored per step and
 * never a number, so the ladder reads as a character warming up rather than
 * as a score to raise (CLAUDE.md pillar 7, and `npc/relationship.ts`).
 */
function friendshipBeat(npc: NpcDefinition | null, level: RelationshipLevel): string | null {
  const name = npc?.displayName ?? 'Your friend';
  switch (level) {
    case 'STRANGER':
      return null;
    case 'ACQUAINTANCE':
      return `${name} remembers you now.`;
    case 'FRIEND':
      return `${name} is glad to see a friend.`;
    case 'TRUSTED_FRIEND':
      return `${name} trusts you with the important jobs.`;
  }
}
