import { getChildProfile } from './api';
import type { AgeBandValue } from './constants';
import type { ChildProfile } from './profileTypes';

/**
 * The few child settings a play screen needs: the age band, the parent's AI switch and the
 * session limit. Null when the child does not exist or is not this parent's.
 *
 * Read through the profile store (api.ts), so it comes from Django in every build with the
 * Django API, under either sign-in (LAI-CHILD-001; it followed the sign-in mode under
 * LAI-AUTH-DUAL).
 */
export interface ChildPlaySettings {
  ageBand: AgeBandValue;
  aiEnabled: boolean;
  sessionMinutes: number | null;
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
    sessionMinutes: child.sessionMinutes,
  };
}
