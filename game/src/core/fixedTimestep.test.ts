import { createFixedTimestepClock } from './fixedTimestep';

describe('createFixedTimestepClock', () => {
  it('runs whole steps and carries the remainder as alpha', () => {
    const clock = createFixedTimestepClock({ stepSeconds: 1 / 60 });
    expect(clock.advance(1 / 60).steps).toBe(1);
    const frame = clock.advance(1.5 / 60);
    expect(frame.steps).toBe(1);
    expect(frame.alpha).toBeCloseTo(0.5, 5);
    expect(clock.advance(0.5 / 60).steps).toBe(1);
  });

  it('does not lose a step to float error at exact multiples', () => {
    const clock = createFixedTimestepClock({ stepSeconds: 1 / 120 });
    let total = 0;
    for (let i = 0; i < 120; i += 1) {
      total += clock.advance(1 / 120).steps;
    }
    expect(total).toBe(120);
    expect(clock.simulatedSeconds).toBeCloseTo(1, 9);
  });

  it('clamps long frames and caps steps instead of spiralling', () => {
    const clock = createFixedTimestepClock({
      stepSeconds: 1 / 60,
      maxFrameSeconds: 0.25,
      maxStepsPerFrame: 8,
    });
    const frame = clock.advance(5);
    expect(frame.steps).toBe(8);
    expect(frame.droppedSeconds).toBeGreaterThan(4.6);
    expect(clock.advance(1 / 60).steps).toBeLessThanOrEqual(2);
  });

  it('ignores invalid deltas and forgets time on reset', () => {
    const clock = createFixedTimestepClock();
    expect(clock.advance(Number.NaN).steps).toBe(0);
    expect(clock.advance(-1).steps).toBe(0);
    clock.advance(0.9 / 60);
    clock.reset();
    expect(clock.advance(0.2 / 60).steps).toBe(0);
  });

  it('rejects an out-of-range step', () => {
    expect(() => createFixedTimestepClock({ stepSeconds: 1 })).toThrow(RangeError);
  });
});
