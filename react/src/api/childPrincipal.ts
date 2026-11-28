/**
 * Who the API client acts as when a child signed in on their own (LAI-AUTH child sign-in, ADR-075).
 *
 * A child session is an HttpOnly cookie JavaScript cannot read, plus a CSRF token the server
 * returns in the session body. This module is the one place the client learns "a child session
 * is active": the `ChildSessionProvider` sets it after the server verified the session, and
 * nothing else does. The principal is only a transport mode (no Authorization header, cookies,
 * CSRF on writes). It never grants anything: the server decides what the cookie may do.
 */

export interface ChildPrincipalAccess {
  /** The CSRF token of the active child session, or null when no child session is active. */
  csrfToken(): string | null;
  /** Reopens the session from the remembered device. Resolves the new CSRF token, or null. */
  restore(): Promise<string | null>;
  /** The server no longer accepts this session and it could not be restored. */
  expired(): void;
}

interface Handlers {
  restore: () => Promise<string | null>;
  expired: () => void;
}

let csrf: string | null = null;
let handlers: Handlers | null = null;

export function setChildPrincipal(csrfToken: string | null): void {
  csrf = csrfToken;
}

export function registerChildPrincipalHandlers(next: Handlers | null): void {
  handlers = next;
}

/** The process-wide principal the Django clients read by default. */
export const childPrincipal: ChildPrincipalAccess = {
  csrfToken: () => csrf,
  restore: () => (handlers ? handlers.restore() : Promise.resolve(null)),
  expired: () => handlers?.expired(),
};

export const CHILD_CSRF_HEADER = 'X-LAI-Child-CSRF';
