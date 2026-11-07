import { describe, expect, it, vi } from 'vitest';
import { createExitCoordinator, createPendingWrites } from './exitCoordinator';

describe('createExitCoordinator', () => {
  it('saves at once when nothing is registered', async () => {
    const coordinator = createExitCoordinator();
    await expect(coordinator.saveAll()).resolves.toEqual({ status: 'saved' });
    expect(coordinator.needsConfirm()).toBe(false);
  });

  it('waits for every participant to save', async () => {
    const coordinator = createExitCoordinator();
    const order: string[] = [];
    coordinator.register({ save: async () => void order.push('a') });
    coordinator.register({ save: async () => void order.push('b') });
    await expect(coordinator.saveAll()).resolves.toEqual({ status: 'saved' });
    expect(order).toEqual(['a', 'b']);
  });

  it('never rejects: a failed or throwing save is counted, not raised', async () => {
    const coordinator = createExitCoordinator();
    coordinator.register({ save: () => Promise.reject(new Error('offline')) });
    coordinator.register({
      save: () => {
        throw new Error('sync throw');
      },
    });
    coordinator.register({ save: () => Promise.resolve() });
    await expect(coordinator.saveAll()).resolves.toEqual({
      status: 'partial',
      failed: 2,
      timedOut: false,
    });
  });

  it('never hangs: a save that does not finish is abandoned at the timeout', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = createExitCoordinator();
      coordinator.register({ save: () => new Promise<void>(() => undefined) });
      const result = coordinator.saveAll({ timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      await expect(result).resolves.toEqual({ status: 'partial', failed: 0, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks for confirmation only while a participant says something is mid-way', () => {
    const coordinator = createExitCoordinator();
    let open = false;
    coordinator.register({ save: async () => undefined, needsConfirm: () => open });
    expect(coordinator.needsConfirm()).toBe(false);
    open = true;
    expect(coordinator.needsConfirm()).toBe(true);
  });

  it('treats a throwing confirmation check as "no need to ask"', () => {
    const coordinator = createExitCoordinator();
    coordinator.register({
      save: async () => undefined,
      needsConfirm: () => {
        throw new Error('broken');
      },
    });
    expect(coordinator.needsConfirm()).toBe(false);
  });

  it('forgets a participant once it unregisters', async () => {
    const coordinator = createExitCoordinator();
    const save = vi.fn(async () => undefined);
    const unregister = coordinator.register({ save, needsConfirm: () => true });
    unregister();
    expect(coordinator.size()).toBe(0);
    expect(coordinator.needsConfirm()).toBe(false);
    await coordinator.saveAll();
    expect(save).not.toHaveBeenCalled();
  });
});

describe('createPendingWrites', () => {
  it('settles once every tracked write has finished, and forgets finished ones', async () => {
    const writes = createPendingWrites();
    let finish: () => void = () => undefined;
    const slow = writes.track(new Promise<void>((resolve) => (finish = resolve)));
    expect(writes.count()).toBe(1);
    let settled = false;
    const settling = writes.settle().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await slow;
    await settling;
    expect(settled).toBe(true);
    expect(writes.count()).toBe(0);
  });

  it('returns the same promise, so callers keep their own chains', async () => {
    const writes = createPendingWrites();
    await expect(writes.track(Promise.resolve(42))).resolves.toBe(42);
  });

  it('rejects settle() when a tracked write failed, so the exit can count it', async () => {
    const writes = createPendingWrites();
    const failing = writes.track(Promise.reject(new Error('offline')));
    failing.catch(() => undefined);
    await expect(writes.settle()).rejects.toThrow();
  });
});
