import { djangoClient, childPath } from '../../api/djangoClient';
import type { ApiClient } from '../../api/client';
import { isApiError } from '../../api/errors';

/**
 * A parent's management of one child's own sign-in (`/children/<id>/sign-in/...`), with the
 * parent's bearer token as for every other parent call. Passwords are only ever passed through
 * to the request body: they are never stored, logged or returned.
 */

export type SignInStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED';

export interface SignInInfo {
  status: SignInStatus;
  username: string;
  createdAt: string;
  passwordSetAt: string | null;
  activeSessions: number;
  rememberedDevices: number;
}

export interface RecentChange {
  action: string;
  occurredAt: string;
}

export interface SignInOverview {
  consent: { given: boolean; available: boolean };
  signIn: SignInInfo | null;
  recentChanges: RecentChange[];
  /** Present on some management answers: whether the sign-in service was updated too. */
  providerSynced?: boolean;
}

export interface RememberedDevice {
  id: string;
  rememberedAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function parseOverview(data: unknown): SignInOverview {
  const body = isRecord(data) ? data : {};
  const consent = isRecord(body.consent) ? body.consent : {};
  const info = isRecord(body.signIn) ? body.signIn : null;
  const status = info?.status;
  const signIn: SignInInfo | null =
    info && (status === 'PROVISIONING' || status === 'ACTIVE' || status === 'SUSPENDED')
      ? {
          status,
          username: text(info.username),
          createdAt: text(info.createdAt),
          passwordSetAt: typeof info.passwordSetAt === 'string' ? info.passwordSetAt : null,
          activeSessions: count(info.activeSessions),
          rememberedDevices: count(info.rememberedDevices),
        }
      : null;
  const changes = Array.isArray(body.recentChanges) ? body.recentChanges : [];
  return {
    consent: { given: consent.given === true, available: consent.available === true },
    signIn,
    recentChanges: changes
      .filter(isRecord)
      .map((entry) => ({ action: text(entry.action), occurredAt: text(entry.occurredAt) })),
    providerSynced: typeof body.providerSynced === 'boolean' ? body.providerSynced : undefined,
  };
}

export function parseDevices(data: unknown): RememberedDevice[] {
  const list = isRecord(data) && Array.isArray(data.devices) ? data.devices : [];
  return list.filter(isRecord).map((entry) => ({
    id: text(entry.id),
    rememberedAt: text(entry.rememberedAt),
    lastUsedAt: typeof entry.lastUsedAt === 'string' ? entry.lastUsedAt : null,
    expiresAt: text(entry.expiresAt),
  }));
}

export interface SignInManagement {
  overview(childId: string): Promise<SignInOverview>;
  giveConsent(childId: string): Promise<SignInOverview>;
  withdrawConsent(childId: string): Promise<SignInOverview>;
  enable(childId: string, username: string, password: string): Promise<SignInOverview>;
  changeUsername(childId: string, username: string): Promise<SignInOverview>;
  resetPassword(childId: string, password: string): Promise<SignInOverview>;
  suspend(childId: string): Promise<SignInOverview>;
  resume(childId: string): Promise<SignInOverview>;
  signOutEverywhere(childId: string): Promise<SignInOverview>;
  remove(childId: string): Promise<SignInOverview>;
  devices(childId: string): Promise<RememberedDevice[]>;
  forgetDevice(childId: string, deviceId: string): Promise<void>;
}

export function createSignInManagement(client: ApiClient = djangoClient()): SignInManagement {
  const send = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    childId: string,
    rest: string,
    body?: Record<string, unknown>,
  ) => parseOverview((await client.request(method, childPath(childId, rest), { body })).data);
  return {
    overview: (id) => send('GET', id, 'sign-in/'),
    giveConsent: (id) => send('POST', id, 'consents/child-sign-in/'),
    withdrawConsent: (id) => send('DELETE', id, 'consents/child-sign-in/'),
    enable: (id, username, password) => send('POST', id, 'sign-in/', { username, password }),
    changeUsername: (id, username) => send('PATCH', id, 'sign-in/', { username }),
    resetPassword: (id, password) => send('POST', id, 'sign-in/password/', { password }),
    suspend: (id) => send('POST', id, 'sign-in/suspend/'),
    resume: (id) => send('POST', id, 'sign-in/resume/'),
    signOutEverywhere: (id) => send('POST', id, 'sign-in/sign-out-everywhere/'),
    remove: (id) => send('DELETE', id, 'sign-in/'),
    async devices(id) {
      return parseDevices((await client.request('GET', childPath(id, 'sign-in/devices/'))).data);
    },
    async forgetDevice(id, deviceId) {
      await client.request(
        'DELETE',
        childPath(id, `sign-in/devices/${encodeURIComponent(deviceId)}/`),
      );
    },
  };
}

/** Parent-facing words for the errors the sign-in endpoints answer with. */
export function describeManagementError(error: unknown): string {
  if (!isApiError(error)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'login_name_invalid':
      return 'That username cannot be used. Use 4 to 20 lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number, and not the nickname.';
    case 'password_invalid':
      return 'That password cannot be used. Use 8 to 64 characters, with no spaces at the start or end, and do not include the username.';
    case 'login_name_unavailable':
      return 'That username is already taken. Please choose another.';
    case 'consent_required':
      return 'Please give consent for independent sign-in first.';
    case 'consent_unavailable':
      return 'Independent sign-in is not available yet. Consent text has not been approved.';
    case 'child_sign_in_exists':
      return 'This child already has a sign-in.';
    case 'child_identity_unavailable':
      return 'The sign-in service is not available right now. Nothing was changed. Please try again later.';
    default:
      return error.retryable
        ? 'We could not reach the server. Please try again.'
        : 'That did not work. Nothing was changed. Please try again.';
  }
}

export function validateUsername(username: string, nickname: string): string | null {
  if (!/^[a-z0-9][a-z0-9._-]{3,19}$/.test(username)) {
    return 'Use 4 to 20 lowercase letters, numbers, dots, dashes or underscores, starting with a letter or number.';
  }
  if (username === nickname.trim().toLowerCase()) {
    return 'The username must be different from the nickname.';
  }
  return null;
}

export function validateNewPassword(
  password: string,
  confirm: string,
  username: string,
): string | null {
  if (password.length < 8 || password.length > 64) return 'Use 8 to 64 characters.';
  if (password !== password.trim()) return 'Do not start or end the password with a space.';
  if (username !== '' && password.toLowerCase().includes(username.toLowerCase())) {
    return 'The password must not contain the username.';
  }
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}
