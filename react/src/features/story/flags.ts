import { decodeAwsJson } from '../../lib/awsJson';

/** `storyFlags` is untyped JSON on the wire; parse defensively rather than trusting the shape, same precedent as `parseStoryScenes` in adventures/api.ts. */
export function parseStoryFlags(flags: unknown): Record<string, string> {
  const decoded = decodeAwsJson(flags);
  if (typeof decoded !== 'object' || decoded === null) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(decoded as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}
