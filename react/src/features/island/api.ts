import { childPath, djangoClient } from '../../api/djangoClient';
import { read } from '../../api/parse';

/**
 * The companion a child chose at Welcome Harbor, on Django (`children/<id>/companion/`, AMP-03).
 * One choice per child; only an authored companion type is ever sent, never a name.
 */
export type CompanionType = 'CHATTY_PARROT';

export interface CompanionProfile {
  childProfileId: string;
  companionType: CompanionType;
  /** Authored by the server for the type ("Chatty"). */
  displayName: string;
  chosenAt: string;
}

const COMPANION_TYPES = ['CHATTY_PARROT'] as const;

function readCompanion(data: unknown, childProfileId: string): CompanionProfile | null {
  return read(data, (r) =>
    r.field('companion').nullable((c) => ({
      childProfileId,
      companionType: c.field('companionType').oneOf(COMPANION_TYPES),
      displayName: c.field('displayName').string(),
      chosenAt: c.field('chosenAt').string(),
    })),
  );
}

/** This child's companion, or null before they choose one. */
export async function getCompanionProfile(
  childProfileId: string,
): Promise<CompanionProfile | null> {
  const response = await djangoClient().request('GET', childPath(childProfileId, 'companion/'));
  return readCompanion(response.data, childProfileId);
}

/** Chooses Chatty for this child. Idempotent: choosing again keeps the first choice's time. */
export async function getOrCreateCompanionProfile(
  childProfileId: string,
  companionType: CompanionType = 'CHATTY_PARROT',
): Promise<CompanionProfile> {
  const response = await djangoClient().request('PUT', childPath(childProfileId, 'companion/'), {
    body: { companionType },
  });
  const companion = readCompanion(response.data, childProfileId);
  if (!companion) throw new Error('Could not choose a companion.');
  return companion;
}
