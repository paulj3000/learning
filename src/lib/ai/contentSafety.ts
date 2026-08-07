/**
 * Generic, reusable output-safety checks (docs/AI_AND_CHILD_SAFETY.md
 * "Structured response example" validation rules: "no URLs", "no requests
 * for personal information"). Heuristic and intentionally conservative —
 * a false positive just falls back to authored content, which is safe;
 * false negatives are the risk to minimize.
 */

const URL_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co)\b/i;

const PERSONAL_INFO_PATTERNS: RegExp[] = [
  /\bpassword\b/i,
  /\b(your|my) (real )?(full )?name\b/i,
  /\bhome address\b/i,
  /\bphone number\b/i,
  /\bschool('?s)? name\b/i,
  /\bwhere (do|you) live\b/i,
  /\bsend (me |us )?a photo\b/i,
  /\bmeet (up|me) in person\b/i,
  /\bemail address\b/i,
];

export function containsUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

export function requestsPersonalInformation(text: string): boolean {
  return PERSONAL_INFO_PATTERNS.some((pattern) => pattern.test(text));
}
