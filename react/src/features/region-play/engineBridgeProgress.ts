/**
 * GE-073: what region play tells the engine bridge about a child's progress.
 *
 * An Area whose one checkpoint list lives in `scene.engineBridge` (`gameplay.checkpoints`) gates
 * each checkpoint with `requiresSignalId: "world:<changeKey>"`. The bridge cannot see the server's
 * world changes, so region play feeds them as signals and, once per visit, resumes the child at
 * the furthest checkpoint they have earned. Pure functions; the companion calls the bridge.
 */

/** The bridge's signal for a world change (`world:<key>`, the platform runtime's convention too). */
export function worldSignal(changeKey: string): string {
  return `world:${changeKey}`;
}

export function worldSignals(changeKeys: Iterable<string>): string[] {
  return [...new Set(changeKeys)].map(worldSignal);
}

interface CheckpointEntry {
  id: string;
  requiresSignalId?: string;
}

/** The `gameplay.checkpoints` list of a `scene.engineBridge` block, in authored order. */
export function bridgeCheckpoints(block: unknown): CheckpointEntry[] {
  if (!block || typeof block !== 'object') return [];
  const capabilities = (block as { capabilities?: unknown }).capabilities;
  if (!Array.isArray(capabilities)) return [];
  const request = capabilities.find(
    (entry): entry is { id: string; config?: { checkpoints?: unknown } } =>
      !!entry && typeof entry === 'object' && (entry as { id?: unknown }).id === 'gameplay.checkpoints',
  );
  const list = request?.config?.checkpoints;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const entry = raw as { id?: unknown; requiresSignalId?: unknown };
    if (typeof entry.id !== 'string') return [];
    return [
      typeof entry.requiresSignalId === 'string'
        ? { id: entry.id, requiresSignalId: entry.requiresSignalId }
        : { id: entry.id },
    ];
  });
}

/**
 * The checkpoints this child has earned, in authored order: ungated ones and those whose signal
 * a world change turns on. The bridge's `resume` places the child at the last of them.
 */
export function earnedBridgeCheckpoints(block: unknown, changeKeys: Iterable<string>): string[] {
  const on = new Set(worldSignals(changeKeys));
  return bridgeCheckpoints(block)
    .filter((checkpoint) => !checkpoint.requiresSignalId || on.has(checkpoint.requiresSignalId))
    .map((checkpoint) => checkpoint.id);
}
