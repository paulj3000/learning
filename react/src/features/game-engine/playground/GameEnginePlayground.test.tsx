import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineRuntime } from '@lai/game-engine/core';
import { PhysicsProviderService } from '@lai/game-engine/contracts';
import { GameEnginePlayground } from './GameEnginePlayground';
import {
  PLAYGROUND_CAPABILITIES,
  createInMemoryPhysicsProvider,
  createPlaygroundRegistry,
  demoSceneCapability,
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
    expect(await screen.findByText(/Colliders: SOLID 2, JUMPABLE 3, TRIGGER 1, gate 1/)).toBeInTheDocument();
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
  it('installs meshes, colliders and a player entity, and uninstalls cleanly', async () => {
    const runtime = createEngineRuntime({ id: 'scene', capabilities: createPlaygroundRegistry() });
    const view = {
      renderer: createFakeRenderer(),
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      canvas: document.createElement('canvas'),
      size: () => ({ width: 100, height: 100 }),
    };
    runtime.services.provide(HostViewService, view);
    runtime.services.provide(HostPreferencesService, { reducedMotion: true });
    await runtime.start([{ id: 'playground.demoScene', config: { ageBand: 'SPROUT' } }]);
    const provider = runtime.services.require(PhysicsProviderService);
    expect(provider.colliders().length).toBe(7);
    expect(provider.getCollider('step.jumpable.1')?.max.y).toBe(0.4);
    expect(provider.getCollider('gate.1')?.gate).toBe(true);
    expect(runtime.world.size).toBe(1);
    expect(view.scene.children).toHaveLength(1);
    runtime.tick(0.1);
    expect(runtime.world.size).toBe(1);
    runtime.dispose();
    expect(view.scene.children).toHaveLength(0);
  });

  it('rejects an unknown age band', () => {
    expect(demoSceneCapability.validate({ ageBand: 'TEEN' }).ok).toBe(false);
    expect(demoSceneCapability.validate(undefined).ok).toBe(true);
  });

  it('the in-memory provider answers raycasts and overlaps and notifies changes', () => {
    const provider = createInMemoryPhysicsProvider();
    const onChange = vi.fn();
    provider.onChange(onChange);
    provider.addCollider({ id: 'a', kind: 'SOLID', min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const hit = provider.raycast({ x: 0.5, y: 5, z: 0.5 }, { x: 0, y: -1, z: 0 }, 10);
    expect(hit?.colliderId).toBe('a');
    expect(hit?.distance).toBeCloseTo(4);
    expect(provider.raycast({ x: 5, y: 5, z: 5 }, { x: 0, y: -1, z: 0 }, 10)).toBeNull();
    expect(provider.overlaps({ x: 0.5, y: 0.5, z: 0.5 }, { x: 2, y: 2, z: 2 })).toEqual(['a']);
    expect(provider.removeCollider('a')).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

