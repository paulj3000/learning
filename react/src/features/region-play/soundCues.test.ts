import { describe, expect, it, vi } from 'vitest';
import { playCue, puzzleSolveCues, setSoundSink, type SoundCue } from './soundCues';

afterEach(() => setSoundSink(null));

describe('sound cues (TR-19, the moments only)', () => {
  it('is silent until a sink is registered', () => {
    expect(() => playCue('chestOpen')).not.toThrow();
  });

  it('hands each cue to the one registered sink, and hands the old one back', () => {
    const heard: SoundCue[] = [];
    expect(setSoundSink((cue) => heard.push(cue))).toBeNull();
    playCue('keyPickup');
    playCue('bridgeOpen');
    expect(heard).toEqual(['keyPickup', 'bridgeOpen']);
    const second = vi.fn();
    const previous = setSoundSink(second);
    expect(previous).toBeTypeOf('function');
    playCue('celebrate');
    expect(second).toHaveBeenCalledWith('celebrate', undefined);
    expect(heard).toHaveLength(2);
  });

  it('never lets a broken player interrupt play', () => {
    setSoundSink(() => {
      throw new Error('speaker on fire');
    });
    expect(() => playCue('stoneWrong')).not.toThrow();
  });

  it('stops after the sink is removed', () => {
    const sink = vi.fn();
    setSoundSink(sink);
    setSoundSink(null);
    playCue('replayWin');
    expect(sink).not.toHaveBeenCalled();
  });
});

describe('puzzleSolveCues', () => {
  const first = { correct: true, solvedNow: true, practice: false, alreadySolved: false };
  it('raises puzzleComplete for a first solve and restoration for a COLLECT_OBJECT one', () => {
    expect(puzzleSolveCues('CHOOSE_ANSWER', first)).toEqual(['puzzleComplete']);
    expect(puzzleSolveCues('COLLECT_OBJECT', first)).toEqual(['puzzleComplete', 'restoration']);
  });
  it('adds questComplete when the solve finished the quest (the Ignis return)', () => {
    const done = { ...first, questUpdates: [{ justCompleted: true }] };
    expect(puzzleSolveCues('RETURN_TO_NPC', done)).toEqual(['puzzleComplete', 'questComplete']);
    expect(puzzleSolveCues('RETURN_TO_NPC', { ...first, questUpdates: [{ justCompleted: false }] })).toEqual([
      'puzzleComplete',
    ]);
  });
  it('is silent for wrong, practice, already solved or no outcome', () => {
    expect(puzzleSolveCues('CHOOSE_ANSWER', { ...first, correct: false, solvedNow: false })).toEqual([]);
    expect(puzzleSolveCues('CHOOSE_ANSWER', { ...first, solvedNow: false, practice: true })).toEqual([]);
    expect(puzzleSolveCues('COLLECT_OBJECT', { ...first, solvedNow: false, alreadySolved: true })).toEqual([]);
    expect(puzzleSolveCues('COLLECT_OBJECT', undefined)).toEqual([]);
  });
});
