/**
 * Public surface of the Sound Manager core. No React in here; the React
 * bindings live in `./react`. See docs/audio/SOUND_MANAGER_ARCHITECTURE.md.
 */
export { createSoundManager, type SoundManagerOptions } from './SoundManager';
export { getSharedSoundManager, resetSharedSoundManager } from './sharedSoundManager';
export {
  createWebAudioEngine,
  type AudioEngine,
  type EngineState,
  type EngineVoice,
  type LoadedSound,
  type LoadOptions,
  type VoiceEndReason,
  type VoiceOptions,
  type WebAudioEngineOptions,
} from './AudioEngine';
export { AudioRegistry, validateDefinition } from './AudioRegistry';
export { resolveSoundSource, resolveSoundUrl, type SoundSource } from './AudioAssetResolver';
export {
  AUDIO_CHANNELS,
  CHANNEL_IDS,
  clampPlaybackRate,
  clampVolume,
  createDefaultSettings,
  DEFAULT_DUCKING,
  getChannelConfig,
  isAudioChannel,
  type ChannelConfig,
} from './AudioChannels';
export { LifecycleRegistry } from './AudioLifecycle';
export {
  AudioError,
  type AudioChannel,
  type AudioDiagnostic,
  type AudioDiagnosticSink,
  type AudioErrorCode,
  type AudioStatus,
  type ChannelSettings,
  type DuckHandle,
  type DuckingConfig,
  type DuckOptions,
  type EndReason,
  type GestureTarget,
  type PlaybackState,
  type PlayOptions,
  type SoundAssetResolver,
  type SoundDefinition,
  type SoundHandle,
  type SoundManager,
  type SoundPlayer,
  type SoundScope,
  type SoundSettings,
  type SoundSettingsPatch,
  type StopOptions,
} from './AudioTypes';
