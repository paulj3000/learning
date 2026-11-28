/**
 * Which bands play the guided tap-to-move mode (LAI-2104S). The profile's `guidedSteering`
 * decides: true for Sprouts, false for Pathfinders and Explorers (`sdk/profiles.ts`), so a
 * content override of that flag is honoured here too.
 */

import { defaultMovementProfile, isAgeBand, type ProfileOverrides } from '../sdk/profiles';

/** True when a child of `band` moves by tapping a path (Sprouts). Unknown bands: false. */
export function isGuidedBand(band: unknown, overrides: ProfileOverrides['movement'] = {}): boolean {
  if (!isAgeBand(band)) return false;
  return overrides?.guidedSteering ?? defaultMovementProfile(band).guidedSteering;
}
