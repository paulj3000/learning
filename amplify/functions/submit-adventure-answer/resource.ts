import { defineFunction } from '@aws-amplify/backend';

/**
 * Backs the `submitAdventureAnswer` custom mutation (amplify/data/resource.ts).
 * Needs a real Lambda (not a plain client-side `AdventureAction.create()` +
 * `AdventureSession.update()`) so that answer correctness — and the session
 * transition it drives — is decided by code the caller cannot influence,
 * per docs/DECISIONS.md ADR-012.
 *
 * `resourceGroupName: 'data'` for the same reason `claim-coop-slot/resource.ts`
 * sets it: this function is both a resolver the `data` stack depends on and
 * a consumer of table grants that depend back on the `data` stack, so it
 * has to live inside that stack to avoid a circular nested-stack dependency
 * (the same `CloudformationStackCircularDependencyError` documented at
 * "Post-Phase-17 deploy fix: circular nested-stack dependency" in
 * docs/IMPLEMENTATION_STATUS.md).
 */
export const submitAdventureAnswer = defineFunction({
  name: 'submit-adventure-answer',
  entry: './handler.ts',
  timeoutSeconds: 10,
  memoryMB: 256,
  resourceGroupName: 'data',
});
