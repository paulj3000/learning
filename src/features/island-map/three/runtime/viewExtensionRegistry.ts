import type { ComponentType } from 'react';
import type { AgeBandValue } from '../../../child-profile/constants';
import type { WorldInteraction, WorldInteractionContext } from '../../worldObjects';
import type { WorldEngineEventBus } from '../worldEngineEvents';
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

/**
 * What a persistent companion gets. Where an `Overlay` is opened by one
 * interaction and closed again, a `Companion` is mounted for the whole visit
 * - which is what a region whose learning *runs in the room* needs: the
 * castle resumes a session left open yesterday, drives an NPC's gestures
 * from the rung of the hint ladder the child is on, and turns a row of
 * seated plates into an answer. None of that can wait for a child to open
 * a panel.
 */
export interface LocationCompanionProps {
  childId: string;
  ageBand: AgeBandValue;
  /** The parent's AI setting for this child, as every adventure host needs it. */
  aiEnabled: boolean;
  config: { readonly [key: string]: JsonValue };
  /** The region's event bus, for a companion that listens to the room. */
  bus: WorldEngineEventBus;
  /** Whatever the scene half returned as `api`, or `null` before the engine is up. */
  sceneApi: unknown;
  /** The child's world state as the view last read it. */
  worldState: WorldInteractionContext;
  /**
   * The interaction this extension claimed and the child just opened, or
   * `null`. The view renders nothing itself for a claimed interaction, so a
   * companion decides what opening it means.
   */
  claimedInteraction: WorldInteraction | null;
  /**
   * Whatever interaction is open on screen right now, claimed or not, for a
   * companion that reacts to one it does not own: the castle's Keeper Quill
   * talks while his own conversation panel is up and points through the
   * archway when it closes, and that panel is the generic one.
   */
  openInteraction: WorldInteraction | null;
  /** Clears the claimed interaction, as a panel's "Not now" does. */
  onCloseInteraction(): void;
  /** Says something in the HUD, the same toast a zone or a pickup uses. */
  showToast(message: string): void;
  /**
   * Overrides what the crosshair says. A companion that knows an entity
   * better than the manifest does uses it: a portrait's label is "A clever
   * fox" - the option's own words, from the adventure being played - rather
   * than "a portrait".
   */
  setFocusLabel(label: string | null): void;
  /** Whether the session's time is up, for a region that stages a calm stop in the room. */
  limitReached: boolean;
  /** Re-reads world changes, inventory and discoveries. */
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
  /**
   * Rendered when a claimed interaction opens. Omit it when the extension
   * uses a `Companion` instead, which then receives `openedInteraction`.
   */
  Overlay?: ComponentType<LocationViewExtensionOverlayProps>;
  /** Mounted for the whole visit, whenever the manifest declares this extension. */
  Companion?: ComponentType<LocationCompanionProps>;
}

export type LocationViewExtensionRegistry = Registry<LocationViewExtension>;

export function createViewExtensionRegistry(
  extensions: readonly LocationViewExtension[],
): LocationViewExtensionRegistry {
  return createRegistry(extensions, 'view extensions');
}
