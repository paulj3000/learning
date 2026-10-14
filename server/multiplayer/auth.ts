import type { AvatarValue } from '../../src/features/child-profile/constants';
import { parseJoinOptions, toAvatarKey } from '../../src/features/multiplayer/protocol';

/**
 * Who is asking for a seat, re-derived on the server (docs/DECISIONS.md
 * ADR-026 part C). Nothing the client says about itself is trusted:
 *
 * 1. the Cognito ID token must verify (signature, issuer, audience, expiry);
 * 2. the household key must be the one this server computes from that
 *    token's `sub`, so a client cannot aim at another family's room;
 * 3. the child must belong to that parent: AppSync returns the row only to
 *    its owner, and `ownerSub` must match too (the `claimCoopSlot` /
 *    `submitAdventureAnswer` pattern, ADR-012).
 *
 * Every rejection is the same opaque error to the client. The reason stays
 * on the server, for tests and counters, and never names the child.
 */

export interface VerifiedIdentity {
  sub: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface ChildProfileRecord {
  id: string;
  ownerSub: string | null;
  /** Amplify's owner field, `<sub>::<username>`; the fallback for rows written before `ownerSub`. */
  owner: string | null;
  avatarKey: string | null;
}

export interface PlayerAuthDeps {
  verifyIdToken(token: string): Promise<VerifiedIdentity>;
  /** The child profile as the token's owner sees it, or null if AppSync says it is not theirs. */
  fetchOwnChildProfile(idToken: string, childProfileId: string): Promise<ChildProfileRecord | null>;
  householdKeyFor(sub: string): Promise<string>;
}

export interface AuthenticatedPlayer {
  regionId: string;
  householdKey: string;
  childProfileId: string;
  avatarKey: AvatarValue | null;
  tokenExpiresAt: number;
}

export type AuthRejection =
  | 'BAD_OPTIONS'
  | 'MISSING_TOKEN'
  | 'INVALID_TOKEN'
  | 'NOT_YOUR_HOUSEHOLD'
  | 'NOT_YOUR_CHILD'
  | 'LOOKUP_FAILED';

export class PlayerAuthRejected extends Error {
  readonly reason: AuthRejection;

  constructor(reason: AuthRejection) {
    super(`Seat refused: ${reason}`);
    this.name = 'PlayerAuthRejected';
    this.reason = reason;
  }
}

export type PlayerAuthenticator = (
  token: string | undefined,
  rawOptions: unknown,
) => Promise<AuthenticatedPlayer>;

function ownedBy(profile: ChildProfileRecord, sub: string): boolean {
  if (profile.ownerSub) return profile.ownerSub === sub;
  return profile.owner?.split('::')[0] === sub;
}

export function createPlayerAuthenticator(deps: PlayerAuthDeps): PlayerAuthenticator {
  return async (token, rawOptions) => {
    const options = parseJoinOptions(rawOptions);
    if (!options) throw new PlayerAuthRejected('BAD_OPTIONS');
    if (!token) throw new PlayerAuthRejected('MISSING_TOKEN');

    let identity: VerifiedIdentity;
    try {
      identity = await deps.verifyIdToken(token);
    } catch {
      throw new PlayerAuthRejected('INVALID_TOKEN');
    }

    if ((await deps.householdKeyFor(identity.sub)) !== options.householdKey) {
      throw new PlayerAuthRejected('NOT_YOUR_HOUSEHOLD');
    }

    let profile: ChildProfileRecord | null;
    try {
      profile = await deps.fetchOwnChildProfile(token, options.childProfileId);
    } catch {
      throw new PlayerAuthRejected('LOOKUP_FAILED');
    }
    if (!profile || profile.id !== options.childProfileId || !ownedBy(profile, identity.sub)) {
      throw new PlayerAuthRejected('NOT_YOUR_CHILD');
    }

    return {
      regionId: options.regionId,
      householdKey: options.householdKey,
      childProfileId: profile.id,
      avatarKey: toAvatarKey(profile.avatarKey),
      tokenExpiresAt: identity.expiresAt,
    };
  };
}
