import type { ComponentType } from 'react';
import type { AgeBandValue } from '../../../child-profile/constants';
import type { WorldInteraction } from '../../worldObjects';
import { createRegistry, type Registry } from './extensionRegistry';
import type { JsonValue } from './locationManifest';

/**
 * The React half of a world extension (ADR-025). Where the scene half
 * (`extensionRegistry.ts`) changes what is in the world, this half changes
 * what happens on screen: it may take over an interaction for some children
 * and render an overlay on the stage. Pirate Builder Bay's tide trial is the
 * first: for an Explorer, walking up to the broken bridge opens "Beat the
 * Tide" instead of the card adventure.
 */
export interface LocationViewExtensionOverlayProps {
  childId: string;
  ageBand: AgeBandValue;
  config: { readonly [key: string]: JsonValue };
  /** Whatever the scene half returned as `api`, or `null` before the engine is up. Narrow it before use. */
  sceneApi: unknown;
  onClose(): void;
  /** Re-reads world changes, inventory and discoveries after the overlay changed the world. */
  refreshWorld(): Promise<void>;
}

export interface LocationViewExtension {
  id: string;
  /**
   * Whether this extension opens instead of the panel for `interaction`.
   * Checked on every way into an interaction (walking up, tapping, the
   * "Things to do here" list), so no entry point can skip it.
   */
  claimsInteraction(
    interaction: WorldInteraction,
    context: { ageBand: AgeBandValue; config: { readonly [key: string]: JsonValue } },
  ): boolean;
  Overlay: ComponentType<LocationViewExtensionOverlayProps>;
}

export type LocationViewExtensionRegistry = Registry<LocationViewExtension>;

export function createViewExtensionRegistry(
  extensions: readonly LocationViewExtension[],
): LocationViewExtensionRegistry {
  return createRegistry(extensions, 'view extensions');
}
