import type { ThreeLocationManifest } from './locationManifest';

/** The engine bridge's extension id (the bridge module itself is React-side; this file is not). */
const ENGINE_BRIDGE = 'engineBridge';

/**
 * GE-066: the checkpoint ids an Area's engine bridge serves (`gameplay.checkpoints` in its
 * `engineBridge` extension config, from `scene.engineBridge`). Such a checkpoint stays declared in
 * `manifest.checkpoints.ids` (validation, spawn, authored toasts) but is reached through the
 * bridge alone, so the live runtime builds no trigger zone for it and nothing fires twice.
 * Pure; tolerant of any shape (an unexpected config serves nothing).
 */
export function bridgeCheckpointIds(
  manifest: Pick<ThreeLocationManifest, 'extensions'>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const binding of manifest.extensions ?? []) {
    if (binding.extensionId !== ENGINE_BRIDGE) continue;
    const capabilities = (binding.config as { capabilities?: unknown }).capabilities;
    if (!Array.isArray(capabilities)) continue;
    for (const entry of capabilities) {
      const request = entry as { id?: unknown; config?: { checkpoints?: unknown } } | null;
      if (
        !request ||
        request.id !== 'gameplay.checkpoints' ||
        !Array.isArray(request.config?.checkpoints)
      )
        continue;
      for (const point of request.config.checkpoints as { id?: unknown }[]) {
        if (point && typeof point.id === 'string') ids.add(point.id);
      }
    }
  }
  return ids;
}
