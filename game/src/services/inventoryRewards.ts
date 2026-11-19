/**
 * Inventory and Rewards ports. Both are **read-only** to the engine: it can show what the
 * child owns and what the server granted, and it can never grant anything. There is
 * deliberately no `grant` method on either (scoring standard: the 3D engine never grants).
 */

import { defineService } from '../core/services';

export interface InventoryPort {
  /** Item ids the child owns, as confirmed by the server. */
  ownedItemIds(): readonly string[];
  has(itemId: string): boolean;
  subscribe(listener: () => void): () => void;
}

export const INVENTORY = defineService<InventoryPort>('lai.inventory');

/** What the server granted, for presentation (a toast, a chest opening). */
export interface GrantedRewardView {
  rewardId: string;
  titleKey: string;
  itemIds: readonly string[];
}

export interface RewardsPort {
  /** Rewards granted so far this session, newest last. */
  granted(): readonly GrantedRewardView[];
  subscribe(listener: (reward: GrantedRewardView) => void): () => void;
}

export const REWARDS = defineService<RewardsPort>('lai.rewards');

export interface FakeInventory extends InventoryPort {
  /** Test helper standing in for a server update. */
  setOwned(itemIds: readonly string[]): void;
}

export function createFakeInventory(initial: readonly string[] = []): FakeInventory {
  let owned = [...initial];
  const listeners = new Set<() => void>();
  return {
    ownedItemIds: () => owned,
    has: (itemId) => owned.includes(itemId),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setOwned(itemIds) {
      owned = [...itemIds];
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

export interface FakeRewards extends RewardsPort {
  /** Test helper standing in for a server grant arriving. */
  announce(reward: GrantedRewardView): void;
}

export function createFakeRewards(initial: readonly GrantedRewardView[] = []): FakeRewards {
  const granted = [...initial];
  const listeners = new Set<(reward: GrantedRewardView) => void>();
  return {
    granted: () => granted,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    announce(reward) {
      granted.push(reward);
      for (const listener of [...listeners]) {
        listener(reward);
      }
    },
  };
}
