import { TimeoutError, withTimeout } from './withTimeout';

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('passes a prompt answer through', async () => {
    await expect(withTimeout(Promise.resolve(3), 50, 'x')).resolves.toBe(3);
  });

  it('turns a call that never settles into a TimeoutError', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => undefined), 1000, 'Reading');
    vi.advanceTimersByTime(1000);
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
  });
});
