/**
 * Encoding for `a.json()` columns (amplify/data/resource.ts).
 *
 * `a.json()` is AppSync's `AWSJSON` scalar, which travels the wire as a
 * JSON-encoded **string**, not as an object. Passing a raw object to a
 * mutation makes AppSync reject the whole call with "Variable '<field>' has
 * an invalid value", and a live read hands the string back rather than a
 * parsed value.
 *
 * This module exists because that mistake was made independently at four
 * call sites - `ChildNpcState.memoryFlags`, `StoryArtifact.scenes`,
 * `ChildStoryProgress.storyFlags`, and `CoopSession.sharedState` - and every
 * one of them shipped. Unit tests could not catch any of them: they mock the
 * data client, which accepts an object happily. Only a call against a
 * deployed sandbox fails.
 *
 * Use `encodeAwsJson` on every write to an `a.json()` column and
 * `decodeAwsJson` at the top of every parser that reads one.
 */

/** Encodes a value for an `a.json()` column. Always use this on write. */
export function encodeAwsJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Normalizes what a read returned into a plain value.
 *
 * Accepts a JSON string (what a live AppSync read returns) and an
 * already-decoded value (what tests, fixtures, and any client that parsed it
 * first provide), so a parser built on this works in both worlds. Malformed
 * JSON degrades to `null` rather than throwing: stored JSON is external data
 * at read time (CLAUDE.md section 13), and every caller already has a
 * defensive shape check after this.
 */
export function decodeAwsJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
