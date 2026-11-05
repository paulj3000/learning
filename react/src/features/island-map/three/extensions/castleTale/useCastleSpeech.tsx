import { useEffect, useRef, useState, type RefObject } from 'react';
import type { SpatialOptions } from '../../../../../audio/AudioTypes';
import {
  speakCompanionTurn,
  speakNpcNode,
  useSpeech,
  type SpeechSource,
  type UseSpeech,
} from '../../../../../audio/speech';
import { setSpeechBinding } from '../../../../../audio/speech/speechBinding';
import type { CastleTaleSceneApi } from './castleTaleScene';

/**
 * Spoken dialogue for Storykeeper's Castle (SM-P8-09). While the castle is mounted it registers a
 * speech binding, so the shared dialogue components speak: Keeper Quill's conversation lines and
 * Chatty's story narration. Where each voice comes from:
 *
 * - Keeper Quill's own lines come from where he stands (distance and direction, 2.5 m full volume,
 *   20 m range). This is the conversational "location-based" speech.
 * - Story narration and instructions (Chatty's turns) are flat: every child hears them clearly,
 *   whatever way they face.
 *
 * Captions, replay, skip and pause come from the returned `speech` state. Nothing about the story,
 * its rewards or its objectives is touched, and without audio the text is on screen as before.
 */
export function useCastleSpeech(
  childId: string,
  quillEntityId: string | undefined,
  scene: RefObject<CastleTaleSceneApi | null>,
  /** Tests pass their own; the default is Django for this child. */
  source?: SpeechSource | null,
): { speech: UseSpeech; speaker: string | undefined } {
  const speech = useSpeech({ childId, scopeName: 'castle-speech', source });
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [speaker, setSpeaker] = useState<string | undefined>(undefined);

  useEffect(() => {
    const placeFor = (npcId?: string): SpatialOptions | undefined => {
      if (!npcId || npcId !== quillEntityId) return undefined;
      const read = scene.current?.quillPositionReader();
      const spot: [number, number, number] = [0, 0, 0];
      return read?.(spot)
        ? { position: [...spot], refDistance: 2.5, maxDistance: 20, rolloffFactor: 1 }
        : undefined;
    };
    const previous = setSpeechBinding({
      speakTurn(result, options) {
        setSpeaker(options?.npcId && options.npcId === quillEntityId ? 'Keeper Quill' : 'Chatty');
        return speakCompanionTurn(speechRef.current, result, {
          position: placeFor(options?.npcId),
        });
      },
      speakNpcNode(npcId, nodeId, text) {
        setSpeaker(npcId === quillEntityId ? 'Keeper Quill' : undefined);
        return speakNpcNode(speechRef.current, npcId, nodeId, text, { position: placeFor(npcId) });
      },
      stop: () => speechRef.current.stop(),
    });
    return () => {
      setSpeechBinding(previous);
      speechRef.current.stop();
    };
  }, [quillEntityId, scene]);

  return { speech, speaker };
}
