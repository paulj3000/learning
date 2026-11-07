import { useEffect, useState } from 'react';
import { audioSettingsApiFor, type AudioSettingsApi } from '../../api/audio/audioSettingsApi';
import { createDefaultSettings } from '../../audio/AudioChannels';
import type { SoundSettings, SoundSettingsPatch } from '../../audio/AudioTypes';
import { AudioMixControls } from '../../audio/ui/AudioMixControls';

type Phase = 'loading' | 'ready' | 'unavailable' | 'saving' | 'saved' | 'failed';

export interface ParentAudioSettingsProps {
  childId: string;
  /** Tests pass their own; the default is the Django API for this child. */
  apiFor?: (childId: string) => AudioSettingsApi | null;
}

function merge(base: SoundSettings, patch: SoundSettingsPatch): SoundSettings {
  const channels = { ...base.channels };
  for (const [id, change] of Object.entries(patch.channels ?? {})) {
    const channel = id as keyof SoundSettings['channels'];
    channels[channel] = { ...channels[channel], ...change };
  }
  return {
    masterVolume: patch.masterVolume ?? base.masterVolume,
    masterMuted: patch.masterMuted ?? base.masterMuted,
    reducedIntensity: patch.reducedIntensity ?? base.reducedIntensity,
    channels,
  };
}

/**
 * A parent sets one child's sound here (SM-P5). It reads and writes only the child in the URL
 * through the same child-scoped route the game uses, and never touches the live Sound Manager:
 * the child's own device loads the saved mix when the child next plays. It does not preview sound.
 */
export function ParentAudioSettings({
  childId,
  apiFor = audioSettingsApiFor,
}: ParentAudioSettingsProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [settings, setSettings] = useState<SoundSettings>(createDefaultSettings);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let current = true;
    const api = apiFor(childId);
    setDirty(false);
    if (!api) {
      setPhase('unavailable');
      return undefined;
    }
    setPhase('loading');
    api
      .get()
      .then((loaded) => {
        if (!current) return; // another child was chosen meanwhile: never show this answer
        setSettings(loaded);
        setPhase('ready');
      })
      .catch(() => {
        if (current) setPhase('failed');
      });
    return () => {
      current = false;
    };
  }, [childId, apiFor]);

  async function save() {
    const api = apiFor(childId);
    if (!api) return;
    setPhase('saving');
    try {
      const saved = await api.save(settings);
      setSettings(saved);
      setDirty(false);
      setPhase('saved');
    } catch {
      setPhase('failed');
    }
  }

  return (
    <section aria-labelledby="parent-audio-title">
      <h2 id="parent-audio-title">Sound</h2>
      <p>
        Choose how loud this child&apos;s game sounds are. They load the next time your child plays.
      </p>
      {phase === 'unavailable' ? <p role="status">Sound settings are not available here.</p> : null}
      {phase === 'loading' ? <p role="status">Loading sound settings...</p> : null}
      {phase === 'failed' ? (
        <p role="alert">We could not reach the sound settings. Please try again.</p>
      ) : null}
      {phase !== 'unavailable' && phase !== 'loading' ? (
        <>
          <AudioMixControls
            settings={settings}
            idPrefix={`parent-audio-${childId}`}
            disabled={phase === 'saving'}
            onChange={(patch) => {
              setSettings((current) => merge(current, patch));
              setDirty(true);
              setPhase('ready');
            }}
          />
          <button type="button" onClick={() => void save()} disabled={!dirty || phase === 'saving'}>
            Save sound settings
          </button>
          {phase === 'saved' ? <p role="status">Sound settings saved.</p> : null}
        </>
      ) : null}
    </section>
  );
}
