/**
 * Adaptive Adventure Director (docs/ROADMAP.md Phase 28).
 *
 * Public surface, in the order the other engines expose themselves: pure
 * domain first, persistence last.
 */
export * from './types';
export * from './needs';
export * from './select';
export * from './explain';
export * from './reachability';
export { getNextLearningActivity } from './api';
