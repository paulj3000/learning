import type { AudioChannel, ChannelSettings, DuckingConfig, SoundSettings } from './AudioTypes';

/**
 * The five mixer channels. `priority` is only the default for voice-limit
 * stealing: narration and music outrank interface and effect sounds.
 *
 * Volumes start calm for young children (music and ambient sit under
 * effects and speech). Ducking and per-game mixes are later phases; they
 * extend `SoundSettings`, they do not replace this table.
 */
export interface ChannelConfig {
  id: AudioChannel;
  label: string;
  defaultVolume: number;
  defaultPriority: number;
}

export const AUDIO_CHANNELS: readonly ChannelConfig[] = [
  { id: 'music', label: 'Music', defaultVolume: 0.5, defaultPriority: 60 },
  { id: 'ambient', label: 'Ambient', defaultVolume: 0.5, defaultPriority: 40 },
  { id: 'sfx', label: 'Sound effects', defaultVolume: 0.8, defaultPriority: 20 },
  { id: 'voice', label: 'Voice', defaultVolume: 1, defaultPriority: 80 },
  { id: 'ui', label: 'Interface', defaultVolume: 0.7, defaultPriority: 30 },
];

export const CHANNEL_IDS: readonly AudioChannel[] = AUDIO_CHANNELS.map((channel) => channel.id);

const CONFIG_BY_ID = new Map<AudioChannel, ChannelConfig>(
  AUDIO_CHANNELS.map((channel) => [channel.id, channel]),
);

export function isAudioChannel(value: unknown): value is AudioChannel {
  return typeof value === 'string' && CONFIG_BY_ID.has(value as AudioChannel);
}

export function getChannelConfig(channel: AudioChannel): ChannelConfig {
  const config = CONFIG_BY_ID.get(channel);
  if (!config) throw new RangeError(`unknown audio channel: ${String(channel)}`);
  return config;
}

/** Clamps to 0..1. Returns `undefined` for NaN or infinity so callers can ignore bad input. */
export function clampVolume(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

export const MIN_PLAYBACK_RATE = 0.25;
export const MAX_PLAYBACK_RATE = 4;

export function clampPlaybackRate(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, value));
}

/** Spoken voices lower the music to 30 percent while they play. */
export const DEFAULT_DUCKING: DuckingConfig = {
  enabled: true,
  triggers: ['voice'],
  targets: ['music'],
  level: 0.3,
  attackMs: 250,
  releaseMs: 700,
};

export function createDefaultSettings(): SoundSettings {
  const channels = {} as Record<AudioChannel, ChannelSettings>;
  for (const channel of AUDIO_CHANNELS) {
    channels[channel.id] = { volume: channel.defaultVolume, muted: false };
  }
  return { masterVolume: 1, masterMuted: false, reducedIntensity: false, channels };
}

/**
 * The gain on a channel's own node. Master gain lives on the master node
 * downstream of every channel, so it is not folded in here. Muting a channel
 * sends its gain to zero; the stored `volume` is untouched.
 */
/** Reduced-intensity mode halves the channels that fill the background. */
export const REDUCED_INTENSITY_FACTOR = 0.5;
const REDUCED_CHANNELS: ReadonlySet<AudioChannel> = new Set<AudioChannel>(['music', 'ambient']);

export function effectiveChannelGain(settings: SoundSettings, channel: AudioChannel): number {
  const channelSettings = settings.channels[channel];
  if (channelSettings.muted) return 0;
  const calmer = settings.reducedIntensity && REDUCED_CHANNELS.has(channel);
  return calmer ? channelSettings.volume * REDUCED_INTENSITY_FACTOR : channelSettings.volume;
}

export function effectiveMasterGain(settings: SoundSettings): number {
  return settings.masterMuted ? 0 : settings.masterVolume;
}
