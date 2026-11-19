/**
 * Save and Restore port: engine-local **presentation** state only (where the player stood,
 * which camera mode, which doors the server already confirmed open). It is versioned,
 * strict (an unknown key is an error, so nothing can ride along) and holds no child data:
 * no names, ids of the child, free text or scores.
 *
 * Server state always wins. `reconcileSnapshot` restores positions and presentation, and
 * keeps only the open doors the server also reports open; it never opens anything itself.
 */

import type { ValidationIssue, ValidationResult } from '../core/errors';
import { defineService } from '../core/services';
import { SEMANTIC_ID } from '../contracts/gameplayEvents';
import { isRecord } from '../sdk/validation';

export const PRESENTATION_SNAPSHOT_VERSION = 1 as const;

import { isCameraMode, type CameraMode } from '../camera/playerPresentation';

/** The shared camera's own mode values (`first-person`, `third-person`), never a second vocabulary. */
export type { CameraMode };

export interface PresentationSnapshot {
  version: typeof PRESENTATION_SNAPSHOT_VERSION;
  adventureId: string;
  areaId: string;
  player: { x: number; y: number; z: number; yaw: number };
  cameraMode: CameraMode;
  /** Doors the server had already confirmed open when this was saved. */
  confirmedOpenDoorIds: string[];
}

export interface SaveRestorePort {
  save(snapshot: PresentationSnapshot): void;
  /** The saved snapshot for an adventure, or null when none or it fails validation. */
  load(adventureId: string): PresentationSnapshot | null;
  clear(adventureId: string): void;
}

export const SAVE_RESTORE = defineService<SaveRestorePort>('lai.saveRestore');

const TOP_KEYS = ['version', 'adventureId', 'areaId', 'player', 'cameraMode', 'confirmedOpenDoorIds'];
const POSITION_LIMIT = 100_000;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= POSITION_LIMIT;
}

export function validatePresentationSnapshot(input: unknown): ValidationResult<PresentationSnapshot> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  for (const key of Object.keys(input)) {
    if (!TOP_KEYS.includes(key)) {
      issues.push({ path: key, message: 'is not part of the snapshot contract (no child data may ride along)' });
    }
  }
  if (input.version !== PRESENTATION_SNAPSHOT_VERSION) {
    issues.push({ path: 'version', message: `must be ${PRESENTATION_SNAPSHOT_VERSION}` });
  }
  for (const key of ['adventureId', 'areaId'] as const) {
    if (typeof input[key] !== 'string' || !SEMANTIC_ID.test(input[key] as string)) {
      issues.push({ path: key, message: 'must be a semantic id' });
    }
  }
  const player = input.player;
  if (!isRecord(player)) {
    issues.push({ path: 'player', message: 'must be an object { x, y, z, yaw }' });
  } else {
    for (const key of Object.keys(player)) {
      if (!['x', 'y', 'z', 'yaw'].includes(key)) {
        issues.push({ path: `player.${key}`, message: 'is not part of the snapshot contract' });
      }
    }
    for (const key of ['x', 'y', 'z', 'yaw'] as const) {
      if (!finite(player[key])) {
        issues.push({ path: `player.${key}`, message: 'must be a finite number' });
      }
    }
  }
  if (!isCameraMode(input.cameraMode)) {
    issues.push({ path: 'cameraMode', message: 'must be first-person or third-person' });
  }
  if (!Array.isArray(input.confirmedOpenDoorIds)) {
    issues.push({ path: 'confirmedOpenDoorIds', message: 'must be an array of door ids' });
  } else {
    input.confirmedOpenDoorIds.forEach((id: unknown, index) => {
      if (typeof id !== 'string' || !SEMANTIC_ID.test(id)) {
        issues.push({ path: `confirmedOpenDoorIds[${index}]`, message: 'must be a semantic id' });
      }
    });
  }
  return issues.length === 0 ? { ok: true, value: input as unknown as PresentationSnapshot, issues: [] } : { ok: false, issues };
}

export interface ServerWorldState {
  /** Doors the server currently reports open. */
  openDoorIds: readonly string[];
}

/**
 * Applies server state over a snapshot: position and camera come from the snapshot, but a door
 * is open only if the server says so now. A door the snapshot thought open and the server
 * does not is reported in `droppedDoorIds` (and stays closed).
 */
export function reconcileSnapshot(
  snapshot: PresentationSnapshot,
  server: ServerWorldState,
): { snapshot: PresentationSnapshot; droppedDoorIds: string[] } {
  const open = new Set(server.openDoorIds);
  const kept = snapshot.confirmedOpenDoorIds.filter((id) => open.has(id));
  const droppedDoorIds = snapshot.confirmedOpenDoorIds.filter((id) => !open.has(id));
  return { snapshot: { ...snapshot, confirmedOpenDoorIds: kept }, droppedDoorIds };
}

export function createFakeSaveRestore(): SaveRestorePort & { readonly size: number } {
  const store = new Map<string, string>();
  return {
    get size() {
      return store.size;
    },
    save(snapshot) {
      const result = validatePresentationSnapshot(snapshot);
      if (result.ok) {
        // Stored serialised, like a real storage backend: callers cannot mutate saved state.
        store.set(snapshot.adventureId, JSON.stringify(snapshot));
      }
    },
    load(adventureId) {
      const raw = store.get(adventureId);
      if (raw === undefined) {
        return null;
      }
      const result = validatePresentationSnapshot(JSON.parse(raw));
      return result.ok ? result.value : null;
    },
    clear(adventureId) {
      store.delete(adventureId);
    },
  };
}
