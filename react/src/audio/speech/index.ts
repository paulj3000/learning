export {
  createSpeechPlayer,
  type SpeakRequest,
  type SpeechClipInfo,
  type SpeechPhase,
  type SpeechPlayer,
  type SpeechPlayerOptions,
  type SpeechReference,
  type SpeechSource,
  type SpeechState,
} from './SpeechPlayer';
export { useSpeech, type UseSpeech, type UseSpeechOptions } from './useSpeech';
export { SpeechCaption, type SpeechCaptionProps } from './SpeechCaption';
export {
  speakCompanionTurn,
  speakLine,
  speakNpcNode,
  speakTutorTurn,
  type SpeakOptions,
} from './adapters';
export { getSpeechBinding, setSpeechBinding, type SpeechBinding } from './speechBinding';
