import { describe, expect, it, vi } from 'vitest';
import { WorldEngineEventBus } from './worldEngineEvents';

describe('WorldEngineEventBus', () => {
  it('delivers an emitted event only to listeners of that event name', () => {
    const bus = new WorldEngineEventBus();
    const approachedListener = vi.fn();
    const interactedListener = vi.fn();
    bus.on('NpcApproached', approachedListener);
    bus.on('ObjectInteracted', interactedListener);

    bus.emit('NpcApproached', { entityId: 'pirate-pip' });

    expect(approachedListener).toHaveBeenCalledWith({ entityId: 'pirate-pip' });
    expect(interactedListener).not.toHaveBeenCalled();
  });

  it('supports multiple listeners for the same event', () => {
    const bus = new WorldEngineEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.on('PlayerEnteredZone', first);
    bus.on('PlayerEnteredZone', second);

    bus.emit('PlayerEnteredZone', { zoneId: 'sandbox-shrine-zone' });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops delivering to a listener once unsubscribed', () => {
    const bus = new WorldEngineEventBus();
    const listener = vi.fn();
    const unsubscribe = bus.on('CollectiblePickedUp', listener);

    unsubscribe();
    bus.emit('CollectiblePickedUp', { entityId: 'sandbox-collectible-1' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not throw when emitting an event with no listeners', () => {
    const bus = new WorldEngineEventBus();

    expect(() =>
      bus.emit('BuildActionRequested', { entityId: 'sandbox-build-spot-1' }),
    ).not.toThrow();
  });

  it('delivers inbound domain -> Three.js events the same way as outbound ones', () => {
    const bus = new WorldEngineEventBus();
    const listener = vi.fn();
    bus.on('NpcStateChanged', listener);

    bus.emit('NpcStateChanged', { entityId: 'pirate-pip', metByChild: true });

    expect(listener).toHaveBeenCalledWith({ entityId: 'pirate-pip', metByChild: true });
  });

  it('allows a listener to unsubscribe itself while handling the current emit', () => {
    const bus = new WorldEngineEventBus();
    const calls: string[] = [];
    let unsubscribeSelf: () => void = () => {};
    const selfRemoving = () => {
      calls.push('self-removing');
      unsubscribeSelf();
    };
    unsubscribeSelf = bus.on('ObjectInteracted', selfRemoving);
    bus.on('ObjectInteracted', () => calls.push('other'));

    const detail = {
      entityId: 'sandbox-collectible-1',
      interactionId: 'sandbox-collectible-1:collect',
    };
    expect(() => bus.emit('ObjectInteracted', detail)).not.toThrow();
    expect(calls).toEqual(['self-removing', 'other']);

    calls.length = 0;
    bus.emit('ObjectInteracted', detail);
    expect(calls).toEqual(['other']);
  });

  it('removeAllListeners clears every subscription', () => {
    const bus = new WorldEngineEventBus();
    const listener = vi.fn();
    bus.on('WorldStateChanged', listener);

    bus.removeAllListeners();
    bus.emit('WorldStateChanged', { worldStateKey: 'sandbox:visited' });

    expect(listener).not.toHaveBeenCalled();
  });
});
