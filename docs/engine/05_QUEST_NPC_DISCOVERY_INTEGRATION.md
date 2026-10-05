# 05 — Quest, NPC, Discovery, Inventory and Reward Integration

## Reuse Existing Engines

The project already has working modules for:

```text
quests
npc
discovery
interaction
rewards
inventory-related content/state
```

The new world runtime is an adapter to these systems.

## Semantic Event Bridge

Keep/extend the existing engine-neutral world event bus.

Normalize events such as:

```text
NpcApproached
EntityFocused
EntityInteracted
PlayerEnteredZone
PlayerExitedZone
CheckpointReached
CollectibleFound
DiscoveryTriggered
AdventureEntranceUsed
```

Exact names should align with current `worldEngineEvents.ts`.

## NPCs

Manifest NPC placement should reference existing NPC IDs.

Example:

```json
{
  "entityId": "pirate-pip-world",
  "npcId": "pirate-pip",
  "assetId": "pirate-pip-model",
  "position": [3, 0, 4]
}
```

The existing NPC conversation system remains responsible for dialogue/quest acceptance.

## Quests

World interactions should update facts/events that existing quest logic can evaluate.

Do not create a second quest state machine inside Three.js.

## Discovery

Use existing `DiscoveryDefinition` IDs.

Manifest binds a physical entity/zone to an existing discovery ID.

## Rewards

World runtime never grants arbitrary rewards directly unless routed through the existing reward/domain service.

## World Changes

Preserve existing `WorldChange` behavior and semantic keys.

Do not persist raw Three.js object state.

## ChildWorldState

Preserve authored checkpoint IDs.

Never replace them with raw coordinates as canonical save state.

## Interaction Registry

Create generic handlers such as:

```text
NPC
DISCOVERY
COLLECTIBLE
ADVENTURE_ENTRANCE
WORLD_EXIT
INSPECT
USE
CUSTOM_EXTENSION
```

These handlers bridge to existing domain systems.
