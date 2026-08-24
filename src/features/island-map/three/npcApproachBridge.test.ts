import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNpcApproachBridge } from './npcApproachBridge';
import { WorldEngineEventBus } from './worldEngineEvents';

describe('useNpcApproachBridge', () => {
  it('calls noteCharacterMet and emits NpcStateChanged when the given npc is approached', () => {
    const noteCharacterMet = vi.fn();
    const bus = new WorldEngineEventBus();
    const stateChangedListener = vi.fn();
    bus.on('NpcStateChanged', stateChangedListener);

    renderHook(() => useNpcApproachBridge(bus, 'pirate-pip', noteCharacterMet));
    bus.emit('NpcApproached', { entityId: 'pirate-pip' });

    expect(noteCharacterMet).toHaveBeenCalledWith('pirate-pip');
    expect(stateChangedListener).toHaveBeenCalledWith({ entityId: 'pirate-pip', metByChild: true });
  });

  it('ignores an approach for an npc id it does not know about', () => {
    const noteCharacterMet = vi.fn();
    const bus = new WorldEngineEventBus();

    renderHook(() => useNpcApproachBridge(bus, 'pirate-pip', noteCharacterMet));
    bus.emit('NpcApproached', { entityId: 'someone-else' });

    expect(noteCharacterMet).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const noteCharacterMet = vi.fn();
    const bus = new WorldEngineEventBus();

    const { unmount } = renderHook(() => useNpcApproachBridge(bus, 'pirate-pip', noteCharacterMet));
    unmount();
    bus.emit('NpcApproached', { entityId: 'pirate-pip' });

    expect(noteCharacterMet).not.toHaveBeenCalled();
  });
});
