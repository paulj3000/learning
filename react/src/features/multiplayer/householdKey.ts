/**
 * A stable, non-reversible key for one parent account, used to group that
 * family's children into the same room (docs/DECISIONS.md ADR-026 part D).
 *
 * The matchmaker filters rooms on this value before it has authenticated
 * anyone, so it must not be the raw Cognito `sub`. The server recomputes it
 * from the verified token and rejects any mismatch, so a client cannot use
 * it to reach another family's room.
 *
 * Uses Web Crypto, which both browsers and Node 22+ provide globally.
 */
export async function householdKeyFor(sub: string): Promise<string> {
  const bytes = new TextEncoder().encode(`learning-adventure-island:household:${sub}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
