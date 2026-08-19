import type { AdventureStepType } from '../adventures/engine/types';

/**
 * Only these step types have "an unambiguous, conflict-free merge rule"
 * per docs/ADVENTURE_ENGINE.md's "Co-op sessions" section. `WORLD_CHANGE`
 * is included for its "shared-construction" steps (e.g. placing a plank in
 * a specific slot); every other step type stays single-child even inside a
 * coop session.
 */
const COOP_ELIGIBLE_STEP_TYPES: readonly AdventureStepType[] = [
  'NUMBER_INPUT',
  'ORDERING',
  'MATCHING',
  'WORLD_CHANGE',
];

export function isCoopEligibleStepType(type: AdventureStepType): boolean {
  return COOP_ELIGIBLE_STEP_TYPES.includes(type);
}

/**
 * `CoopSession.sharedState`'s shape (amplify/data/resource.ts). `slots` is
 * written only by the atomic `claimCoopSlot` mutation; `presence` is a
 * best-effort, last-write-wins join/leave signal (docs/DECISIONS.md
 * ADR-006 explicitly excludes continuous cursor-level presence from v1).
 */
export interface CoopSharedState {
  slots: Record<string, string>;
  presence: string[];
}

const EMPTY_SHARED_STATE: CoopSharedState = { slots: {}, presence: [] };

/** `CoopSession.sharedState` is untyped JSON on the wire; parse defensively rather than trusting the shape. */
export function parseCoopSharedState(value: unknown): CoopSharedState {
  if (typeof value !== 'object' || value === null) return EMPTY_SHARED_STATE;
  const candidate = value as Partial<CoopSharedState>;
  const slots =
    typeof candidate.slots === 'object' && candidate.slots !== null
      ? Object.fromEntries(
          Object.entries(candidate.slots).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
  const presence = Array.isArray(candidate.presence)
    ? candidate.presence.filter((id): id is string => typeof id === 'string')
    : [];
  return { slots, presence };
}
