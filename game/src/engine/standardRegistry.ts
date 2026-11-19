/**
 * The standard capability registry (GE-001): every engine capability in one registry, so an
 * adventure's capability requests, the SDK validator and the runtime all resolve against the
 * same definitions.
 *
 * Movement (`movement.*`), camera (`camera.*`), character (`character.*`), gameplay components
 * (`gameplay.*`) and environment (`environment.*`). Jumping is `movement.jump`, a standard
 * capability like any other.
 */

import { registerCameraCapabilities } from '../camera/capabilities';
import { registerCharacterCapabilities } from '../character/capabilities';
import { registerGameplayComponents } from '../components/registerGameplayComponents';
import { createCapabilityRegistry, type CapabilityRegistry } from '../core/capabilities';
import type { EventMap } from '../core/eventBus';
import type { EngineRuntime } from '../core/runtime';
import { registerMovementCapabilities } from '../movement/capabilities';

export type StandardRuntime = EngineRuntime<EventMap>;
export type StandardCapabilityRegistry = CapabilityRegistry<StandardRuntime>;

/** A fresh registry with every engine capability registered. Throws on a duplicate id. */
export function createStandardCapabilityRegistry(): StandardCapabilityRegistry {
  const registry = createCapabilityRegistry<StandardRuntime>();
  registerStandardCapabilities(registry);
  return registry;
}

/** Registers every engine capability on an existing registry (a runtime's own, for example). */
export function registerStandardCapabilities(registry: StandardCapabilityRegistry): void {
  registerMovementCapabilities(registry);
  registerCameraCapabilities(registry as CapabilityRegistry);
  registerCharacterCapabilities(registry as CapabilityRegistry);
  registerGameplayComponents(registry);
}
