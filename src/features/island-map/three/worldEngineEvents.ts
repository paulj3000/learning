/**
 * The engine-neutral event boundary between the Three.js world (this
 * directory) and domain/React code, per `docs/ROADMAP.md` Phase 31 and
 * ADR-008 in `docs/DECISIONS.md`. Mirrors `../worldEvents.ts`'s
 * Phaser-free bus (Phase 9) but with its own vocabulary, since the two
 * renderers' event contracts stay independent during the migration window
 * (ADR-008: "Phaser is not retroactively erased"). Nothing here imports
 * `three`, so it stays unit-testable without a rendering context.
 *
 * Durable domain state must be keyed by these semantic ids, never by a
 * Three.js object UUID, mesh reference, or raw camera transform (ADR-008).
 */

/** The one placeholder NPC the Phase 31 sandbox wires to a real domain action. */
export const SANDBOX_NPC_ID = 'pirate-pip';

export type RegionId = string;
export type ZoneId = string;
export type EntityId = string;
export type InteractionId = string;
export type WorldStateKey = string;

export type WorldEngineEventMap = {
  // Three.js -> domain
  PlayerEnteredZone: { zoneId: ZoneId };
  ObjectInteracted: { entityId: EntityId; interactionId: InteractionId };
  NpcApproached: { entityId: EntityId };
  CollectiblePickedUp: { entityId: EntityId };
  BuildActionRequested: { entityId: EntityId };
  // domain -> Three.js
  QuestStateChanged: { questId: string; state: string };
  WorldStateChanged: { worldStateKey: WorldStateKey };
  InventoryChanged: { itemId: string };
  NpcStateChanged: { entityId: EntityId; metByChild: boolean };
};

export type WorldEngineEventName = keyof WorldEngineEventMap;

type Listener<Name extends WorldEngineEventName> = (detail: WorldEngineEventMap[Name]) => void;

/** A minimal typed pub/sub bus. One instance per mounted world-engine view. */
export class WorldEngineEventBus {
  private readonly listeners = new Map<WorldEngineEventName, Set<Listener<WorldEngineEventName>>>();

  emit<Name extends WorldEngineEventName>(name: Name, detail: WorldEngineEventMap[Name]): void {
    const forName = this.listeners.get(name);
    if (!forName) {
      return;
    }
    // Copy before iterating: a listener may unsubscribe itself mid-emit.
    for (const listener of [...forName]) {
      (listener as Listener<Name>)(detail);
    }
  }

  on<Name extends WorldEngineEventName>(name: Name, listener: Listener<Name>): () => void {
    let forName = this.listeners.get(name);
    if (!forName) {
      forName = new Set();
      this.listeners.set(name, forName);
    }
    forName.add(listener as Listener<WorldEngineEventName>);
    return () => {
      forName.delete(listener as Listener<WorldEngineEventName>);
    };
  }

  /** Drops every listener. Call on world-view unmount. */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}
