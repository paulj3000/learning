import { createEventBus } from './eventBus';

type Events = { ping: { n: number }; pong: { s: string } };

describe('createEventBus', () => {
  it('delivers typed payloads in subscription order', () => {
    const bus = createEventBus<Events>();
    const seen: string[] = [];
    bus.on('ping', ({ n }) => seen.push(`a${n}`));
    bus.on('ping', ({ n }) => seen.push(`b${n}`));
    bus.emit('ping', { n: 1 });
    expect(seen).toEqual(['a1', 'b1']);
  });

  it('lets a listener unsubscribe itself mid-emit without skipping others', () => {
    const bus = createEventBus<Events>();
    const seen: string[] = [];
    const off = bus.on('ping', () => {
      seen.push('a');
      off();
    });
    bus.on('ping', () => seen.push('b'));
    bus.emit('ping', { n: 1 });
    bus.emit('ping', { n: 2 });
    expect(seen).toEqual(['a', 'b', 'b']);
  });

  it('runs once listeners a single time', () => {
    const bus = createEventBus<Events>();
    const fn = vi.fn();
    bus.once('pong', fn);
    bus.emit('pong', { s: 'x' });
    bus.emit('pong', { s: 'y' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ s: 'x' });
  });

  it('keeps delivering when one listener throws', () => {
    const errors: unknown[] = [];
    const bus = createEventBus<Events>({ onListenerError: (e) => errors.push(e) });
    const after = vi.fn();
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', after);
    bus.emit('ping', { n: 1 });
    expect(after).toHaveBeenCalled();
    expect(errors).toHaveLength(1);
  });

  it('sends every event to onAny listeners after named ones, and clears', () => {
    const bus = createEventBus<Events>();
    const order: string[] = [];
    bus.onAny((name) => order.push(`any:${name}`));
    bus.on('pong', () => order.push('pong'));
    bus.emit('pong', { s: '' });
    expect(order).toEqual(['pong', 'any:pong']);
    expect(bus.listenerCount()).toBe(2);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});
