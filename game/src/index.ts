/**
 * @lai/game-engine: the Learning Adventure Island Game Engine Core (ADR-020).
 *
 * Imports no React, Django client, Amplify or AWS SDK (enforced by `boundary.test.ts`).
 * React hosts it through `react/src/features/game-engine/GameHost.tsx` and receives typed,
 * semantic-id events.
 */
export * from './version';
export * from './core';
export * from './contracts';
