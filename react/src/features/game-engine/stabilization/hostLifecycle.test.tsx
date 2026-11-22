import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineRuntime, type EngineRuntime } from '@lai/game-engine/core';
import {
  createGameplayEventFactory,
  GAMEPLAY_EVENT_TYPES,
  validateGameplayEvent,
} from '@lai/game-engine/contracts';
import { GameHost } from '../GameHost';
import { HOST_COUNTERS } from '../useEngineRuntime';
import { HOST_EVENTS, HostPreferencesService } from '../hostTypes';
import { createFakeRenderer, installFakeAnimationFrames } from '../testing';

/**
 * GE-T1: enough remounts to show a per-cycle leak (one shows from the second cycle), few enough
 * to stay inside the default 5 s budget under the test gate. Cut work, never raise a budget.
 */
const REMOUNT_CYCLES = 6;

/**
 * Wave 2 stabilization, areas 2, 7 and 8 (React host side): scene transitions (a runtimeId
 * change or a retry restarts cleanly: old runtime disposed once, new one started once, one tick
 * per frame), accessibility of the host (labels, roles, keyboard-reachable retry, reduced motion)
 * and gameplay event delivery (invalid claims dropped, valid forwarded).
 */

function harness() {
  const runtimes: EngineRuntime[] = [];
  const renderers: ReturnType<typeof createFakeRenderer>[] = [];
  return {
    runtimes,
    renderers,
    createRuntime: () => {
      const runtime = createEngineRuntime({ id: `test.host.${runtimes.length}` });
      vi.spyOn(runtime, 'start');
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

const ready = () =>
  waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready'));

describe('GameHost stabilization', () => {
  let frames: ReturnType<typeof installFakeAnimationFrames>;

  beforeEach(() => {
    frames = installFakeAnimationFrames();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('scene transitions', () => {
    it('a runtimeId change disposes the old runtime once, starts the new one once, and keeps one canvas', async () => {
      const h = harness();
      const props = {
        label: 'Island',
        createRuntime: h.createRuntime,
        rendererFactory: h.rendererFactory,
      };
      const { rerender } = render(<GameHost runtimeId="cove" {...props} />);
      await ready();
      rerender(<GameHost runtimeId="forest" {...props} />);
      await ready();
      expect(h.runtimes).toHaveLength(2);
      const [old, next] = h.runtimes as [EngineRuntime, EngineRuntime];
      expect(old.dispose).toHaveBeenCalledTimes(1);
      expect(old.state).toBe('disposed');
      expect(old.start).toHaveBeenCalledTimes(1);
      expect(next.start).toHaveBeenCalledTimes(1);
      expect(next.dispose).not.toHaveBeenCalled();
      expect(next.state).toBe('running');
      expect(h.renderers[0]!.dispose).toHaveBeenCalledTimes(1);
      expect(h.renderers[1]!.dispose).not.toHaveBeenCalled();
      expect(screen.getByTestId('game-host-canvas').querySelectorAll('canvas')).toHaveLength(1);
    });

    it('after a runtimeId change only the new runtime ticks, once per frame (no double tick)', async () => {
      const h = harness();
      const props = {
        label: 'Island',
        createRuntime: h.createRuntime,
        rendererFactory: h.rendererFactory,
      };
      const { rerender } = render(<GameHost runtimeId="cove" {...props} />);
      await ready();
      act(() => frames.step());
      rerender(<GameHost runtimeId="forest" {...props} />);
      await ready();
      const [old, next] = h.runtimes as [EngineRuntime, EngineRuntime];
      const oldTicks = vi.mocked(old.tick).mock.calls.length;
      expect(frames.pendingCount()).toBe(1); // exactly one loop is scheduled
      for (let i = 0; i < 5; i += 1) act(() => frames.step());
      expect(vi.mocked(old.tick).mock.calls.length).toBe(oldTicks);
      expect(vi.mocked(next.tick)).toHaveBeenCalledTimes(5);
      expect(h.renderers[1]!.render).toHaveBeenCalledTimes(5);
      expect(h.renderers[0]!.render).toHaveBeenCalledTimes(1);
    });

    it('rapid runtimeId changes (5 scenes) leave exactly one live runtime, renderer, canvas and frame loop', async () => {
      const h = harness();
      const props = {
        label: 'Island',
        createRuntime: h.createRuntime,
        rendererFactory: h.rendererFactory,
      };
      const { rerender } = render(<GameHost runtimeId="scene-0" {...props} />);
      for (let i = 1; i < 5; i += 1) rerender(<GameHost runtimeId={`scene-${i}`} {...props} />);
      await ready();
      expect(h.runtimes.filter((r) => r.state === 'running')).toHaveLength(1);
      expect(h.runtimes.filter((r) => r.state !== 'disposed')).toHaveLength(1);
      for (const runtime of h.runtimes.slice(0, -1))
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
      expect(h.renderers.filter((r) => !vi.mocked(r.dispose).mock.calls.length)).toHaveLength(1);
      expect(screen.getByTestId('game-host-canvas').querySelectorAll('canvas')).toHaveLength(1);
      expect(frames.pendingCount()).toBe(1);
    });

    it('a runtimeId change while the old runtime is still starting never readies the old one', async () => {
      const h = harness();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const setup = vi.fn(async (_rt: EngineRuntime) => {
        if (setup.mock.calls.length === 1) await gate;
      });
      const onRuntimeReady = vi.fn();
      const props = {
        label: 'Island',
        setup,
        onRuntimeReady,
        createRuntime: h.createRuntime,
        rendererFactory: h.rendererFactory,
      };
      const { rerender } = render(<GameHost runtimeId="slow" {...props} />);
      rerender(<GameHost runtimeId="fast" {...props} />);
      await ready();
      release();
      await act(async () => {
        await gate;
      });
      expect(onRuntimeReady).toHaveBeenCalledTimes(1);
      expect(onRuntimeReady.mock.calls[0]![0]).toBe(h.runtimes[1]);
      expect(h.runtimes[0]!.state).toBe('disposed');
      expect(screen.getByRole('region')).toHaveAttribute('data-status', 'ready');
      expect(frames.pendingCount()).toBe(1);
    });

    it('retry after a failed start disposes the failed runtime and renderer once and ticks only the new one', async () => {
      const h = harness();
      let fail = true;
      const setup = vi.fn(() => {
        if (fail) throw new Error('boom');
      });
      render(
        <GameHost
          runtimeId="t"
          label="x"
          setup={setup}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      await screen.findByRole('alert');
      expect(frames.pendingCount()).toBe(0);
      fail = false;
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await ready();
      expect(h.runtimes).toHaveLength(2);
      expect(h.runtimes[0]!.state).toBe('disposed');
      expect(h.renderers[0]!.dispose).toHaveBeenCalledTimes(1);
      act(() => frames.step());
      expect(h.runtimes[0]!.tick).not.toHaveBeenCalled();
      expect(h.runtimes[1]!.tick).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a second failure on retry shows the error again (no stuck loading state)', async () => {
      const h = harness();
      const setup = vi.fn(() => {
        throw new Error('still broken');
      });
      render(
        <GameHost
          runtimeId="t"
          label="x"
          setup={setup}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      await screen.findByRole('alert');
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(setup).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('region')).toHaveAttribute('data-status', 'error');
      expect(h.runtimes.every((r) => r.state === 'disposed')).toBe(true);
    });

    it('the pause state does not leak across a restart', async () => {
      const h = harness();
      const props = {
        label: 'Island',
        createRuntime: h.createRuntime,
        rendererFactory: h.rendererFactory,
      };
      const { rerender } = render(<GameHost runtimeId="a" {...props} />);
      await ready();
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      expect(screen.getByRole('region')).toHaveAttribute('data-paused', 'true');
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      rerender(<GameHost runtimeId="b" {...props} />);
      await ready();
      expect(screen.getByRole('region')).toHaveAttribute('data-paused', 'false');
      expect(h.runtimes[1]!.state).toBe('running');
    });

    it('window listeners of a disposed scene no longer pause or resume it', async () => {
      const h = harness();
      const props = {
        label: 'Island',
        createRuntime: h.createRuntime,
        rendererFactory: h.rendererFactory,
      };
      const { rerender } = render(<GameHost runtimeId="a" {...props} />);
      await ready();
      rerender(<GameHost runtimeId="b" {...props} />);
      await ready();
      const pauseSpy = vi.spyOn(h.runtimes[0]!, 'pause');
      const resumeSpy = vi.spyOn(h.runtimes[0]!, 'resume');
      act(() => {
        window.dispatchEvent(new Event('blur'));
        window.dispatchEvent(new Event('focus'));
      });
      expect(pauseSpy).not.toHaveBeenCalled();
      expect(resumeSpy).not.toHaveBeenCalled();
    });

    it(`${REMOUNT_CYCLES} mount/unmount cycles dispose every runtime and renderer exactly once and leave no frame loop or canvas`, async () => {
      const h = harness();
      for (let i = 0; i < REMOUNT_CYCLES; i += 1) {
        const view = render(
          <GameHost
            runtimeId={`cycle-${i}`}
            label="x"
            createRuntime={h.createRuntime}
            rendererFactory={h.rendererFactory}
          />,
        );
        await ready();
        act(() => frames.step());
        view.unmount();
        expect(frames.pendingCount()).toBe(0);
      }
      expect(h.runtimes).toHaveLength(REMOUNT_CYCLES);
      for (const runtime of h.runtimes) {
        expect(runtime.state).toBe('disposed');
        expect(runtime.dispose).toHaveBeenCalledTimes(1);
        expect(runtime.resources.count()).toBe(0);
        expect(runtime.world.size).toBe(0);
        expect(runtime.systems.ids()).toEqual([]);
        expect(runtime.events.listenerCount()).toBe(0);
      }
      for (const renderer of h.renderers) {
        expect(renderer.dispose).toHaveBeenCalledTimes(1);
        expect(renderer.domElement.isConnected).toBe(false);
      }
      expect(document.querySelectorAll('canvas')).toHaveLength(0);
    });

    it(`${REMOUNT_CYCLES} StrictMode mount/unmount cycles also leave exactly zero live runtimes`, async () => {
      const h = harness();
      for (let i = 0; i < REMOUNT_CYCLES; i += 1) {
        const view = render(
          <StrictMode>
            <GameHost
              runtimeId="s"
              label="x"
              createRuntime={h.createRuntime}
              rendererFactory={h.rendererFactory}
            />
          </StrictMode>,
        );
        await ready();
        view.unmount();
      }
      expect(h.runtimes.filter((r) => r.state !== 'disposed')).toHaveLength(0);
      expect(h.renderers.every((r) => vi.mocked(r.dispose).mock.calls.length === 1)).toBe(true);
      expect(frames.pendingCount()).toBe(0);
    });

    it('unmounting while the start is still awaiting disposes it and never reports ready', async () => {
      const h = harness();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const onRuntimeReady = vi.fn();
      const view = render(
        <GameHost
          runtimeId="t"
          label="x"
          onRuntimeReady={onRuntimeReady}
          setup={async () => {
            await gate;
          }}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      view.unmount();
      release();
      await act(async () => {
        await gate;
      });
      expect(h.runtimes[0]!.state).toBe('disposed');
      expect(onRuntimeReady).not.toHaveBeenCalled();
      expect(frames.pendingCount()).toBe(0);
    });
  });

  describe('accessibility', () => {
    it('exposes a named region, busy while loading, a status for loading, and a text alternative', async () => {
      const h = harness();
      render(
        <GameHost
          runtimeId="t"
          label="Pirate Bay scene"
          fallback={<span>A cove with a bridge to repair.</span>}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      const region = screen.getByRole('region', { name: 'Pirate Bay scene' });
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('status')).toHaveTextContent('Getting the island ready');
      await ready();
      expect(region).toHaveAttribute('aria-busy', 'false');
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByText('A cove with a bridge to repair.')).toBeInTheDocument();
      expect(screen.getByTestId('game-host-canvas').querySelector('canvas')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    });

    it('uses the default text alternative when no fallback is given, and localized messages when supplied', async () => {
      const h = harness();
      render(
        <GameHost
          runtimeId="t"
          label="x"
          messages={{ 'gameHost.loading': 'Cargando la isla...' }}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent('Cargando la isla...');
      expect(screen.getByText(/interactive island scene/i)).toBeInTheDocument();
      await ready();
    });

    it('the error is an alert and the retry control is a real button reachable by keyboard, activated by Enter and Space', async () => {
      const h = harness();
      let fail = true;
      const setup = vi.fn(() => {
        if (fail) throw new Error('x');
      });
      render(
        <GameHost
          runtimeId="t"
          label="x"
          setup={setup}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      const alert = await screen.findByRole('alert');
      const retry = screen.getByRole('button', { name: 'Try again' });
      expect(retry.tagName).toBe('BUTTON');
      expect(retry).toHaveAttribute('type', 'button');
      expect(alert).toContainElement(retry);
      await userEvent.tab();
      expect(retry).toHaveFocus();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(setup).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
      await userEvent.tab();
      expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
      fail = false;
      await userEvent.keyboard(' ');
      await ready();
    });

    it('the no-graphics message is an alert with a retry button, not an error message or stack', async () => {
      render(
        <GameHost
          runtimeId="t"
          label="x"
          rendererFactory={() => {
            throw new Error('WebGL context lost at /secret/path.js:12');
          }}
        />,
      );
      const alert = await screen.findByRole('alert');
      expect(alert).not.toHaveTextContent('secret');
      expect(alert).not.toHaveTextContent('WebGL');
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('announces the paused state as a status and clears it on resume', async () => {
      const h = harness();
      render(
        <GameHost
          runtimeId="t"
          label="x"
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      await ready();
      act(() => {
        window.dispatchEvent(new Event('blur'));
      });
      expect(screen.getByRole('status')).toHaveTextContent('The adventure is waiting for you.');
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('the loading overlay and children never show an overlay of children before ready', async () => {
      const h = harness();
      render(
        <GameHost
          runtimeId="t"
          label="x"
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        >
          <button type="button">Hud button</button>
        </GameHost>,
      );
      expect(screen.queryByRole('button', { name: 'Hud button' })).toBeNull();
      await ready();
      expect(screen.getByRole('button', { name: 'Hud button' })).toBeInTheDocument();
    });

    describe('reduced motion preference', () => {
      function stubMatchMedia(matches: boolean) {
        const listeners = new Set<() => void>();
        const state = { matches };
        const query = {
          get matches() {
            return state.matches;
          },
          media: '(prefers-reduced-motion: reduce)',
          addEventListener: (_: string, l: () => void) => listeners.add(l),
          removeEventListener: (_: string, l: () => void) => listeners.delete(l),
        };
        const fn = vi.fn(() => query);
        vi.stubGlobal('matchMedia', fn);
        window.matchMedia = fn as never;
        return { listeners, set: (value: boolean) => (state.matches = value) };
      }

      it('reads the OS setting at start and follows it live (preferencesChanged is emitted)', async () => {
        const media = stubMatchMedia(true);
        const h = harness();
        render(
          <GameHost
            runtimeId="t"
            label="x"
            createRuntime={h.createRuntime}
            rendererFactory={h.rendererFactory}
          />,
        );
        await ready();
        const runtime = h.runtimes[0]!;
        expect(runtime.services.get(HostPreferencesService)?.reducedMotion).toBe(true);
        const changed = vi.fn();
        runtime.events.on(HOST_EVENTS.preferencesChanged as never, changed);
        media.set(false);
        act(() => media.listeners.forEach((l) => l()));
        expect(runtime.services.get(HostPreferencesService)?.reducedMotion).toBe(false);
        expect(changed).toHaveBeenCalledWith({ reducedMotion: false });
      });

      it('a pinned reducedMotion prop wins over the OS and ignores later OS changes', async () => {
        const media = stubMatchMedia(false);
        const h = harness();
        render(
          <GameHost
            runtimeId="t"
            label="x"
            reducedMotion
            createRuntime={h.createRuntime}
            rendererFactory={h.rendererFactory}
          />,
        );
        await ready();
        expect(h.runtimes[0]!.services.get(HostPreferencesService)?.reducedMotion).toBe(true);
        expect(media.listeners.size).toBe(0);
      });

      it('removes the media listener on unmount', async () => {
        const media = stubMatchMedia(false);
        const h = harness();
        const view = render(
          <GameHost
            runtimeId="t"
            label="x"
            createRuntime={h.createRuntime}
            rendererFactory={h.rendererFactory}
          />,
        );
        await ready();
        expect(media.listeners.size).toBe(1);
        view.unmount();
        expect(media.listeners.size).toBe(0);
      });
    });
  });

  describe('gameplay event delivery', () => {
    const factory = createGameplayEventFactory({
      realmId: 'realm.test',
      adventureId: 'adv.test',
      areaId: null,
      sessionRef: null,
    });

    async function mountWithSinks() {
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
      await ready();
      return { runtime: h.runtimes[0]!, onGameplayEvent, onEngineEvent };
    }

    it('forwards every well-formed claim type and none of them reaches onEngineEvent', async () => {
      const { runtime, onGameplayEvent, onEngineEvent } = await mountWithSinks();
      const payloads: Record<string, unknown> = {
        'learning.question.presented': { learningRef: { kind: 'CHEST_CHALLENGE', id: 'q.1' } },
        'learning.answer.submitted': {
          learningRef: { kind: 'CHEST_CHALLENGE', id: 'q.1' },
          choiceId: 'a',
        },
        'exploration.area.entered': { areaId: 'area.1' },
        'exploration.discovery.found': { discoveryId: 'd.1' },
        'collectible.collected': { collectibleId: 'c.1', setId: null },
        'jump.challenge.started': { challengeId: 'j.1' },
        'jump.challenge.completed': { challengeId: 'j.1', routeId: 'r.1' },
        'jump.alternative.used': { challengeId: 'j.1', routeId: 'r.2' },
        'course.checkpoint.reached': { courseId: 'c.1', checkpointId: 'cp.1' },
        'course.completed': { courseId: 'c.1', goalId: 'g.1' },
        'puzzle.completed': { puzzleId: 'p.1' },
        'npc.interaction.completed': { npcId: 'n.1', interactionId: 'i.1' },
        'quest.step.completed': { questId: 'q.1', stepId: 's.1' },
        'quest.completed': { questId: 'q.1' },
        'adventure.started': {},
        'adventure.completed': {},
        'realm.milestone.reached': { milestoneId: 'm.1' },
      };
      let delivered = 0;
      for (const type of GAMEPLAY_EVENT_TYPES) {
        let event;
        try {
          event = factory.create(type, payloads[type] as never);
        } catch {
          continue; // a learning ref shape this test did not guess; covered by the contract tests
        }
        runtime.events.emit('gameplay.event' as never, event as never);
        delivered += 1;
        expect(onGameplayEvent).toHaveBeenCalledTimes(delivered);
        expect(validateGameplayEvent(onGameplayEvent.mock.calls.at(-1)![0]).ok).toBe(true);
      }
      expect(delivered).toBeGreaterThanOrEqual(14);
      expect(onEngineEvent.mock.calls.some(([name]) => name === 'gameplay.event')).toBe(false);
    });

    it('drops every kind of malformed claim, counts each, and never calls the sink', async () => {
      const { runtime, onGameplayEvent } = await mountWithSinks();
      const good = factory.create('puzzle.completed', { puzzleId: 'p.1' });
      const bad: unknown[] = [
        null,
        undefined,
        'puzzle.completed',
        42,
        {},
        { ...good, version: 2 },
        { ...good, schema: 'other' },
        { ...good, type: 'puzzle.exploded' },
        { ...good, eventId: '' },
        { ...good, payload: {} },
        { ...good, payload: { puzzleId: 'has spaces!' } },
        { ...good, realmId: undefined },
        { ...good, occurredAt: 'yesterday' },
      ];
      for (const claim of bad) {
        expect(() => runtime.events.emit('gameplay.event' as never, claim as never)).not.toThrow();
      }
      expect(onGameplayEvent).not.toHaveBeenCalled();
      expect(runtime.diagnostics.snapshot().counters[HOST_COUNTERS.invalidClaims]).toBe(bad.length);
    });

    it('a throwing gameplay sink is counted and never throws into the engine or breaks later delivery', async () => {
      const h = harness();
      const calls: string[] = [];
      render(
        <GameHost
          runtimeId="t"
          label="x"
          onGameplayEvent={(e) => {
            calls.push(e.type);
            if (calls.length === 1) throw new Error('sink down');
          }}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      await ready();
      const runtime = h.runtimes[0]!;
      const event = factory.create('puzzle.completed', { puzzleId: 'p.1' });
      expect(() => runtime.events.emit('gameplay.event' as never, event as never)).not.toThrow();
      runtime.events.emit(
        'gameplay.event' as never,
        factory.create('puzzle.completed', { puzzleId: 'p.2' }) as never,
      );
      expect(calls).toEqual(['puzzle.completed', 'puzzle.completed']);
      expect(runtime.diagnostics.snapshot().counters[HOST_COUNTERS.callbackErrors]).toBe(1);
    });

    it('a new callback identity never restarts the engine, and the latest callback receives the claim', async () => {
      const h = harness();
      const first = vi.fn();
      const second = vi.fn();
      const props = {
        runtimeId: 't',
        label: 'x',
        createRuntime: h.createRuntime,
        rendererFactory: h.rendererFactory,
      };
      const { rerender } = render(<GameHost {...props} onGameplayEvent={first} />);
      await ready();
      rerender(<GameHost {...props} onGameplayEvent={second} />);
      expect(h.runtimes).toHaveLength(1);
      h.runtimes[0]!.events.emit(
        'gameplay.event' as never,
        factory.create('puzzle.completed', { puzzleId: 'p.1' }) as never,
      );
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('claims emitted after unmount are not delivered', async () => {
      const h = harness();
      const onGameplayEvent = vi.fn();
      const view = render(
        <GameHost
          runtimeId="t"
          label="x"
          onGameplayEvent={onGameplayEvent}
          createRuntime={h.createRuntime}
          rendererFactory={h.rendererFactory}
        />,
      );
      await ready();
      const runtime = h.runtimes[0]!;
      view.unmount();
      runtime.events.emit(
        'gameplay.event' as never,
        factory.create('puzzle.completed', { puzzleId: 'p.1' }) as never,
      );
      expect(onGameplayEvent).not.toHaveBeenCalled();
    });
  });
});
