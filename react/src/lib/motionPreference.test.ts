import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, subscribeReducedMotion } from './motionPreference';

const original = window.matchMedia;
afterEach(() => {
  window.matchMedia = original;
});

describe('subscribeReducedMotion', () => {
  it('reports each change, and stops after unsubscribe', () => {
    const handlers = new Set<(event: { matches: boolean }) => void>();
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addEventListener: (_: string, h: never) => handlers.add(h),
      removeEventListener: (_: string, h: never) => handlers.delete(h),
    })) as unknown as typeof window.matchMedia;
    const seen: boolean[] = [];
    const stop = subscribeReducedMotion((reduced) => seen.push(reduced));
    handlers.forEach((h) => h({ matches: true }));
    handlers.forEach((h) => h({ matches: false }));
    expect(seen).toEqual([true, false]);
    stop();
    expect(handlers.size).toBe(0);
  });

  it('falls back to the deprecated listener pair', () => {
    const add = vi.fn();
    const remove = vi.fn();
    window.matchMedia = vi.fn(() => ({
      matches: false,
      addListener: add,
      removeListener: remove,
    })) as unknown as typeof window.matchMedia;
    subscribeReducedMotion(() => undefined)();
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(add.mock.calls[0]![0]);
  });

  it('is a safe no-op without matchMedia', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(() => subscribeReducedMotion(() => undefined)()).not.toThrow();
    expect(prefersReducedMotion()).toBe(false);
  });
});
