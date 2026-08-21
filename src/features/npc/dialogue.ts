/**
 * Dialogue tree traversal and conditional selection (docs/ROADMAP.md
 * Phase 23).
 *
 * Deterministic and pure, in the same spirit as the Adventure Engine's
 * `validateStepAnswer`: what an NPC says is decided by application code from
 * authored content and recorded state, never by a model. Chatty may later
 * re-voice a line that opted in via `narration`, but it can neither choose
 * the line nor invent one.
 *
 * Selection is first-match-wins over authored order, so content reads
 * top-to-bottom as "most specific case first, general greeting last" — the
 * same convention as the hint ladder in `src/features/adventures/engine/hints.ts`.
 */
import { evaluateConditions } from './conditions';
import type { DialogueChoice, DialogueNode, NpcContext, NpcDefinition } from './types';

/**
 * The opening line for a conversation: the first authored node that is not
 * `followUpOnly` and whose conditions all pass, or null if none do.
 *
 * Skipping `followUpOnly` nodes is what keeps a child from being dropped
 * into the middle of an exchange when a mid-conversation node carries broad
 * conditions and happens to sit earlier in authored order.
 */
export function selectDialogueNode(npc: NpcDefinition, context: NpcContext): DialogueNode | null {
  return (
    npc.dialogue.find(
      (node) => !node.followUpOnly && evaluateConditions(node.conditions, context),
    ) ?? null
  );
}

/** A specific node by ID, when following a choice rather than re-entering a conversation. */
export function findDialogueNode(npc: NpcDefinition, nodeId: string): DialogueNode | null {
  return npc.dialogue.find((node) => node.id === nodeId) ?? null;
}

/** Only the choices this child currently qualifies for. */
export function availableChoices(node: DialogueNode, context: NpcContext): DialogueChoice[] {
  return node.choices.filter((choice) => evaluateConditions(choice.conditions, context));
}

/**
 * The next node after taking `choice`, or null to end the conversation.
 * Returns null rather than throwing for an unknown `nextNodeId` so a content
 * typo ends the exchange warmly instead of crashing a child's screen;
 * `findDanglingChoices` is the authoring-time check that catches it.
 */
export function advanceDialogue(
  npc: NpcDefinition,
  choice: DialogueChoice,
  context: NpcContext,
): DialogueNode | null {
  if (!choice.nextNodeId) return null;
  const next = findDialogueNode(npc, choice.nextNodeId);
  if (!next) return null;
  return evaluateConditions(next.conditions, context) ? next : null;
}

/**
 * The effect of showing `node` for the first time: which flags to set and
 * how many relationship points to award. Returns no award for a node already
 * in `seenNodeIds`, so re-reading a greeting cannot farm friendship — the
 * caller persists the result via `api.ts`.
 */
export function dialogueOutcome(
  node: DialogueNode,
  seenNodeIds: readonly string[],
): { memoryFlagsToSet: readonly string[]; relationshipPointsAwarded: number } {
  const alreadySeen = seenNodeIds.includes(node.id);
  return {
    memoryFlagsToSet: node.setsMemoryFlags ?? [],
    relationshipPointsAwarded: alreadySeen ? 0 : (node.awardsRelationshipPoints ?? 0),
  };
}

/** Choices pointing at a node that does not exist. Must be empty; asserted in tests. */
export function findDanglingChoices(
  npc: NpcDefinition,
): { nodeId: string; choiceId: string; nextNodeId: string }[] {
  const known = new Set(npc.dialogue.map((node) => node.id));
  return npc.dialogue.flatMap((node) =>
    node.choices
      .filter((choice) => choice.nextNodeId && !known.has(choice.nextNodeId))
      .map((choice) => ({
        nodeId: node.id,
        choiceId: choice.id,
        nextNodeId: choice.nextNodeId as string,
      })),
  );
}
