import * as amplify from './amplify/npc';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read, type Reader } from './parse';
import { optionalQuestUpdates, type QuestUpdateView } from './questUpdates';
import { NO_REWARDS, parseRewardOutcome, type RewardOutcome } from './rewards';
import { selectApi, unsupported } from './select';
import type { RelationshipLevel } from '../features/npc/types';

export type { ChildNpcState, RecordDialogueResult } from './amplify/npc';

/**
 * NPC relationships and conversations.
 *
 * - Amplify: the client picks dialogue nodes from its bundled content and records them
 *   (`recordDialogueNode`), and keeps relationship points and memory flags itself.
 * - Django (LAI-0605): the server picks the node. `talkToNpc` asks for the entry node and
 *   `chooseNpcDialogue` follows a choice from a node already shown. The server applies flags,
 *   points, quest progress and NPC_RELATIONSHIP rewards in the same request. `listNpcs` reads
 *   each NPC with the child's relationship level. The Amplify-shaped operations (the client
 *   choosing a node, reading raw points and flags) are `npc_unavailable` there.
 *
 * `talkToNpc`, `chooseNpcDialogue` and `listNpcs` are Django contracts: on Amplify they are
 * `npc_unavailable`, and Amplify screens keep `recordDialogueNode`.
 */
export interface NpcView {
  npcId: string;
  displayName: string;
  role: string;
  homeLocationSlug: string;
  interactionId: string;
  relationship: { level: RelationshipLevel; met: boolean; lastInteractedAt: string | null };
}

export interface DialogueNodeView {
  id: string;
  text: string;
  /** Only the choices available to this child now. */
  choices: Array<{ id: string; label: string }>;
}

/** One conversation turn: the node to show (null: nothing to say, or the talk ended). */
export interface DialogueTurn {
  npcId: string;
  node: DialogueNodeView | null;
  relationship: { level: RelationshipLevel; levelIncreased: boolean };
  questUpdates: QuestUpdateView[];
  rewards: RewardOutcome;
}

export interface NpcApi {
  getNpcState: typeof amplify.getNpcState;
  listNpcStates: typeof amplify.listNpcStates;
  recordDialogueNode: typeof amplify.recordDialogueNode;
  setNpcMemoryFlagsForQuest: typeof amplify.setNpcMemoryFlagsForQuest;
  clearNpcState: typeof amplify.clearNpcState;
  listNpcs(childProfileId: string): Promise<NpcView[]>;
  talkToNpc(childProfileId: string, npcId: string): Promise<DialogueTurn>;
  chooseNpcDialogue(
    childProfileId: string,
    npcId: string,
    fromNodeId: string,
    choiceId: string,
  ): Promise<DialogueTurn>;
}

const LEVELS: readonly RelationshipLevel[] = ['STRANGER', 'ACQUAINTANCE', 'FRIEND', 'TRUSTED_FRIEND'];

function parseNpc(r: Reader): NpcView {
  const relationship = r.field('relationship');
  return {
    npcId: r.field('npcId').string(),
    displayName: r.field('displayName').string(),
    role: r.field('role').string(),
    homeLocationSlug: r.field('homeLocationSlug').string(),
    interactionId: r.field('interactionId').string(),
    relationship: {
      level: relationship.field('level').oneOf(LEVELS),
      met: relationship.field('met').boolean(),
      lastInteractedAt: relationship.field('lastInteractedAt').nullable((x) => x.string()),
    },
  };
}

export function parseDialogueTurn(r: Reader): DialogueTurn {
  const relationship = r.field('relationship');
  return {
    npcId: r.field('npcId').string(),
    node: r.field('node').nullable((n) => ({
      id: n.field('id').string(),
      text: n.field('text').string(),
      choices: n.field('choices').array((c) => ({
        id: c.field('id').string(),
        label: c.field('label').string(),
      })),
    })),
    relationship: {
      level: relationship.field('level').oneOf(LEVELS),
      levelIncreased: relationship.field('levelIncreased').boolean(),
    },
    questUpdates: optionalQuestUpdates(r) ?? [],
    rewards: r.field('rewards').value === undefined ? NO_REWARDS : parseRewardOutcome(r.field('rewards')),
  };
}

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

export function createDjangoNpc(client: ApiClient): Partial<NpcApi> {
  const base = (childProfileId: string) => `children/${segment(childProfileId)}/npcs/`;
  return {
    async listNpcs(childProfileId) {
      const response = await client.request('GET', base(childProfileId));
      return read(response.data, (r) => r.field('npcs').array(parseNpc));
    },
    async talkToNpc(childProfileId, npcId) {
      const response = await client.request('POST', `${base(childProfileId)}${segment(npcId)}/talk/`);
      return read(response.data, parseDialogueTurn);
    },
    async chooseNpcDialogue(childProfileId, npcId, fromNodeId, choiceId) {
      const response = await client.request(
        'POST',
        `${base(childProfileId)}${segment(npcId)}/choices/`,
        { body: { fromNodeId, choiceId } },
      );
      return read(response.data, parseDialogueTurn);
    },
  };
}

const djangoOnly = () => Promise.reject(unsupported('npc'));

export const npcApi: NpcApi = selectApi<NpcApi>('npc', {
  amplify: {
    getNpcState: amplify.getNpcState,
    listNpcStates: amplify.listNpcStates,
    recordDialogueNode: amplify.recordDialogueNode,
    setNpcMemoryFlagsForQuest: amplify.setNpcMemoryFlagsForQuest,
    clearNpcState: amplify.clearNpcState,
    listNpcs: djangoOnly,
    talkToNpc: djangoOnly,
    chooseNpcDialogue: djangoOnly,
  },
  django: (client) => createDjangoNpc(client),
});
