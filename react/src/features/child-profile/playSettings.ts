import { getChildProfile } from './api';
import type { AgeBandValue } from './constants';
import type { ChildProfile } from './profileTypes';

/**
 * The few child settings a play screen needs: the age band, the parent's AI switch, and the
 * chosen avatar.
 * There is no session limit: children are never stopped for play time. Null when the child
 * does not exist or is not this parent's.
 *
 * Read through the profile store (api.ts), so it comes from Django in every build with the
 * Django API (LAI-CHILD-001).
 */
export interface ChildPlaySettings {
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  /** The avatar the parent chose (LAI-JMP-01a: the look of the child's 3D avatar). */
  avatarKey: string;
}

export async function getChildPlaySettings(
  childId: string,
  options: { read?: (id: string) => Promise<ChildProfile | null> } = {},
): Promise<ChildPlaySettings | null> {
  if (!childId) return null;
  const child = await (options.read ?? getChildProfile)(childId);
  if (!child) return null;
  return {
    ageBand: child.ageBand,
    aiEnabled: child.aiEnabled,
    avatarKey: child.avatarKey,
  };
}
