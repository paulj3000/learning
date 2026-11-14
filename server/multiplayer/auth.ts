import type { AvatarValue } from '../../react/src/features/child-profile/constants';
import { parseJoinOptions, toAvatarKey } from '../../react/src/features/multiplayer/protocol';

/**
 * Who is asking for a seat, re-derived on the server (docs/DECISIONS.md
 * ADR-026 part C). Nothing the client says about itself is trusted:
 *
 * 1. the Cognito access token must verify (signature, issuer, client id,
 *    `token_use: access`, expiry);
 * 2. the household key must be the one this server computes from that
 *    token's `sub`, so a client cannot aim at another family's room;
 * 3. the child must belong to that parent: the Django API returns
 *    `GET /api/v1/children/<id>/` only to the owning parent (404 for anyone
 *    else), with the same token, so Django's child scoping is the ownership
 *    check and the server re-checks only that the returned id is the one
 *    asked for.
 *
 * Every rejection is the same opaque error to the client. The reason stays
 * on the server, for tests and counters, and never names the child.
 */

export interface VerifiedIdentity {
  sub: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** The two fields the room server keeps from the parent's own view of the child. */
export interface ChildProfileRecord {
  id: string;
  avatarKey: string | null;
}

export interface PlayerAuthDeps {
  verifyAccessToken(token: string): Promise<VerifiedIdentity>;
  /** The child profile as the token's owner sees it, or null if Django says it is not theirs. */
  fetchOwnChildProfile(
    accessToken: string,
    childProfileId: string,
  ): Promise<ChildProfileRecord | null>;
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

export function createPlayerAuthenticator(deps: PlayerAuthDeps): PlayerAuthenticator {
  return async (token, rawOptions) => {
    const options = parseJoinOptions(rawOptions);
    if (!options) throw new PlayerAuthRejected('BAD_OPTIONS');
    if (!token) throw new PlayerAuthRejected('MISSING_TOKEN');

    let identity: VerifiedIdentity;
    try {
      identity = await deps.verifyAccessToken(token);
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
    if (!profile || profile.id !== options.childProfileId) {
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
