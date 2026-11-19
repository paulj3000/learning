/**
 * Multiplayer boundary. Shared 3D presence is **deferred** (ADR-020), and CLAUDE.md section 12
 * keeps social features, child-to-child messaging and public profiles out of scope.
 *
 * This port documents what may ever cross the boundary: **presence ids only** (opaque,
 * server-issued, never a name, profile id, chat text, position history or avatar data).
 * The default implementation is disabled: it reports no peers and ignores everything.
 */

import { defineService } from '../core/services';

export interface MultiplayerPort {
  /** Always false until an ADR enables shared presence. */
  readonly enabled: boolean;
  /** Opaque presence ids of other players in the same area. Empty while disabled. */
  presenceIds(): readonly string[];
  subscribe(listener: (presenceIds: readonly string[]) => void): () => void;
}

export const MULTIPLAYER = defineService<MultiplayerPort>('lai.multiplayer');

/** The default: disabled, no peers, no network. */
export function createDisabledMultiplayer(): MultiplayerPort {
  return {
    enabled: false,
    presenceIds: () => [],
    subscribe: () => () => undefined,
  };
}
