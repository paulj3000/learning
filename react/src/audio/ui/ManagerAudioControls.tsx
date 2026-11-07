import { useSoundManager, useSoundSettings } from '../react/hooks';
import { AudioMixControls } from './AudioMixControls';

/**
 * The mix controls bound to the shared Sound Manager. A change applies to what is playing at once
 * (no restart), and the child-preferences sync saves it. Use it inside any game's panel.
 */
export function ManagerAudioControls({ idPrefix }: { idPrefix?: string }) {
  const manager = useSoundManager();
  const settings = useSoundSettings();
  return (
    <AudioMixControls
      settings={settings}
      idPrefix={idPrefix}
      onChange={(patch) => manager.applySettings(patch)}
    />
  );
}
