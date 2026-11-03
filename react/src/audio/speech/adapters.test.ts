import { describe, expect, it, vi } from 'vitest';
import { speakCompanionTurn, speakLine, speakNpcNode, speakTutorTurn } from './adapters';

const fakeSpeech = () => ({ speak: vi.fn(async () => undefined), showText: vi.fn() });
const ID = '8f1b7c0e-6f0e-4b9e-9d3f-0a7a1b2c3d4e';

describe('speech adapters', () => {
  it('speaks a Chatty turn by its approved reference and shows the turn text as the fallback', async () => {
    const speech = fakeSpeech();
    await speakCompanionTurn(
      speech,
      {
        turn: { spokenText: 'Let’s count!' },
        speech: { utteranceId: ID, voiceProfile: 'chatty' },
      },
      { mode: 'queue' },
    );
    expect(speech.speak).toHaveBeenCalledWith({
      reference: { kind: 'utterance', id: ID },
      fallbackText: 'Let’s count!',
      mode: 'queue',
    });
    expect(speech.showText).not.toHaveBeenCalled();
  });

  it('shows text only when the server did not approve speech for the turn', async () => {
    const speech = fakeSpeech();
    await speakTutorTurn(speech, { turn: { spokenText: 'Try twos.' } });
    expect(speech.showText).toHaveBeenCalledWith('Try twos.');
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('speaks a tutor turn the same way as Chatty', async () => {
    const speech = fakeSpeech();
    await speakTutorTurn(speech, {
      turn: { spokenText: 'Hint' },
      speech: { utteranceId: ID, voiceProfile: 'tutor' },
    });
    expect(speech.speak).toHaveBeenCalledWith(
      expect.objectContaining({ reference: { kind: 'utterance', id: ID } }),
    );
  });

  it('speaks an authored line and an NPC node, with their text as the fallback', async () => {
    const speech = fakeSpeech();
    await speakLine(speech, 'castle-quill-greeting', 'Hello', {
      position: { position: [1, 2, 3] },
    });
    expect(speech.speak).toHaveBeenLastCalledWith({
      reference: { kind: 'line', id: 'castle-quill-greeting' },
      fallbackText: 'Hello',
      position: { position: [1, 2, 3] },
    });
    await speakNpcNode(speech, 'pip', 'hello', 'Ahoy');
    expect(speech.speak).toHaveBeenLastCalledWith({
      reference: { kind: 'npcNode', npcId: 'pip', nodeId: 'hello' },
      fallbackText: 'Ahoy',
    });
  });
});
