import type { EventMap } from '../core/eventBus';
import type { EngineRuntime } from '../core/runtime';
import {
  ASSET_MANAGER,
  createFakeAssetManager,
  type AssetMetadata,
  type AssetManagerPort,
} from './assetManager';
import {
  createFakeInventory,
  createFakeRewards,
  INVENTORY,
  REWARDS,
  type InventoryPort,
  type RewardsPort,
} from './inventoryRewards';
import { createDisabledMultiplayer, MULTIPLAYER, type MultiplayerPort } from './multiplayer';
import { createFakeNpcManager, NPC_MANAGER, type NpcManagerPort } from './npcManager';
import {
  createFakePublishedContent,
  PUBLISHED_CONTENT,
  type PublishedContentPort,
} from './publishedContent';
import { createFakeQuestService, QUEST_SERVICE, type QuestServicePort } from './questService';
import {
  createFakeQuestionStudio,
  QUESTION_STUDIO,
  type QuestionStudioPort,
} from './questionStudio';
import { createFakeSaveRestore, SAVE_RESTORE, type SaveRestorePort } from './saveRestore';
import { createFakeSoundManager, SOUND_MANAGER, type SoundManagerPort } from './soundManager';

export * from './assetManager';
export * from './inventoryRewards';
export * from './multiplayer';
export * from './npcManager';
export * from './publishedContent';
export * from './questService';
export * from './questionStudio';
export * from './saveRestore';
export * from './soundManager';

export interface FakeServiceSet {
  assets: ReturnType<typeof createFakeAssetManager>;
  sound: ReturnType<typeof createFakeSoundManager>;
  npcs: NpcManagerPort;
  questions: ReturnType<typeof createFakeQuestionStudio>;
  quests: ReturnType<typeof createFakeQuestService>;
  inventory: ReturnType<typeof createFakeInventory>;
  rewards: ReturnType<typeof createFakeRewards>;
  saveRestore: ReturnType<typeof createFakeSaveRestore>;
  publishedContent: PublishedContentPort;
  multiplayer: MultiplayerPort;
}

export interface FakeServiceOverrides {
  assets?: readonly AssetMetadata[];
  /** Replace any port outright (the host's real one, or a custom fake). */
  replace?: {
    assets?: AssetManagerPort;
    sound?: SoundManagerPort;
    npcs?: NpcManagerPort;
    questions?: QuestionStudioPort;
    quests?: QuestServicePort;
    inventory?: InventoryPort;
    rewards?: RewardsPort;
    saveRestore?: SaveRestorePort;
    publishedContent?: PublishedContentPort;
  };
}

/**
 * Provides an in-memory fake for every port on `runtime.services` (tests and the playground).
 * Returns the fakes for assertions. Services are cleared when the runtime is disposed.
 */
export function provideFakeServices(
  runtime: EngineRuntime<EventMap>,
  overrides: FakeServiceOverrides = {},
): FakeServiceSet {
  const fakes: FakeServiceSet = {
    assets: createFakeAssetManager(overrides.assets),
    sound: createFakeSoundManager(),
    npcs: createFakeNpcManager(),
    questions: createFakeQuestionStudio(),
    quests: createFakeQuestService(),
    inventory: createFakeInventory(),
    rewards: createFakeRewards(),
    saveRestore: createFakeSaveRestore(),
    publishedContent: createFakePublishedContent(),
    multiplayer: createDisabledMultiplayer(),
  };
  const replace = overrides.replace ?? {};
  const { services } = runtime;
  services.provide(ASSET_MANAGER, replace.assets ?? fakes.assets);
  services.provide(SOUND_MANAGER, replace.sound ?? fakes.sound);
  services.provide(NPC_MANAGER, replace.npcs ?? fakes.npcs);
  services.provide(QUESTION_STUDIO, replace.questions ?? fakes.questions);
  services.provide(QUEST_SERVICE, replace.quests ?? fakes.quests);
  services.provide(INVENTORY, replace.inventory ?? fakes.inventory);
  services.provide(REWARDS, replace.rewards ?? fakes.rewards);
  services.provide(SAVE_RESTORE, replace.saveRestore ?? fakes.saveRestore);
  services.provide(PUBLISHED_CONTENT, replace.publishedContent ?? fakes.publishedContent);
  services.provide(MULTIPLAYER, fakes.multiplayer);
  return fakes;
}
