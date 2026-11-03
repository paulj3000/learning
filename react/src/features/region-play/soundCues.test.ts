import { describe, expect, it, vi } from 'vitest';
import { playCue, setSoundSink, type SoundCue } from './soundCues';

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
