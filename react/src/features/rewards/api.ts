/**
 * The backpack and reward grants, through `react/src/api/rewards.ts`
 * (LAI-0501B). Names and signatures are the ones the app already used.
 * Every decision about *what* to grant is still made by the pure modules
 * in this folder, so the anti-loot-box guarantee (`rewardTable.ts`: no
 * randomness anywhere) stays unit-testable without a backend.
 */
import { rewardsApi } from '../../api/rewards';

export type { ChildInventoryRow } from '../../api/rewards';
export {
  EMPTY_INVENTORY_STATE,
  NO_GRANT,
  type ChildInventoryState,
  type GrantResult,
} from './inventoryState';

export const { getInventory, grantRewards, clearInventory } = rewardsApi;
