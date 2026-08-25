import { defineFunction } from '@aws-amplify/backend';

/**
 * Backs the `getNextLearningActivity` custom query (amplify/data/resource.ts).
 * A real Lambda, not a plain client-side computation, so the Adaptive
 * Adventure Director's ranking runs once, shared by every client, instead
 * of being reimplemented per client and risking silent divergence
 * (docs/DECISIONS.md ADR-016).
 *
 * `resourceGroupName: 'data'` for the same circular-nested-stack-dependency
 * reason `claim-coop-slot/resource.ts` and
 * `submit-adventure-answer/resource.ts` already set it.
 */
export const getNextLearningActivity = defineFunction({
  name: 'get-next-learning-activity',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  resourceGroupName: 'data',
});
