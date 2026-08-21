/**
 * Persistence for the NPC system (docs/ROADMAP.md Phase 23).
 *
 * The only impure module in `src/features/npc/`. Everything it writes is
 * derived by the pure modules first, so the rules an NPC follows stay
 * unit-testable without a backend, matching how the Mastery Engine splits
 * `status.ts` (pure) from `api.ts` (persistence).
 *
 * Authorization is the model's own `allow.owner()` (amplify/data/resource.ts):
 * a parent reaches only their own children's NPC state, and Admins read only.
 */
import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import { dialogueOutcome } from './dialogue';
import { EMPTY_MEMORY_FLAGS, parseMemoryFlags, setMemoryFlags } from './memory';
import { awardRelationshipPoints, relationshipLevelForPoints } from './relationship';
import type { DialogueNode, NpcId, NpcRelationshipState, RelationshipLevel } from './types';

export type ChildNpcState = Schema['ChildNpcState']['type'];

/** Row shape reduced to the pure modules' `NpcRelationshipState`. */
function toRelationshipState(row: ChildNpcState): NpcRelationshipState {
  return {
    npcId: row.npcId,
    relationshipPoints: row.relationshipPoints,
    memoryFlags: parseMemoryFlags(row.memoryFlags),
    seenNodeIds: (row.seenNodeIds ?? []).filter((id): id is string => typeof id === 'string'),
  };
}

/** The default state for an NPC this child has never met. */
export function initialRelationshipState(npcId: NpcId): NpcRelationshipState {
  return {
    npcId,
    relationshipPoints: 0,
    memoryFlags: EMPTY_MEMORY_FLAGS,
    seenNodeIds: [],
  };
}

async function findRow(childProfileId: string, npcId: NpcId): Promise<ChildNpcState | undefined> {
  const { data } = await client.models.ChildNpcState.list();
  return data.find(
    (row: ChildNpcState) => row.childProfileId === childProfileId && row.npcId === npcId,
  );
}

/** This child's state for one NPC, or a fresh unmet state. */
export async function getNpcState(
  childProfileId: string,
  npcId: NpcId,
): Promise<NpcRelationshipState> {
  const row = await findRow(childProfileId, npcId);
  return row ? toRelationshipState(row) : initialRelationshipState(npcId);
}

/** Every NPC this child has met, for the parent dashboard and admin reads. */
export async function listNpcStates(childProfileId: string): Promise<NpcRelationshipState[]> {
  const { data } = await client.models.ChildNpcState.list();
  return data
    .filter((row: ChildNpcState) => row.childProfileId === childProfileId)
    .map(toRelationshipState);
}

export interface RecordDialogueResult {
  state: NpcRelationshipState;
  relationshipLevel: RelationshipLevel;
  /** True when this visit moved the child up the ladder, for a warm UI beat. */
  levelIncreased: boolean;
}

/**
 * Records that `node` was shown to this child: sets its memory flags, awards
 * its points the first time only, and marks the node seen.
 *
 * Read-modify-write rather than an atomic increment, the same tradeoff
 * `upsertSkillProgress` already makes (src/features/mastery/api.ts). A child
 * talks to one NPC on one device at a time, so the lost-update window is not
 * a practical concern here; the co-op path that genuinely needed atomicity
 * uses a Lambda (`claimCoopSlot`) instead.
 */
export async function recordDialogueNode(
  childProfileId: string,
  npcId: NpcId,
  node: DialogueNode,
): Promise<RecordDialogueResult> {
  const row = await findRow(childProfileId, npcId);
  const current = row ? toRelationshipState(row) : initialRelationshipState(npcId);
  const previousLevel = relationshipLevelForPoints(current.relationshipPoints);

  const outcome = dialogueOutcome(node, current.seenNodeIds);
  const points = awardRelationshipPoints(
    current.relationshipPoints,
    outcome.relationshipPointsAwarded,
  );
  const level = relationshipLevelForPoints(points);
  const memoryFlags = setMemoryFlags(current.memoryFlags, outcome.memoryFlagsToSet);
  const seenNodeIds = current.seenNodeIds.includes(node.id)
    ? current.seenNodeIds
    : [...current.seenNodeIds, node.id];
  const now = new Date().toISOString();

  if (row) {
    await client.models.ChildNpcState.update({
      id: row.id,
      relationshipPoints: points,
      relationshipLevel: level,
      memoryFlags,
      seenNodeIds: [...seenNodeIds],
      lastInteractedAt: now,
    });
  } else {
    await client.models.ChildNpcState.create({
      childProfileId,
      npcId,
      relationshipPoints: points,
      relationshipLevel: level,
      memoryFlags,
      seenNodeIds: [...seenNodeIds],
      firstMetAt: now,
      lastInteractedAt: now,
    });
  }

  return {
    state: { npcId, relationshipPoints: points, memoryFlags, seenNodeIds },
    relationshipLevel: level,
    levelIncreased: level !== previousLevel,
  };
}

/**
 * Deletes every NPC memory for a child. A parent-facing data action
 * (docs/AI_AND_CHILD_SAFETY.md retention controls), never reachable from
 * gameplay: characters must not forget a child as a game mechanic.
 */
export async function clearNpcState(childProfileId: string): Promise<void> {
  const { data } = await client.models.ChildNpcState.list();
  const rows = data.filter((row: ChildNpcState) => row.childProfileId === childProfileId);
  await Promise.all(
    rows.map((row: ChildNpcState) => client.models.ChildNpcState.delete({ id: row.id })),
  );
}
