import { ApiError } from '../../api/errors';

/** Why a Realm catalog read failed, and the child-facing words for it (RealmNotices.tsx). */

export type RealmLoadFailure = 'timeout' | 'network' | 'signed-out' | 'server' | 'other';

export function realmLoadFailure(error: unknown): RealmLoadFailure {
  if (!(error instanceof ApiError)) return 'other';
  if (error.kind === 'network') return error.code === 'timeout' ? 'timeout' : 'network';
  if (error.kind === 'unauthenticated') return 'signed-out';
  if (error.kind === 'server' || error.kind === 'unavailable') return 'server';
  return 'other';
}

export const REALM_NOTICE_COPY = {
  signIn: 'Ask a grown-up to sign in again',
  tryAgain: 'Try again',
  /** A second line saying why, when we know. */
  failure: {
    timeout: 'The island is taking too long to answer.',
    network: 'We could not reach the island.',
    'signed-out': 'A grown-up needs to sign in again.',
    server: 'The island is having a little trouble.',
    other: null,
  } satisfies Record<RealmLoadFailure, string | null>,
} as const;
