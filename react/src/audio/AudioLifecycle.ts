import type { AudioChannel, EndReason } from './AudioTypes';

/**
 * Ownership bookkeeping. Every playback instance and every pending load
 * belongs to exactly one scope (the manager's own `app` scope, or one a game
 * created). That is what lets Treasure Rush stop its music, ambience and
 * effects when the child leaves, while the global UI sounds keep working.
 *
 * Pure data structure: no engine, no timers, no React.
 */

export interface TrackedInstance {
  instanceId: string;
  soundId: string;
  scopeId: string;
  channel: AudioChannel;
  priority: number;
  /** Monotonic start order; the oldest instance is stolen first among equal priorities. */
  order: number;
  end(reason: EndReason, fadeOutMs: number): void;
}

export interface TrackedLoad {
  loadId: string;
  soundId: string;
  scopeId: string;
  cancel(): void;
}

export interface OwnershipFilter {
  soundId?: string;
  scopeId?: string;
}

function matches(item: { soundId: string; scopeId: string }, filter: OwnershipFilter): boolean {
  return (
    (filter.soundId === undefined || item.soundId === filter.soundId) &&
    (filter.scopeId === undefined || item.scopeId === filter.scopeId)
  );
}

export class LifecycleRegistry {
  private readonly instances = new Map<string, TrackedInstance>();
  private readonly loads = new Map<string, TrackedLoad>();

  addInstance(instance: TrackedInstance): void {
    this.instances.set(instance.instanceId, instance);
  }

  removeInstance(instanceId: string): void {
    this.instances.delete(instanceId);
  }

  addLoad(load: TrackedLoad): void {
    this.loads.set(load.loadId, load);
  }

  removeLoad(loadId: string): void {
    this.loads.delete(loadId);
  }

  get instanceCount(): number {
    return this.instances.size;
  }

  get loadCount(): number {
    return this.loads.size;
  }

  instancesMatching(filter: OwnershipFilter): TrackedInstance[] {
    return [...this.instances.values()].filter((instance) => matches(instance, filter));
  }

  loadsMatching(filter: OwnershipFilter): TrackedLoad[] {
    return [...this.loads.values()].filter((load) => matches(load, filter));
  }

  /** The instance to give up when the voice limit is reached: lowest priority, then oldest. */
  stealCandidate(): TrackedInstance | undefined {
    let candidate: TrackedInstance | undefined;
    for (const instance of this.instances.values()) {
      if (
        !candidate ||
        instance.priority < candidate.priority ||
        (instance.priority === candidate.priority && instance.order < candidate.order)
      ) {
        candidate = instance;
      }
    }
    return candidate;
  }

  /** Cancels loads, then ends instances. Loads go first so nothing starts while ending. */
  endMatching(filter: OwnershipFilter, reason: EndReason, fadeOutMs: number): void {
    for (const load of this.loadsMatching(filter)) load.cancel();
    for (const instance of this.instancesMatching(filter)) instance.end(reason, fadeOutMs);
  }
}
