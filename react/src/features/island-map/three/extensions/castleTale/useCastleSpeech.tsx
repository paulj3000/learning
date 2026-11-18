import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { SpatialOptions } from '../../../../../audio/AudioTypes';
import {
  speakCompanionTurn,
  speakLine,
  speakNpcNode,
  useSpeech,
  type SpeakRequest,
  type SpeechSource,
  type UseSpeech,
} from '../../../../../audio/speech';
import { setSpeechBinding } from '../../../../../audio/speech/speechBinding';
import type { StorybookPage } from '../../../../great-storybook/pages';
import { pageLineId, pageNarration, wordLineId } from './castleSpeechLines';
import type { CastleTaleSceneApi } from './castleTaleScene';

export interface CastleSpeech {
  speech: UseSpeech;
  speaker: string | undefined;
  /** Says one Painted Words bank word (SC-R06-03). The word stays on screen as the caption. */
  speakWord(word: string): Promise<void>;
  /** Reads a Great Storybook page that just came back (SC-R06-03). */
  speakPage(page: Pick<StorybookPage, 'id' | 'title' | 'restoredText'>): Promise<void>;
}

/**
 * Spoken dialogue for Storykeeper's Castle (SM-P8-09, SC-R06-03). While the castle is mounted it
 * registers a speech binding, so the shared dialogue components speak: Keeper Quill's conversation
 * lines and Chatty's story narration. It also reads the castle's own authored lines: Painted Words
 * pronunciations and Great Storybook pages. Where each voice comes from:
 *
 * - Keeper Quill's own lines come from where he stands (distance and direction, 2.5 m full volume,
 *   20 m range). This is the conversational "location-based" speech.
 * - Story narration, instructions, words and pages are flat: every child hears them clearly,
 *   whatever way they face.
 *
 * Speech is only ever asked of Django by reference (`/children/<id>/audio/speech/`), which checks
 * the speech switch, the child, the line and the limits, and makes the clip with Amazon Polly
 * (a fake provider locally and in tests). Nothing here calls Polly or holds a credential.
 *
 * One utterance at a time: each new line replaces the one speaking (the shared `SpeechPlayer`), and
 * the same line asked for again while it is still being fetched or spoken is dropped, so a double
 * tap or a re-render never stutters it. Any failure (switched off, 404, 422, offline, blocked
 * audio) leaves the text on screen as the caption, and play goes on.
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
): CastleSpeech {
  const speech = useSpeech({ childId, scopeName: 'castle-speech', source });
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [speaker, setSpeaker] = useState<string | undefined>(undefined);
  /** The reference being fetched or spoken, for the no-repeat guard. */
  const speaking = useRef<string | null>(null);

  /** The shared player, behind the no-repeat guard. */
  const guarded = useMemo(
    () => ({
      speak(request: SpeakRequest): Promise<void> {
        const key = JSON.stringify(request.reference);
        if (speaking.current === key) return Promise.resolve();
        speaking.current = key;
        return speechRef.current.speak(request).finally(() => {
          if (speaking.current === key) speaking.current = null;
        });
      },
      showText(text: string) {
        speaking.current = null;
        speechRef.current.showText(text);
      },
    }),
    [],
  );

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
        return speakCompanionTurn(guarded, result, {
          position: placeFor(options?.npcId),
        });
      },
      speakNpcNode(npcId, nodeId, text) {
        setSpeaker(npcId === quillEntityId ? 'Keeper Quill' : undefined);
        return speakNpcNode(guarded, npcId, nodeId, text, { position: placeFor(npcId) });
      },
      stop: () => {
        speaking.current = null;
        speechRef.current.stop();
      },
    });
    return () => {
      setSpeechBinding(previous);
      speaking.current = null;
      speechRef.current.stop();
    };
  }, [quillEntityId, scene, guarded]);

  const speakWord = useCallback(
    (word: string) => {
      setSpeaker(undefined);
      return speakLine(guarded, wordLineId(word), word);
    },
    [guarded],
  );

  const speakPage = useCallback(
    (page: Pick<StorybookPage, 'id' | 'title' | 'restoredText'>) => {
      setSpeaker(undefined);
      return speakLine(guarded, pageLineId(page.id), pageNarration(page));
    },
    [guarded],
  );

  return { speech, speaker, speakWord, speakPage };
}
