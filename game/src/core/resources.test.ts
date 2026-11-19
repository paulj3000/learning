import { isEngineError } from './errors';
import { createResourceScope } from './resources';

describe('createResourceScope', () => {
  it('disposes children first, then own resources in reverse order, exactly once', () => {
    const order: string[] = [];
    const scope = createResourceScope('scene');
    scope.track(() => order.push('a'));
    scope.track({ dispose: () => order.push('b') });
    scope.child('npc').track(() => order.push('child'));
    expect(scope.count()).toBe(3);
    scope.dispose();
    scope.dispose();
    expect(order).toEqual(['child', 'b', 'a']);
    expect(scope.disposed).toBe(true);
  });

  it('disposes a resource tracked after disposal instead of leaking it', () => {
    const scope = createResourceScope('scene');
    scope.dispose();
    const late = vi.fn();
    let caught: unknown;
    try {
      scope.track(late);
    } catch (error) {
      caught = error;
    }
    expect(late).toHaveBeenCalled();
    expect(isEngineError(caught, 'DISPOSED')).toBe(true);
  });

  it('keeps disposing after one disposer throws, then reports', () => {
    const reported: unknown[][] = [];
    const scope = createResourceScope('scene', { onDisposeErrors: (errors) => reported.push([...errors]) });
    const survivor = vi.fn();
    scope.track(survivor);
    scope.track(() => {
      throw new Error('bad');
    });
    scope.dispose();
    expect(survivor).toHaveBeenCalled();
    expect(reported[0]).toHaveLength(1);
  });

  it('releases ownership without disposing', () => {
    const scope = createResourceScope('scene');
    const fn = vi.fn();
    scope.track(fn);
    expect(scope.release(fn)).toBe(true);
    scope.dispose();
    expect(fn).not.toHaveBeenCalled();
  });
});
