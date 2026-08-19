import { defineFunction } from '@aws-amplify/backend';

/**
 * Backs the `claimCoopSlot` custom mutation (amplify/data/resource.ts).
 * Needs a real Lambda (not a plain client-side `CoopSession.update()`)
 * because a slot claim must be atomic: "whichever child's validated action
 * reaches the engine first" per docs/ADVENTURE_ENGINE.md's "Co-op sessions"
 * section, which a bare read-then-write from the browser cannot guarantee.
 */
export const claimCoopSlot = defineFunction({
  name: 'claim-coop-slot',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
});
