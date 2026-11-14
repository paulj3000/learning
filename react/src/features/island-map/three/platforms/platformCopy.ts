import type { PlatformingSpec } from './platformSpec';

/**
 * Child-facing platforming copy (ages 3 to 8): short, warm, readable aloud, never a "fail".
 * A missed jump is never a loss: the child goes back to a safe spot and tries again.
 */

export function checkpointReachedText(label: string): string {
  return `Safe spot: ${label}. If you slip, you will come back here.`;
}

export function recoveredText(spec: PlatformingSpec | undefined, checkpointId: string | null | undefined): string {
  const label = checkpointId ? spec?.checkpoints?.find((point) => point.id === checkpointId)?.label : undefined;
  return label ? `Splash! Back to ${label}. Have another go!` : 'Whoops! Back on solid ground. Have another go!';
}
