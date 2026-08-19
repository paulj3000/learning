import { defineFunction } from '@aws-amplify/backend';

/**
 * Backs the `claimCoopSlot` custom mutation (amplify/data/resource.ts).
 * Needs a real Lambda (not a plain client-side `CoopSession.update()`)
 * because a slot claim must be atomic: "whichever child's validated action
 * reaches the engine first" per docs/ADVENTURE_ENGINE.md's "Co-op sessions"
 * section, which a bare read-then-write from the browser cannot guarantee.
 *
 * `resourceGroupName: 'data'` pins this function to the `data` nested stack
 * rather than the default shared `function` stack. Without it, the `data`
 * stack depends on this Lambda (as the mutation's resolver,
 * amplify/data/resource.ts) while this Lambda's `CoopSession` table grant
 * (amplify/backend.ts) depends back on the `data` stack — a circular
 * nested-stack dependency that fails at deploy time
 * (`CloudformationStackCircularDependencyError`). Living inside the `data`
 * stack itself, alongside the table and resolver that already need it,
 * removes the cross-stack edge entirely.
 */
export const claimCoopSlot = defineFunction({
  name: 'claim-coop-slot',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  resourceGroupName: 'data',
});
