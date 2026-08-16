/**
 * Maps a child's already-chosen `ChildProfile.avatarKey`
 * (`src/features/child-profile/constants.ts`'s `AVATAR_OPTIONS`, picked once
 * by a parent at profile-creation time) onto a procedurally-drawable look
 * for the Welcome Harbor avatar sprite
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 19,
 * "initial avatar customization"). No new UI or schema: this only changes
 * how the avatar already picked elsewhere is *rendered* in the world.
 */
import type { AvatarValue } from '../child-profile/constants';

export type AvatarAccessory = 'EARS' | 'ANTENNA' | 'FIN' | 'SPIKES' | 'NONE';

export interface AvatarAppearance {
  body: number;
  accent: number;
  accessory: AvatarAccessory;
}

/** Phase 9's original hardcoded look, kept as the fallback for an unknown/missing avatarKey. */
const FALLBACK_APPEARANCE: AvatarAppearance = {
  body: 0xf4d35e,
  accent: 0xc97a1a,
  accessory: 'NONE',
};

// Chosen to stay visible against every terrain color in tilemap.ts
// (grass 0x2f8f4e, sand 0xd8c48a, water 0x1c3a52, path 0xb08b62) — a body
// color too close to grass or sand would make the avatar hard to see.
const APPEARANCE_BY_AVATAR_KEY: Record<AvatarValue, AvatarAppearance> = {
  FOX: { body: 0xe8743b, accent: 0xffffff, accessory: 'EARS' },
  OWL: { body: 0x8a6d3b, accent: 0xf4d35e, accessory: 'EARS' },
  OTTER: { body: 0x8b5a2b, accent: 0xd9c4a3, accessory: 'NONE' },
  DRAGON: { body: 0xc0392b, accent: 0xf2a541, accessory: 'SPIKES' },
  ROBOT: { body: 0x8ca0b3, accent: 0x2fb6c9, accessory: 'ANTENNA' },
  MERMAID: { body: 0x2fa6b6, accent: 0xf4d3e0, accessory: 'FIN' },
};

/** Falls back to the Phase 9 look rather than throwing on an unrecognized, missing, or null avatarKey. */
export function getAvatarAppearance(avatarKey: string | null | undefined): AvatarAppearance {
  if (!avatarKey) {
    return FALLBACK_APPEARANCE;
  }
  return APPEARANCE_BY_AVATAR_KEY[avatarKey as AvatarValue] ?? FALLBACK_APPEARANCE;
}
