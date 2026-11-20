import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineRuntime, type EngineRuntime } from '@lai/game-engine/core';
import { createGameplayEventFactory } from '@lai/game-engine/contracts';
import { GameHost } from './GameHost';
import { HOST_COUNTERS } from './useEngineRuntime';
import { HostPreferencesService, HostViewService } from './hostTypes';
import { createFakeRenderer, installFakeAnimationFrames } from './testing';

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

function harness() {
  const runtimes: EngineRuntime[] = [];
  const renderers: ReturnType<typeof createFakeRenderer>[] = [];
  return {
    runtimes,
    renderers,
    createRuntime: () => {
      const runtime = createEngineRuntime({ id: 'test.host' });
      vi.spyOn(runtime, 'tick');
      vi.spyOn(runtime, 'dispose');
      runtimes.push(runtime);
      return runtime;
    },
    rendererFactory: () => {
      const renderer = createFakeRenderer();
      renderers.push(renderer);
      return renderer;
    },
  };
}

describe('GameHost', () => {
  let frames: ReturnType<typeof installFakeAnimationFrames>;

  beforeEach(() => {
    frames = installFakeAnimationFrames();
    setVisibility('visible');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setVisibility('visible');
  });

  it('shows loading, then ready; ticks and renders each frame; names the region', async () => {
    const h = harness();
    render(<GameHost runtimeId="t" label="Island scene" createRuntime={h.createRuntime} rendererFactory={h.rendererFactory} />);
    expect(screen.getByRole('region', { name: 'Island scene' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    expect(h.runtimes[0]!.state).toBe('running');
    act(() => frames.step());
    act(() => frames.step());
    expect(h.runtimes[0]!.tick).toHaveBeenCalledTimes(2);
    expect(h.renderers[0]!.render).toHaveBeenCalledTimes(2);
    expect(h.runtimes[0]!.diagnostics.snapshot().gauges['renderer.drawCalls']).toBe(3);
    expect(screen.getByTestId('game-host-canvas').querySelector('canvas')).toHaveAttribute('aria-hidden', 'true');
  });

  it('provides the view and preferences services, honouring reduced motion', async () => {
    const h = harness();
    render(
      <GameHost runtimeId="t" label="x" reducedMotion createRuntime={h.createRuntime} rendererFactory={h.rendererFactory} />,
    );
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    const runtime = h.runtimes[0]!;
    expect(runtime.services.get(HostPreferencesService)?.reducedMotion).toBe(true);
    expect(runtime.services.get(HostViewService)?.renderer).toBe(h.renderers[0]);
  });

  it('pauses on hidden, clears input, stops the loop, and resumes on visible', async () => {
    const h = harness();
    render(<GameHost runtimeId="t" label="x" createRuntime={h.createRuntime} rendererFactory={h.rendererFactory} />);
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    const runtime = h.runtimes[0]!;
    const inputReset = vi.fn();
    runtime.events.on('host.inputReset' as never, inputReset);
    act(() => setVisibility('hidden'));
    expect(runtime.state).toBe('paused');
    expect(inputReset).toHaveBeenCalledTimes(1);
    expect(frames.pendingCount()).toBe(0);
    expect(screen.getByRole('region')).toHaveAttribute('data-paused', 'true');
    act(() => setVisibility('visible'));
    expect(runtime.state).toBe('running');
    expect(frames.pendingCount()).toBe(1);
    expect(screen.getByRole('region')).toHaveAttribute('data-paused', 'false');
  });

  it('pauses on window blur and resumes on focus', async () => {
    const h = harness();
    render(<GameHost runtimeId="t" label="x" createRuntime={h.createRuntime} rendererFactory={h.rendererFactory} />);
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(h.runtimes[0]!.state).toBe('paused');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(h.runtimes[0]!.state).toBe('running');
  });

  it('disposes the runtime and renderer and cancels the frame on unmount', async () => {
    const h = harness();
    const { unmount } = render(
      <GameHost runtimeId="t" label="x" createRuntime={h.createRuntime} rendererFactory={h.rendererFactory} />,
    );
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    unmount();
    expect(h.runtimes[0]!.dispose).toHaveBeenCalled();
    expect(h.runtimes[0]!.state).toBe('disposed');
    expect(h.renderers[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(frames.pendingCount()).toBe(0);
    expect(h.renderers[0]!.domElement.isConnected).toBe(false);
  });

  it('survives StrictMode double mount without leaking or double starting', async () => {
    const h = harness();
    render(
      <StrictMode>
        <GameHost runtimeId="t" label="x" createRuntime={h.createRuntime} rendererFactory={h.rendererFactory} />
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    expect(h.runtimes).toHaveLength(2);
    expect(h.runtimes[0]!.state).toBe('disposed');
    expect(h.runtimes[1]!.state).toBe('running');
    expect(h.renderers[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(h.renderers[1]!.dispose).not.toHaveBeenCalled();
    expect(screen.getByTestId('game-host-canvas').querySelectorAll('canvas')).toHaveLength(1);
    expect(frames.pendingCount()).toBe(1);
  });

  it('shows a safe error with a retry button that restarts the engine', async () => {
    const h = harness();
    const onError = vi.fn();
    let fail = true;
    const setup = vi.fn(() => {
      if (fail) {
        throw new Error('secret internal detail');
      }
    });
    render(
      <GameHost
        runtimeId="t"
        label="x"
        setup={setup}
        onError={onError}
        createRuntime={h.createRuntime}
        rendererFactory={h.rendererFactory}
      />,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Oops, the island needs a moment');
    expect(alert).not.toHaveTextContent('secret');
    expect(onError).toHaveBeenCalledWith('START_FAILED');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    expect(h.runtimes).toHaveLength(2);
    expect(h.renderers[0]!.dispose).toHaveBeenCalled();
  });

  it('shows a no-graphics message when the renderer cannot be created', async () => {
    render(
      <GameHost
        runtimeId="t"
        label="x"
        rendererFactory={() => {
          throw new Error('WebGL missing');
        }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot show the island');
  });

  it('forwards valid gameplay claims, drops and counts invalid ones, never throws', async () => {
    const h = harness();
    const onGameplayEvent = vi.fn();
    const onEngineEvent = vi.fn();
    render(
      <GameHost
        runtimeId="t"
        label="x"
        onGameplayEvent={onGameplayEvent}
        onEngineEvent={onEngineEvent}
        createRuntime={h.createRuntime}
        rendererFactory={h.rendererFactory}
      />,
    );
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    const runtime = h.runtimes[0]!;
    const factory = createGameplayEventFactory({ realmId: 'realm.test', adventureId: 'adv.test', areaId: null, sessionRef: null });
    const valid = factory.create('collectible.collected', { collectibleId: 'coin.1', setId: null });
    runtime.events.emit('gameplay.event' as never, valid as never);
    expect(onGameplayEvent).toHaveBeenCalledTimes(1);
    expect(onGameplayEvent.mock.calls[0]![0].type).toBe('collectible.collected');

    expect(() => runtime.events.emit('gameplay.event' as never, { type: 'nope', child: 'Ada' } as never)).not.toThrow();
    expect(onGameplayEvent).toHaveBeenCalledTimes(1);
    expect(runtime.diagnostics.snapshot().counters[HOST_COUNTERS.invalidClaims]).toBe(1);

    runtime.events.emit('PlayerJumped' as never, { airJump: false } as never);
    expect(onEngineEvent).toHaveBeenCalledWith('PlayerJumped', { airJump: false });
    expect(onEngineEvent.mock.calls.some(([name]) => name === 'gameplay.event')).toBe(false);
  });

  it('counts a throwing callback instead of throwing into React', async () => {
    const h = harness();
    render(
      <GameHost
        runtimeId="t"
        label="x"
        onEngineEvent={() => {
          throw new Error('boom');
        }}
        createRuntime={h.createRuntime}
        rendererFactory={h.rendererFactory}
      />,
    );
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));
    const runtime = h.runtimes[0]!;
    expect(() => runtime.events.emit('PlayerLanded' as never, { impactSpeed: 1 } as never)).not.toThrow();
    expect(runtime.diagnostics.snapshot().counters[HOST_COUNTERS.callbackErrors]).toBeGreaterThanOrEqual(1);
  });
});
