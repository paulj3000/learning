import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineRuntime } from '@lai/game-engine/core';
import { PLAYER_ENTITY_ID, PhysicsProviderService } from '@lai/game-engine/contracts';
import { GameEnginePlayground } from './GameEnginePlayground';
import {
  PLAYGROUND_CAPABILITIES,
  createKeyboardInput,
  createPlaygroundRegistry,
  demoSceneCapability,
  providePlaygroundServices,
  wirePlayground,
} from './playgroundScene';
import { HostPreferencesService, HostViewService } from '../hostTypes';
import { createFakeRenderer, installFakeAnimationFrames } from '../testing';
import { Scene, PerspectiveCamera } from 'three';

describe('GameEnginePlayground', () => {
  let renderers: ReturnType<typeof createFakeRenderer>[];
  const rendererFactory = () => {
    const renderer = createFakeRenderer();
    renderers.push(renderer);
    return renderer;
  };

  beforeEach(() => {
    renderers = [];
    installFakeAnimationFrames();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders the controls and a running scene with the fake renderer', async () => {
    render(<GameEnginePlayground rendererFactory={rendererFactory} />);
    expect(screen.getByRole('heading', { name: 'Game engine playground' })).toBeInTheDocument();
    const region = await screen.findByRole('region', { name: 'Game engine test scene' });
    await waitFor(() => expect(region).toHaveAttribute('data-status', 'ready'));
    expect(screen.getByRole('checkbox', { name: /Demo scene/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Age band' })).toHaveValue('PATHFINDER');
    expect(screen.getByRole('complementary', { name: 'Engine diagnostics' })).toBeInTheDocument();
    expect(await screen.findByText(/Colliders: SOLID 1, JUMPABLE 5, TRIGGER 1, gate 1/)).toBeInTheDocument();
  });

  it('emits sample claims into the event log and shows an invalid claim as dropped', async () => {
    render(<GameEnginePlayground rendererFactory={rendererFactory} />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Game engine test scene' })).toHaveAttribute('data-status', 'ready'));
    const log = screen.getByRole('region', { name: 'Event log' });
    await userEvent.click(screen.getByRole('button', { name: 'Collect coin' }));
    expect(within(log).getByText('collectible.collected')).toBeInTheDocument();
    expect(within(log).getByText(/coin\.demo\.1/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send an invalid claim' }));
    expect(within(log).getByText('invalid claim')).toBeInTheDocument();
    expect(within(log).getByText('(dropped)')).toBeInTheDocument();
  });

  it('restarts the engine when the age band changes and can hide the overlay', async () => {
    render(<GameEnginePlayground rendererFactory={rendererFactory} />);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Game engine test scene' })).toHaveAttribute('data-status', 'ready'));
    const before = renderers.length;
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Age band' }), 'SPROUT');
    await waitFor(() => expect(renderers.length).toBeGreaterThan(before));
    expect(renderers[before - 1]!.dispose).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Game engine test scene' })).toHaveAttribute('data-status', 'ready'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Debug overlay' }));
    expect(screen.queryByRole('complementary', { name: 'Engine diagnostics' })).not.toBeInTheDocument();
  });

  it('exposes the capability list for later wiring', () => {
    expect(PLAYGROUND_CAPABILITIES.map((c) => c.id)).toContain('playground.demoScene');
  });
});

describe('playground scene', () => {
  const makeView = () => ({
    renderer: createFakeRenderer(),
    scene: new Scene(),
    camera: new PerspectiveCamera(),
    canvas: document.createElement('canvas'),
    size: () => ({ width: 100, height: 100 }),
  });

  it('runs the real engine on the demo layout and uninstalls cleanly', async () => {
    const runtime = createEngineRuntime({ id: 'scene', capabilities: createPlaygroundRegistry() });
    const services = providePlaygroundServices(runtime);
    const view = makeView();
    runtime.services.provide(HostViewService, view);
    runtime.services.provide(HostPreferencesService, { reducedMotion: true });
    const requests = PLAYGROUND_CAPABILITIES.map((c) => c.toRequest('SPROUT'));
    await runtime.start(requests);
    const provider = runtime.services.require(PhysicsProviderService);
    expect(provider.colliders().map((c) => c.id).sort()).toEqual(
      ['crate.jumpable.1', 'ferry', 'gate.1', 'ramp.jumpable.1', 'step.jumpable.1', 'step.jumpable.2', 'wall.solid.1', 'zone.trigger.1'].sort(),
    );
    expect(provider.getCollider('step.jumpable.1')?.max.y).toBe(0.4);
    expect(provider.getCollider('gate.1')?.gate).toBe(true);
    const input = { poll: () => ({ move: { forward: 1, strafe: 0 } }) };
    const handle = wirePlayground(runtime, services, input, view);
    expect(handle).not.toBeNull();
    expect(handle!.camera).not.toBeNull();
    expect(services.settings.reducedMotion).toBe(true);
    expect(runtime.world.bySemanticId(PLAYER_ENTITY_ID)).toBeDefined();
    const startZ = handle!.controller.position.z;
    for (let i = 0; i < 30; i += 1) runtime.tick(1 / 60);
    expect(handle!.controller.position.z).not.toBeCloseTo(startZ, 3);
    expect(view.scene.children.length).toBeGreaterThan(0);
    runtime.dispose();
    expect(view.scene.children).toHaveLength(0);
    expect(runtime.world.size).toBe(0);
  });

  it('wires no player when locomotion is off', async () => {
    const runtime = createEngineRuntime({ id: 'scene', capabilities: createPlaygroundRegistry() });
    const services = providePlaygroundServices(runtime);
    const view = makeView();
    runtime.services.provide(HostViewService, view);
    await runtime.start([{ id: 'playground.demoScene' }]);
    expect(wirePlayground(runtime, services, { poll: () => ({ move: { forward: 0, strafe: 0 } }) }, view)).toBeNull();
    runtime.dispose();
  });

  it('rejects an unknown age band', () => {
    expect(demoSceneCapability.validate({ ageBand: 'TEEN' }).ok).toBe(false);
    expect(demoSceneCapability.validate(undefined).ok).toBe(true);
  });

  it('reads the keyboard: movement, one jump per press, and reset', () => {
    const target = new EventTarget();
    const keyboard = createKeyboardInput(target);
    const key = (type: string, code: string, repeat = false) =>
      target.dispatchEvent(Object.assign(new Event(type), { code, repeat }));
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    key('keydown', 'Space', true);
    expect(keyboard.poll()).toMatchObject({ move: { forward: 1, strafe: 0, sprint: false }, jumpPressed: true });
    expect(keyboard.poll().jumpPressed).toBe(false);
    key('keydown', 'ArrowLeft');
    expect(keyboard.poll().move.strafe).toBe(-1);
    keyboard.reset();
    expect(keyboard.poll().move).toMatchObject({ forward: 0, strafe: 0 });
    keyboard.dispose();
    key('keydown', 'KeyW');
    expect(keyboard.poll().move.forward).toBe(0);
  });
});
