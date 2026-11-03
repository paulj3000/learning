import { AUDIO_CHANNELS } from '../AudioChannels';
import type { AudioChannel, SoundSettings, SoundSettingsPatch } from '../AudioTypes';
import styles from './AudioMixControls.module.css';

export interface AudioMixControlsProps {
  settings: SoundSettings;
  /** Called with the smallest patch for the control the child just used. */
  onChange(patch: SoundSettingsPatch): void;
  /** Prefix for element ids, so two copies on one page do not clash. */
  idPrefix?: string;
  disabled?: boolean;
}

const percent = (volume: number) => Math.round(volume * 100);

interface RowProps {
  id: string;
  label: string;
  volume: number;
  muted: boolean;
  disabled?: boolean;
  onVolume(volume: number): void;
  onMuted(muted: boolean): void;
}

function MixRow({ id, label, volume, muted, disabled, onVolume, onMuted }: RowProps) {
  return (
    <div className={[styles.row, muted ? styles.muted : ''].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.slider}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent(volume)}
        disabled={disabled}
        aria-valuetext={muted ? `${label} is off` : `${percent(volume)} percent`}
        onChange={(event) => onVolume(Number(event.currentTarget.value) / 100)}
      />
      <button
        type="button"
        className={styles.mute}
        aria-pressed={muted}
        aria-label={`Mute ${label}`}
        disabled={disabled}
        onClick={() => onMuted(!muted)}
      >
        {muted ? 'Off' : 'On'}
      </button>
    </div>
  );
}

/**
 * The master and five channel controls, as plain controls over a `SoundSettings` value. It holds
 * no state and knows nothing of the Sound Manager or the server, so the child panel (bound to the
 * manager) and the parent's page (bound to a saved mix) share it. Sliders and buttons are large,
 * native elements: keyboard, switch and screen reader users get them for free. Muting is a
 * separate button, so the remembered volume survives it.
 */
export function AudioMixControls({
  settings,
  onChange,
  idPrefix = 'audio',
  disabled,
}: AudioMixControlsProps) {
  const channelPatch = (channel: AudioChannel, change: { volume?: number; muted?: boolean }) =>
    onChange({ channels: { [channel]: change } });
  return (
    <div className={styles.controls}>
      <MixRow
        id={`${idPrefix}-master`}
        label="Everything"
        volume={settings.masterVolume}
        muted={settings.masterMuted}
        disabled={disabled}
        onVolume={(masterVolume) => onChange({ masterVolume })}
        onMuted={(masterMuted) => onChange({ masterMuted })}
      />
      {AUDIO_CHANNELS.map((channel) => (
        <MixRow
          key={channel.id}
          id={`${idPrefix}-${channel.id}`}
          label={channel.label}
          volume={settings.channels[channel.id].volume}
          muted={settings.channels[channel.id].muted}
          disabled={disabled}
          onVolume={(volume) => channelPatch(channel.id, { volume })}
          onMuted={(muted) => channelPatch(channel.id, { muted })}
        />
      ))}
      <label className={styles.calm}>
        <input
          type="checkbox"
          checked={settings.reducedIntensity}
          disabled={disabled}
          onChange={(event) => onChange({ reducedIntensity: event.currentTarget.checked })}
        />
        <span>Quieter music and background sounds</span>
      </label>
    </div>
  );
}
