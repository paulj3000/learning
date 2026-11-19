/**
 * GE-070 (decision E15): one claim sink per location visit.
 *
 * Gameplay claims (`lai.gameplay-event` v1) come from two places in the live location runtime:
 * the engine bridge extension (registered once, at module load) and a region's companion (for
 * Treasure Rush, `RegionPlayCompanion`). Both need the same sink and the same claim context, but
 * the context (the visit's `AdventureSession`) only exists once the visit is under way. This
 * router holds both for the visit:
 *
 * - `ThreeLocationWorldView` sets the sink from its `onGameplayEvent` prop for its lifetime;
 * - the companion sets the claims binding once the server session exists, and clears it on leaving;
 * - the bridge reads `currentClaimsBinding` lazily and forwards through `forwardClaim`.
 *
 * Claims are facts for Django to confirm, never awards. An invalid claim, or a sink that throws,
 * is dropped and counted, never thrown into a child's play. Nothing here holds child data.
 */

import {
  createGameplayEventFactory,
  validateGameplayEvent,
  type AnyGameplayEvent,
  type GameplayEventContext,
  type GameplayEventFactory,
  type GameplayEventPayloads,
  type GameplayEventType,
} from '@lai/game-engine/contracts';

export type GameplayClaimSink = (event: AnyGameplayEvent) => void;

/** The bridge's `ClaimsBinding` shape: one object per visit, so its claim factory is reused. */
export interface LocationClaimsBinding {
  readonly context: Readonly<GameplayEventContext>;
}

let sink: GameplayClaimSink | null = null;
let binding: LocationClaimsBinding | null = null;
let dropped = 0;

/** Sets the visit's sink. Returns a release that clears it only if it is still this sink. */
export function setLocationClaimSink(next: GameplayClaimSink | null): () => void {
  sink = next;
  return () => {
    if (sink === next) sink = null;
  };
}

/**
 * Sets the visit's claim context. The same object is returned by `currentClaimsBinding` until it
 * changes, so the bridge keeps one factory per visit. Returns a release, as above.
 */
export function setLocationClaimsBinding(context: GameplayEventContext | null): () => void {
  const next = context ? Object.freeze({ context: Object.freeze({ ...context }) }) : null;
  binding = next;
  return () => {
    if (binding === next) binding = null;
  };
}

/** The current visit's binding, or null before the session exists (the bridge then emits nothing). */
export function currentClaimsBinding(): LocationClaimsBinding | null {
  return binding;
}

/** Forwards a claim to the visit's sink. Never throws. No sink means nobody is listening. */
export function forwardClaim(event: AnyGameplayEvent): void {
  if (!sink) return;
  try {
    const checked = validateGameplayEvent(event);
    if (!checked.ok) {
      dropped += 1;
      return;
    }
    sink(checked.value);
  } catch {
    dropped += 1;
  }
}

let factoryFor: { binding: LocationClaimsBinding; factory: GameplayEventFactory } | null = null;

/**
 * Builds a claim for the current visit and forwards it (a host's own claims, such as region
 * play's). Nothing happens before the visit's session exists. Never throws: a claim the factory
 * refuses is dropped and counted.
 */
export function emitLocationClaim<T extends GameplayEventType>(
  type: T,
  payload: GameplayEventPayloads[T],
): void {
  const current = binding;
  if (!current || !sink) return;
  try {
    if (factoryFor?.binding !== current) {
      factoryFor = { binding: current, factory: createGameplayEventFactory(current.context) };
    }
    forwardClaim(factoryFor.factory.create(type, payload) as AnyGameplayEvent);
  } catch {
    dropped += 1;
  }
}

/** Claims dropped because they were invalid or the sink threw. A count only, no content. */
export function droppedLocationClaims(): number {
  return dropped;
}

/** Test support: forget the sink, binding and count. */
export function resetLocationClaimsForTests(): void {
  sink = null;
  binding = null;
  factoryFor = null;
  dropped = 0;
}
