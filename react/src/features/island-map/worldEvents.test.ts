import { describe, expect, it, vi } from 'vitest';
import { WorldEventBus } from './worldEvents';

describe('WorldEventBus', () => {
  it('delivers an emitted event only to listeners of that event name', () => {
    const bus = new WorldEventBus();
    const enteredListener = vi.fn();
    const exitedListener = vi.fn();
    bus.on('INTERACTION_ZONE_ENTERED', enteredListener);
    bus.on('INTERACTION_ZONE_EXITED', exitedListener);

    bus.emit('INTERACTION_ZONE_ENTERED', { interactionId: 'broken-bridge' });

    expect(enteredListener).toHaveBeenCalledWith({ interactionId: 'broken-bridge' });
    expect(exitedListener).not.toHaveBeenCalled();
  });

  it('supports multiple listeners for the same event', () => {
    const bus = new WorldEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.on('AVATAR_MOVED', first);
    bus.on('AVATAR_MOVED', second);

    bus.emit('AVATAR_MOVED', { position: { x: 10, y: 20 } });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a listener once unsubscribed', () => {
    const bus = new WorldEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.on('INTERACTION_TRIGGERED', listener);

    unsubscribe();
    bus.emit('INTERACTION_TRIGGERED', { interactionId: 'broken-bridge' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not throw when emitting an event with no listeners', () => {
    const bus = new WorldEventBus();

    expect(() => bus.emit('INTERACTION_ZONE_ENTERED', { interactionId: 'anything' })).not.toThrow();
  });

  it('allows a listener to unsubscribe itself while handling the current emit', () => {
    const bus = new WorldEventBus();
    const calls: string[] = [];
    let unsubscribeSelf: () => void = () => {};
    const selfRemoving = () => {
      calls.push('self-removing');
      unsubscribeSelf();
    };
    unsubscribeSelf = bus.on('AVATAR_MOVED', selfRemoving);
    bus.on('AVATAR_MOVED', () => calls.push('other'));

    expect(() => bus.emit('AVATAR_MOVED', { position: { x: 0, y: 0 } })).not.toThrow();
    expect(calls).toEqual(['self-removing', 'other']);

    calls.length = 0;
    bus.emit('AVATAR_MOVED', { position: { x: 1, y: 1 } });
    expect(calls).toEqual(['other']);
  });

  it('removeAllListeners clears every subscription', () => {
    const bus = new WorldEventBus();
    const listener = vi.fn();
    bus.on('INTERACTION_TRIGGERED', listener);

    bus.removeAllListeners();
    bus.emit('INTERACTION_TRIGGERED', { interactionId: 'broken-bridge' });

    expect(listener).not.toHaveBeenCalled();
  });
});
