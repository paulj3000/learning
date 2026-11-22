/**
 * A typed, synchronous publish/subscribe bus.
 *
 * Generalises `WorldEngineEventBus` (the island-map runtime's bus) to any event map, so the
 * runtime, gameplay components and the gameplay-event contracts share one implementation.
 * Semantics kept from that bus: listeners run synchronously in subscription order, a listener
 * may unsubscribe itself (or another) mid-emit without skipping or repeating anyone, and
 * `clear()` drops everything on unmount.
 *
 * Added: a listener that throws no longer stops the remaining listeners. The error goes to
 * `onListenerError` (default: rethrown asynchronously, so it still surfaces in the console and
 * in tests) and the emit continues. An engine event must never be lost to an unrelated bug.
 */

// The map's values are payload types; `object` keeps `{}`-free maps (e.g. `{ ready: void }`) out.
export type EventMap = { [name: string]: unknown };

export type EventListener<Payload> = (payload: Payload) => void;

export interface EventBusOptions {
  /** Called when a listener throws. Default: rethrow on a microtask so it is not swallowed. */
  onListenerError?: (error: unknown, eventName: string) => void;
}

export interface TypedEventBus<Events extends EventMap> {
  emit<Name extends keyof Events & string>(name: Name, payload: Events[Name]): void;
  on<Name extends keyof Events & string>(
    name: Name,
    listener: EventListener<Events[Name]>,
  ): () => void;
  once<Name extends keyof Events & string>(
    name: Name,
    listener: EventListener<Events[Name]>,
  ): () => void;
  /** Receives every event, after the named listeners. For diagnostics and contract adapters. */
  onAny(
    listener: <Name extends keyof Events & string>(name: Name, payload: Events[Name]) => void,
  ): () => void;
  listenerCount(name?: keyof Events & string): number;
  clear(): void;
}

function defaultListenerError(error: unknown): void {
  queueMicrotask(() => {
    throw error;
  });
}

export function createEventBus<Events extends EventMap>(
  options: EventBusOptions = {},
): TypedEventBus<Events> {
  type AnyListener = (payload: unknown) => void;
  type WildcardListener = (name: string, payload: unknown) => void;
  const listeners = new Map<string, Set<AnyListener>>();
  const wildcard = new Set<WildcardListener>();
  const onError = options.onListenerError ?? defaultListenerError;

  const safeCall = (name: string, call: () => void): void => {
    try {
      call();
    } catch (error) {
      onError(error, name);
    }
  };

  const bus: TypedEventBus<Events> = {
    emit(name, payload) {
      const named = listeners.get(name);
      if (named && named.size > 0) {
        // Snapshot: a listener may unsubscribe itself or others mid-emit.
        for (const listener of [...named]) {
          safeCall(name, () => listener(payload));
        }
      }
      if (wildcard.size > 0) {
        for (const listener of [...wildcard]) {
          safeCall(name, () => listener(name, payload));
        }
      }
    },
    on(name, listener) {
      let named = listeners.get(name);
      if (!named) {
        named = new Set();
        listeners.set(name, named);
      }
      const stored = listener as AnyListener;
      named.add(stored);
      return () => {
        named.delete(stored);
      };
    },
    once(name, listener) {
      const off = bus.on(name, (payload) => {
        off();
        listener(payload);
      });
      return off;
    },
    onAny(listener) {
      const stored = listener as WildcardListener;
      wildcard.add(stored);
      return () => {
        wildcard.delete(stored);
      };
    },
    listenerCount(name) {
      if (name !== undefined) {
        return listeners.get(name)?.size ?? 0;
      }
      let total = wildcard.size;
      for (const set of listeners.values()) {
        total += set.size;
      }
      return total;
    },
    clear() {
      listeners.clear();
      wildcard.clear();
    },
  };
  return bus;
}
