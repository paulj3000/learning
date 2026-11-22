import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createArtifactPedestal,
  fitToPedestal,
  MAX_BOB_M,
  MAX_SPIN_RAD_PER_S,
  nextPedestalState,
  PEDESTAL_FOOTPRINT,
  pedestalPose,
  type PedestalEvent,
  type PedestalState,
} from './artifactPedestal';
import source from './artifactPedestal.ts?raw';

const AT = { x: 1, y: 0.9, z: -8 };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function modelOfSize(w: number, h: number, d: number): Group {
  const group = new Group();
  const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial());
  mesh.position.set(5, h / 2 + 2, -3); // off-centre and lifted, as an exported model often is
  group.add(mesh);
  return group;
}

const names = (pedestal: { group: Group }) => {
  const found: string[] = [];
  pedestal.group.traverse((object) => found.push(object.name));
  return found;
};

describe('nextPedestalState', () => {
  const STATES: PedestalState[] = ['empty', 'loading', 'occupied', 'failed'];

  it('goes empty -> loading -> occupied for an owned keepsake with a model', () => {
    let state: PedestalState = 'empty';
    state = nextPedestalState(state, { type: 'OWNED', hasModel: true });
    expect(state).toBe('loading');
    expect(nextPedestalState(state, { type: 'ASSET_READY' })).toBe('occupied');
  });

  it('shows the primitive at once when no model is named', () => {
    expect(nextPedestalState('empty', { type: 'OWNED', hasModel: false })).toBe('occupied');
  });

  it('fails to the primitive on an asset error or a timeout, only while loading', () => {
    expect(nextPedestalState('loading', { type: 'ASSET_FAILED' })).toBe('failed');
    expect(nextPedestalState('loading', { type: 'ASSET_TIMEOUT' })).toBe('failed');
    for (const state of ['empty', 'occupied', 'failed'] as const) {
      expect(nextPedestalState(state, { type: 'ASSET_FAILED' })).toBe(state);
      expect(nextPedestalState(state, { type: 'ASSET_READY' })).toBe(state);
    }
  });

  it('returns to empty from any state only when ownership goes away', () => {
    for (const state of STATES)
      expect(nextPedestalState(state, { type: 'NOT_OWNED' })).toBe('empty');
    for (const state of ['loading', 'occupied', 'failed'] as const) {
      expect(nextPedestalState(state, { type: 'OWNED', hasModel: true })).toBe(state);
    }
  });

  it('is total: every state and event gives a known state', () => {
    const events: PedestalEvent[] = [
      { type: 'OWNED', hasModel: true },
      { type: 'OWNED', hasModel: false },
      { type: 'NOT_OWNED' },
      { type: 'ASSET_READY' },
      { type: 'ASSET_FAILED' },
      { type: 'ASSET_TIMEOUT' },
    ];
    for (const state of STATES) {
      for (const event of events) expect(STATES).toContain(nextPedestalState(state, event));
    }
  });
});

describe('fitToPedestal (scale normalisation)', () => {
  it('fits a wide model to the footprint and stands it centred on the base', () => {
    const fit = fitToPedestal(
      { min: { x: 4, y: 2, z: -4 }, max: { x: 6, y: 2.5, z: -2 } },
      { baseY: 0 },
    );
    expect(fit.scale).toBeCloseTo(PEDESTAL_FOOTPRINT / 2);
    expect(fit.offset.x).toBeCloseTo(-5 * fit.scale);
    expect(fit.offset.z).toBeCloseTo(3 * fit.scale);
    expect(fit.offset.y).toBeCloseTo(-2 * fit.scale);
  });

  it('fits a tall model to the target height when that is tighter', () => {
    const fit = fitToPedestal(
      { min: { x: -0.05, y: 0, z: -0.05 }, max: { x: 0.05, y: 3, z: 0.05 } },
      { targetHeight: 0.3 },
    );
    expect(fit.scale).toBeCloseTo(0.1);
  });

  it('keeps scale 1 for a degenerate or non-finite box, so a broken model never vanishes', () => {
    expect(fitToPedestal({ min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }).scale).toBe(1);
    const inf = Number.POSITIVE_INFINITY;
    expect(
      fitToPedestal({ min: { x: inf, y: inf, z: inf }, max: { x: -inf, y: -inf, z: -inf } }).scale,
    ).toBe(1);
  });
});

describe('pedestalPose', () => {
  it('is static under reduced motion, at any time', () => {
    for (const t of [0, 1, 7.5, 1000])
      expect(pedestalPose(t, true)).toEqual({ rotationY: 0, bob: 0 });
  });

  it('spins slowly and bobs gently otherwise', () => {
    for (let t = 0; t < 30; t += 0.37) {
      const pose = pedestalPose(t, false);
      expect(Math.abs(pose.bob)).toBeLessThan(MAX_BOB_M);
    }
    const a = pedestalPose(1, false).rotationY;
    const b = pedestalPose(2, false).rotationY;
    expect(b - a).toBeLessThanOrEqual(MAX_SPIN_RAD_PER_S);
    expect(b - a).toBeGreaterThan(0);
  });
});

