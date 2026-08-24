import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSandboxBridge } from './useSandboxBridge';
import { SANDBOX_NPC_ID, WorldEngineEventBus } from './worldEngineEvents';

describe('useSandboxBridge', () => {
  it('calls noteCharacterMet and emits NpcStateChanged when the sandbox NPC is approached', () => {
    const noteCharacterMet = vi.fn();
    const bus = new WorldEngineEventBus();
    const stateChangedListener = vi.fn();
    bus.on('NpcStateChanged', stateChangedListener);

    renderHook(() => useSandboxBridge(bus, noteCharacterMet));
    bus.emit('NpcApproached', { entityId: SANDBOX_NPC_ID });

    expect(noteCharacterMet).toHaveBeenCalledWith(SANDBOX_NPC_ID);
    expect(stateChangedListener).toHaveBeenCalledWith({ entityId: SANDBOX_NPC_ID, metByChild: true });
  });

  it('ignores an approach for an npc id it does not know about', () => {
    const noteCharacterMet = vi.fn();
    const bus = new WorldEngineEventBus();
    const stateChangedListener = vi.fn();
    bus.on('NpcStateChanged', stateChangedListener);

    renderHook(() => useSandboxBridge(bus, noteCharacterMet));
    bus.emit('NpcApproached', { entityId: 'someone-else' });

    expect(noteCharacterMet).not.toHaveBeenCalled();
    expect(stateChangedListener).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const noteCharacterMet = vi.fn();
    const bus = new WorldEngineEventBus();

    const { unmount } = renderHook(() => useSandboxBridge(bus, noteCharacterMet));
    unmount();
    bus.emit('NpcApproached', { entityId: SANDBOX_NPC_ID });

    expect(noteCharacterMet).not.toHaveBeenCalled();
  });
});
