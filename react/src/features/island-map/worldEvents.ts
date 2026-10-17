/**
 * Decouples Phaser scenes from React/adventure state (docs/ARCHITECTURE.md
 * "World engine layering", ADR-007 in docs/DECISIONS.md). Scenes only ever
 * emit through this bus; nothing here imports `phaser`, so it stays
 * unit-testable without a rendering context.
 */

export interface WorldPosition {
  x: number;
  y: number;
}

export type WorldEventMap = {
  AVATAR_MOVED: { position: WorldPosition };
  INTERACTION_ZONE_ENTERED: { interactionId: string };
  INTERACTION_ZONE_EXITED: { interactionId: string };
  INTERACTION_TRIGGERED: { interactionId: string };
};

export type WorldEventName = keyof WorldEventMap;

type Listener<Name extends WorldEventName> = (detail: WorldEventMap[Name]) => void;

/** A minimal typed pub/sub bus. One instance per mounted world view. */
export class WorldEventBus {
  private readonly listeners = new Map<WorldEventName, Set<Listener<WorldEventName>>>();

  emit<Name extends WorldEventName>(name: Name, detail: WorldEventMap[Name]): void {
    const forName = this.listeners.get(name);
    if (!forName) {
      return;
    }
    // Copy before iterating: a listener may unsubscribe itself mid-emit.
    for (const listener of [...forName]) {
      (listener as Listener<Name>)(detail);
    }
  }

  on<Name extends WorldEventName>(name: Name, listener: Listener<Name>): () => void {
    let forName = this.listeners.get(name);
    if (!forName) {
      forName = new Set();
      this.listeners.set(name, forName);
    }
    forName.add(listener as Listener<WorldEventName>);
    return () => {
      forName.delete(listener as Listener<WorldEventName>);
    };
  }

  /** Drops every listener. Call on world-view unmount. */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}
