import type { PlatformingSpec } from './platformSpec';

/**
 * Child-facing platforming copy (ages 3 to 8): short, warm, readable aloud, never a "fail".
 * A missed jump is never a loss: the child goes back to a safe spot and tries again.
 */

export function checkpointReachedText(label: string): string {
  return `Safe spot: ${label}. If you slip, you will come back here.`;
}

export function recoveredText(
  spec: PlatformingSpec | undefined,
  checkpointId: string | null | undefined,
  /** Labels of checkpoints kept elsewhere (the engine bridge's list, GE-073), by id. */
  labels?: ReadonlyMap<string, string>,
): string {
  const label = checkpointId
    ? (spec?.checkpoints?.find((point) => point.id === checkpointId)?.label ?? labels?.get(checkpointId))
    : undefined;
  const lead = spec?.recoveryLead?.trim();
  if (label) return `${lead || 'Splash!'} Back to ${label}. Have another go!`;
  return lead ? `${lead} Back on solid ground. Have another go!` : 'Whoops! Back on solid ground. Have another go!';
}