describe('createArtifactPedestal', () => {
  afterEach(() => vi.useRealTimers());

  it('shows only the plate while empty, and an unbound pedestal stays empty', () => {
    const pedestal = createArtifactPedestal({ id: 'p1', position: AT, reducedMotion: true });
    pedestal.setOwned(true);
    expect(pedestal.state()).toBe('empty');
    expect(names(pedestal)).toContain('artifact-pedestal-p1-plate');
    expect(names(pedestal).some((n) => n.endsWith('-fallback') || n.endsWith('-model'))).toBe(
      false,
    );
    expect(pedestal.group.position.toArray()).toEqual([AT.x, AT.y, AT.z]);
  });

  it('shows the primitive keepsake at once when no model is named', () => {
    const pedestal = createArtifactPedestal({
      id: 'p2',
      position: AT,
      itemId: 'x',
      reducedMotion: true,
    });
    pedestal.setOwned(true);
    expect(pedestal.state()).toBe('occupied');
    expect(names(pedestal)).toContain('artifact-pedestal-p2-fallback');
  });

  it('loads a model, normalises it to the plate once, and shows it', async () => {
    const loadModel = vi.fn(async () => modelOfSize(2, 0.5, 1));
    const pedestal = createArtifactPedestal({
      id: 'p3',
      position: AT,
      itemId: 'x',
      modelRef: 'keepsake-brush',
      reducedMotion: true,
      loadModel,
    });
    pedestal.setOwned(true);
    expect(pedestal.state()).toBe('loading');
    expect(names(pedestal)).toContain('artifact-pedestal-p3-placeholder');
    await flush();
    expect(pedestal.state()).toBe('occupied');
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(loadModel).toHaveBeenCalledWith('keepsake-brush');
    const holder = pedestal.group.getObjectByName('artifact-pedestal-p3-model')!;
    const model = holder.children[0];
    expect(model.scale.x).toBeCloseTo(PEDESTAL_FOOTPRINT / 2);
    expect(model.scale.y).toBe(model.scale.x);
    pedestal.setOwned(true); // already shown: no second load
    expect(loadModel).toHaveBeenCalledTimes(1);
  });

  it('falls back to the primitive on a load error, never blank', async () => {
    const pedestal = createArtifactPedestal({
      id: 'p4',
      position: AT,
      itemId: 'x',
      modelRef: 'missing',
      reducedMotion: true,
      loadModel: () => Promise.reject(new Error('404')),
    });
    pedestal.setOwned(true);
    await flush();
    expect(pedestal.state()).toBe('failed');
    expect(names(pedestal)).toContain('artifact-pedestal-p4-fallback');
  });

  it('falls back on a timeout and ignores the late model', async () => {
    vi.useFakeTimers();
    let resolve: (value: Group) => void = () => {};
    const pedestal = createArtifactPedestal({
      id: 'p5',
      position: AT,
      itemId: 'x',
      modelRef: 'slow',
      reducedMotion: true,
      timeoutMs: 100,
      loadModel: () => new Promise<Group>((r) => (resolve = r)),
    });
    pedestal.setOwned(true);
    vi.advanceTimersByTime(150);
    expect(pedestal.state()).toBe('failed');
    resolve(modelOfSize(1, 1, 1));
    await Promise.resolve();
    expect(pedestal.state()).toBe('failed');
    expect(pedestal.group.getObjectByName('artifact-pedestal-p5-model')).toBeUndefined();
  });

  it('goes back to empty when the backpack is cleared, and a late load is ignored', async () => {
    let resolve: (value: Group) => void = () => {};
    const pedestal = createArtifactPedestal({
      id: 'p6',
      position: AT,
      itemId: 'x',
      modelRef: 'slow',
      reducedMotion: true,
      loadModel: () => new Promise<Group>((r) => (resolve = r)),
    });
    pedestal.setOwned(true);
    pedestal.setOwned(false);
    resolve(modelOfSize(1, 1, 1));
    await flush();
    expect(pedestal.state()).toBe('empty');
    expect(pedestal.group.getObjectByName('artifact-pedestal-p6-model')).toBeUndefined();
  });

  it('does not animate under reduced motion, and animates gently otherwise', () => {
    const still = createArtifactPedestal({
      id: 's',
      position: AT,
      itemId: 'x',
      reducedMotion: true,
    });
    still.setOwned(true);
    const display = still.group.getObjectByName('artifact-pedestal-s-display')!;
    const before = [display.rotation.y, display.position.y];
    for (const t of [0.5, 3, 9]) still.tick(t);
    expect([display.rotation.y, display.position.y]).toEqual(before);

    const moving = createArtifactPedestal({
      id: 'm',
      position: AT,
      itemId: 'x',
      reducedMotion: false,
    });
    moving.setOwned(true);
    moving.tick(3);
    expect(moving.group.getObjectByName('artifact-pedestal-m-display')!.rotation.y).not.toBe(0);
  });

  it('disposes the geometry and materials it built, and leaves the parent', () => {
    const parent = new Group();
    const pedestal = createArtifactPedestal({
      id: 'd',
      position: AT,
      itemId: 'x',
      reducedMotion: true,
    });
    parent.add(pedestal.group);
    pedestal.setOwned(true);
    const meshes: Mesh[] = [];
    pedestal.group.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    const spies = meshes.flatMap((mesh) => [
      vi.spyOn(mesh.geometry, 'dispose'),
      vi.spyOn(mesh.material as MeshStandardMaterial, 'dispose'),
    ]);
    pedestal.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
    pedestal.setOwned(false); // after dispose nothing moves
    expect(pedestal.state()).toBe('occupied');
    expect(pedestal.group.children.length).toBeGreaterThan(0);
  });
});

describe('the pedestal module boundary', () => {
  it('imports three only: no React, API client, rewards writer, Django or AWS', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports).toEqual(['three']);
  });

  it('never grants or records anything', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toMatch(/grant|fetch\(|reward|worldChange|inventory|api/i);
  });
});
