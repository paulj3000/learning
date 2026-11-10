/**
 * Persistence for the NPC system on Django (`children/<id>/npcs/...`, AMP-03).
 *
 * The only impure module in `src/features/npc/`. The client tells the server which authored
 * dialogue node it showed; the server applies the same rules as `dialogue.ts` and
 * `relationship.ts` against the content export's own node (`apps/progression/npcs.py`): the
 * node's memory flags are set, its points are awarded the first time only, and the level is
 * derived from the points. A finished quest's memory flags are set by the server when it accepts
 * the quest state, so nothing here writes flags on its own.
 *
 * Every route is child-scoped on the server: a parent reaches only their own children.
 */
import { childPath, djangoClient } from '../../api/djangoClient';
import { read, type Reader } from '../../api/parse';
import { EMPTY_MEMORY_FLAGS, parseMemoryFlags } from './memory';
import { relationshipLevelForPoints } from './relationship';
import type { DialogueNode, NpcId, NpcRelationshipState, RelationshipLevel } from './types';

/** The default state for an NPC this child has never met. */
export function initialRelationshipState(npcId: NpcId): NpcRelationshipState {
  return {
    npcId,
    relationshipPoints: 0,
    memoryFlags: EMPTY_MEMORY_FLAGS,
    seenNodeIds: [],
  };
}

function readState(r: Reader): NpcRelationshipState {
  return {
    npcId: r.field('npcId').string(),
    relationshipPoints: r.field('relationshipPoints').integer(),
    memoryFlags: parseMemoryFlags(r.field('memoryFlags').value),
    seenNodeIds: r.field('seenNodeIds').array((id) => id.string()),
  };
}

/** Every NPC this child has met, for quests, the parent dashboard and world views. */
export async function listNpcStates(childProfileId: string): Promise<NpcRelationshipState[]> {
  const response = await djangoClient().request('GET', childPath(childProfileId, 'npcs/'));
  return read(response.data, (r) => r.field('npcs').array(readState));
}

/** This child's state for one NPC, or a fresh unmet state. */
export async function getNpcState(
  childProfileId: string,
  npcId: NpcId,
): Promise<NpcRelationshipState> {
  const states = await listNpcStates(childProfileId);
  return states.find((state) => state.npcId === npcId) ?? initialRelationshipState(npcId);
}

export interface RecordDialogueResult {
  state: NpcRelationshipState;
  relationshipLevel: RelationshipLevel;
  /** True when this visit moved the child up the ladder, for a warm UI beat. */
  levelIncreased: boolean;
}

/** Records that `node` was shown to this child. The server decides what it is worth. */
export async function recordDialogueNode(
  childProfileId: string,
  npcId: NpcId,
  node: DialogueNode,
): Promise<RecordDialogueResult> {
  const response = await djangoClient().request(
    'POST',
    childPath(childProfileId, `npcs/${encodeURIComponent(npcId)}/dialogue/`),
    { body: { nodeId: node.id } },
  );
  return read(response.data, (r) => {
    const state = readState(r.field('npc'));
    return {
      state,
      // Derived from points, as everywhere in the client (relationship.ts).
      relationshipLevel: relationshipLevelForPoints(state.relationshipPoints),
      levelIncreased: r.field('levelIncreased').boolean(),
    };
  });
}

/**
 * Deletes every NPC memory for a child. A parent-facing data action
 * (docs/AI_AND_CHILD_SAFETY.md retention controls), never reachable from
 * gameplay: characters must not forget a child as a game mechanic.
 */
export async function clearNpcState(childProfileId: string): Promise<void> {
  await djangoClient().request('DELETE', childPath(childProfileId, 'npcs/'));
}
