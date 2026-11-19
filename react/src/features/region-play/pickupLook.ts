/**
 * What a region pickup looks like while its asset library model is not drawn (Feather defect,
 * 2026-11-15).
 *
 * TR-14 drew every pickup as a gold key, because the beach key was the only pickup then. Pirate's
 * Leap later added a Sparkly Shell and a Parrot Feather as pickups with no model, so both showed
 * up as keys. The look is now chosen per pickup, never defaulting to a key:
 *
 * 1. the placement's asset library id, when it names one (`feather`, a `...key...` model);
 * 2. else the placement's own words: its entity id and label (`cove-leap-feather`, "Parrot
 *    feather"; `cove-beach-key`, "Old brass key"), which already exist in every saved region;
 * 3. else a neutral sparkling gem: an unknown pickup is never dressed as something it is not.
 *
 * Pure, so the mapping is testable without a scene.
 */

export const PICKUP_LOOKS = ['FEATHER', 'SHELL', 'KEY', 'GEM'] as const;
export type PickupLook = (typeof PICKUP_LOOKS)[number];

export function isPickupLook(value: unknown): value is PickupLook {
  return (PICKUP_LOOKS as readonly unknown[]).includes(value);
}

interface PickupWords {
  entityId: string;
  label?: string | null;
  assetId?: string | null;
}

const BY_WORD: readonly [RegExp, PickupLook][] = [
  [/feather/i, 'FEATHER'],
  [/shell/i, 'SHELL'],
  // A whole word, so "keepsake" or "monkey" is never a key.
  [/(^|[^a-z])key([^a-z]|$)/i, 'KEY'],
];

export function pickupLook({ entityId, label, assetId }: PickupWords): PickupLook {
  for (const text of [assetId ?? '', `${entityId} ${label ?? ''}`]) {
    if (!text) continue;
    for (const [pattern, look] of BY_WORD) if (pattern.test(text)) return look;
  }
  return 'GEM';
}
