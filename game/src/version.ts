/**
 * Public interface versions. `ENGINE_API_VERSION` follows semver for the package's exported
 * surface: a minor bump adds, a major bump breaks (and needs a migration note in
 * docs/engineering/game-engine/public-contracts.md).
 */
export const ENGINE_API_VERSION = '0.2.0' as const;
export { GAMEPLAY_EVENT_VERSION } from './contracts/gameplayEvents';
