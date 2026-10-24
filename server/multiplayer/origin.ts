/**
 * Browsers always send `Origin` on a WebSocket upgrade, so a missing one is
 * a non-browser caller and is refused along with any origin not listed
 * exactly. This is defence in depth: the Cognito token is what actually
 * authorizes a seat.
 */
export function isAllowedOrigin(origin: string | null, allowedOrigins: readonly string[]): boolean {
  return origin !== null && allowedOrigins.includes(origin);
}
