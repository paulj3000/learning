import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { AudioError, type SoundManager } from '../AudioTypes';
import { FakeEngine } from '../testing/fakes';
import { createManifestSync, type ManifestSync } from './AudioManifestSync';
import type { ManifestScope } from './manifestTypes';

const REGION: ManifestScope = { type: 'region', id: 'treasure-cove' };
const PLACE: ManifestScope = { type: 'place', id: 'pirate-bay' };

function manifestFor(scope: ManifestScope, revision: string, extra: object[] = []) {
  return {
    schemaVersion: 1,
    revision,
    scope,
    sounds: [
      { id: 'sfx.chest.open', assetId: 'chest-creak@1', channel: 'sfx', volume: 0.85, loop: false },
      ...extra,
    ],
    assignments: [
      { event: 'on_open', targetType: 'chest', targetId: 'chest-001', soundId: 'sfx.chest.open' },
    ],
  };
}

const resolver = () => ({
  resolve: vi.fn(async (id: string, _options?: { forceRefresh?: boolean }) => ({
    id,
    url: `signed://${id}`,
    cacheKey: `${id}@version`,
  })),
});

let engine: FakeEngine;
let manager: SoundManager;
let syncs: ManifestSync[];
let unhandled: unknown[];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  engine = new FakeEngine();
  manager = createSoundManager({ engine });
  syncs = [];
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(async () => {
  process.off('unhandledRejection', onUnhandled);
  for (const sync of syncs) sync.dispose();
  manager.dispose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(unhandled).toEqual([]);
});

function make(
  fetchManifest: (scope: ManifestScope, signal: AbortSignal) => Promise<unknown>,
  r = resolver(),
) {
  const sync = createManifestSync({ manager, fetchManifest, resolver: r });
  syncs.push(sync);
  return { sync, resolver: r };
}

describe('loading a manifest', () => {
  it('registers the published sounds in the Sound Manager', async () => {
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    expect(manager.has('sfx.chest.open')).toBe(false);
    await expect(sync.load(REGION)).resolves.toEqual({ status: 'loaded', revision: 'r1' });
    expect(manager.has('sfx.chest.open')).toBe(true);
    expect(sync.scope).toEqual(REGION);
    expect(sync.revision).toBe('r1');
  });

  it('plays a registered sound through the asset resolver, by its pinned reference', async () => {
    const { sync, resolver: r } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    const handle = await sync.trigger('on_open', 'chest', 'chest-001');
    expect(handle?.soundId).toBe('sfx.chest.open');
    expect(r.resolve).toHaveBeenCalledWith('chest-creak@1', { forceRefresh: false });
    expect(engine.loadLog[0]).toMatchObject({
      url: 'signed://chest-creak@1',
      options: { cacheKey: 'chest-creak@1@version' },
    });
    expect(engine.voices[0]?.options.volume).toBe(0.85);
  });

  it('looks up the sound assigned to an event, and nothing for an unassigned one', async () => {
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    expect(sync.soundFor('on_open', 'chest', 'chest-001')).toBe('sfx.chest.open');
    expect(sync.soundFor('on_close', 'chest', 'chest-001')).toBeNull();
    expect(sync.soundFor('on_open', 'chest', 'chest-999')).toBeNull();
    await expect(sync.trigger('on_close', 'chest', 'chest-001')).resolves.toBeNull();
  });

  it('applies the manifest playback settings (cooldown and concurrency) to real playback', async () => {
    const extra = [
      {
        id: 'sfx.coin.collect',
        assetId: 'coin@1',
        channel: 'sfx',
        volume: 1,
        loop: false,
        maxConcurrent: 1,
      },
    ];
    const { sync } = make(async () => manifestFor(REGION, 'r1', extra));
    await sync.load(REGION);
    const first = await manager.play('sfx.coin.collect');
    const second = await manager.play('sfx.coin.collect');
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(sync.revision).toBe('r1');
  });

  it("leaves the application's own sounds alone", async () => {
    manager.register({ id: 'ui.menu.select', channel: 'ui', url: 'test://select' });
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    expect(manager.has('ui.menu.select')).toBe(true);
  });

  it('refuses a manifest sound that would replace an application sound', async () => {
    manager.register({ id: 'sfx.chest.open', channel: 'sfx', url: 'test://mine' });
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    const handle = await manager.play('sfx.chest.open');
    expect(handle).not.toBeNull();
    expect(engine.loadLog[0]?.url).toBe('test://mine');
    expect(sync.soundFor('on_open', 'chest', 'chest-001')).toBeNull();
    expect(manager.getDiagnostics().some((d) => d.code === 'invalid-manifest')).toBe(true);
  });
});

describe('invalid and unavailable manifests', () => {
  it('records an invalid document and registers nothing', async () => {
    const { sync } = make(async () => ({ schemaVersion: 9 }));
    await expect(sync.load(REGION)).resolves.toMatchObject({ status: 'failed' });
    expect(manager.has('sfx.chest.open')).toBe(false);
    expect(manager.getDiagnostics()[0]).toMatchObject({ code: 'invalid-manifest' });
  });

  it('rejects a manifest that answers for a different scope', async () => {
    const { sync } = make(async () => manifestFor(PLACE, 'r1'));
    await expect(sync.load(REGION)).resolves.toMatchObject({ status: 'failed' });
    expect(manager.has('sfx.chest.open')).toBe(false);
  });

  it('keeps the usable sounds when one entry is bad, and reports the skip', async () => {
    const bad = { id: 'nonsense', assetId: 'x@1', channel: 'sfx', volume: 1, loop: false };
    const { sync } = make(async () => manifestFor(REGION, 'r1', [bad]));
    await expect(sync.load(REGION)).resolves.toMatchObject({ status: 'loaded' });
    expect(manager.has('sfx.chest.open')).toBe(true);
    expect(manager.getDiagnostics().some((d) => d.message.includes('skipped'))).toBe(true);
  });

  it('survives a network failure without throwing and stays silent', async () => {
    const { sync } = make(async () => {
      throw new Error('offline');
    });
    await expect(sync.load(REGION)).resolves.toEqual({ status: 'failed', revision: null });
    expect(manager.getDiagnostics()[0]).toMatchObject({ code: 'manifest-failed' });
    await expect(sync.trigger('on_open', 'chest', 'chest-001')).resolves.toBeNull();
  });

  it('keeps the last good sounds for the same scope when a refresh fails', async () => {
    let fail = false;
    const { sync } = make(async () => {
      if (fail) throw new Error('offline');
      return manifestFor(REGION, 'r1');
    });
    await sync.load(REGION);
    fail = true;
    await expect(sync.refresh()).resolves.toMatchObject({ status: 'failed', revision: 'r1' });
    expect(manager.has('sfx.chest.open')).toBe(true);
    expect(sync.soundFor('on_open', 'chest', 'chest-001')).toBe('sfx.chest.open');
  });

  it("does not leak the previous scope's sounds when moving to a scope that fails", async () => {
    const { sync } = make(async (scope) => {
      if (scope.id === PLACE.id) throw new Error('offline');
      return manifestFor(scope, 'r1');
    });
    await sync.load(REGION);
    await sync.load(PLACE);
    expect(manager.has('sfx.chest.open')).toBe(false);
    expect(sync.scope).toBeNull();
  });

  it('an empty manifest registers nothing and is not an error', async () => {
    const { sync } = make(async () => ({
      ...manifestFor(REGION, 'empty'),
      sounds: [],
      assignments: [],
    }));
    await expect(sync.load(REGION)).resolves.toMatchObject({ status: 'loaded' });
    expect(manager.getDiagnostics()).toEqual([]);
  });
});

describe('missing and expired audio', () => {
  it('plays nothing and records missing-asset when the asset is not published', async () => {
    const r = resolver();
    r.resolve.mockRejectedValue(new Error('retired'));
    const { sync } = make(async () => manifestFor(REGION, 'r1'), r);
    await sync.load(REGION);
    await expect(sync.trigger('on_open', 'chest', 'chest-001')).resolves.toBeNull();
    expect(manager.getDiagnostics().some((d) => d.code === 'missing-asset')).toBe(true);
  });

  it('asks for a fresh url once when a signed url has expired, then plays', async () => {
    engine.failNext = [new AudioError('load-failed', 'HTTP 404', { status: 404 })];
    const { sync, resolver: r } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    const handle = await sync.trigger('on_open', 'chest', 'chest-001');
    expect(handle).not.toBeNull();
    expect(r.resolve.mock.calls.map((call) => call[1])).toEqual([
      { forceRefresh: false },
      { forceRefresh: true },
    ]);
    expect(engine.loadLog).toHaveLength(2);
  });

  it('gives up quietly when the refreshed url fails too', async () => {
    engine.failNext = [
      new AudioError('load-failed', 'HTTP 403', { status: 403 }),
      new AudioError('load-failed', 'HTTP 403', { status: 403 }),
    ];
    const { sync, resolver: r } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    await expect(sync.trigger('on_open', 'chest', 'chest-001')).resolves.toBeNull();
    expect(r.resolve).toHaveBeenCalledTimes(2);
  });

  it('does not retry an error that is not about an expired url', async () => {
    engine.failNext = [new AudioError('load-failed', 'HTTP 500', { status: 500 })];
    const { sync, resolver: r } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    await expect(sync.trigger('on_open', 'chest', 'chest-001')).resolves.toBeNull();
    expect(r.resolve).toHaveBeenCalledTimes(1);
  });
});

describe('refreshing and replacing the registry', () => {
  it('reports unchanged when the revision has not moved', async () => {
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    await expect(sync.refresh()).resolves.toEqual({ status: 'unchanged', revision: 'r1' });
  });

  it('replaces the definitions when the revision changes, removing sounds that were retired', async () => {
    let revision = 'r1';
    const { sync } = make(async () =>
      revision === 'r1'
        ? manifestFor(REGION, 'r1', [
            { id: 'sfx.coin.collect', assetId: 'coin@1', channel: 'sfx', volume: 1, loop: false },
          ])
        : {
            ...manifestFor(REGION, 'r2'),
            sounds: [
              {
                id: 'sfx.chest.open',
                assetId: 'chest-creak@2',
                channel: 'sfx',
                volume: 0.5,
                loop: false,
              },
            ],
          },
    );
    await sync.load(REGION);
    expect(manager.has('sfx.coin.collect')).toBe(true);
    revision = 'r2';
    await expect(sync.refresh()).resolves.toEqual({ status: 'loaded', revision: 'r2' });
    expect(manager.has('sfx.coin.collect')).toBe(false);
    await sync.trigger('on_open', 'chest', 'chest-001');
    expect(engine.voices[0]?.options.volume).toBe(0.5);
  });

  it('keeps a sound that is already playing when its definition is replaced', async () => {
    let revision = 'r1';
    const { sync } = make(async () => manifestFor(REGION, revision));
    await sync.load(REGION);
    const playing = await sync.trigger('on_open', 'chest', 'chest-001');
    revision = 'r2';
    await sync.refresh();
    expect(playing?.state).toBe('playing');
  });

  it('refresh with nothing loaded fails cleanly', async () => {
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    await expect(sync.refresh()).resolves.toEqual({ status: 'failed', revision: null });
  });
});

describe('concurrent loading', () => {
  it('shares one request between simultaneous loads of the same scope', async () => {
    const fetchManifest = vi.fn(async () => manifestFor(REGION, 'r1'));
    const { sync } = make(fetchManifest);
    const [a, b] = await Promise.all([sync.load(REGION), sync.load(REGION)]);
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('lets the latest scope win and ignores the slower earlier one', async () => {
    const releases: Record<string, () => void> = {};
    const { sync } = make(
      (scope) =>
        new Promise((resolve) => {
          releases[scope.id] = () => resolve(manifestFor(scope, `rev-${scope.id}`));
        }),
    );
    const first = sync.load(REGION);
    const second = sync.load(PLACE);
    releases[PLACE.id]?.();
    await expect(second).resolves.toMatchObject({ status: 'loaded' });
    releases[REGION.id]?.();
    await expect(first).resolves.toMatchObject({ status: 'superseded' });
    expect(sync.scope).toEqual(PLACE);
    expect(sync.revision).toBe('rev-pirate-bay');
  });

  it('aborts the superseded request', async () => {
    const signals: AbortSignal[] = [];
    const { sync } = make((_scope, signal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });
    void sync.load(REGION);
    void sync.load(PLACE);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});

describe('scope changes and disposal', () => {
  it("stops the previous scope's sounds and swaps its definitions when the scope changes", async () => {
    const { sync } = make(async (scope) =>
      scope.id === REGION.id
        ? manifestFor(scope, 'r1')
        : { ...manifestFor(scope, 'p1'), sounds: [], assignments: [] },
    );
    await sync.load(REGION);
    const playing = await sync.trigger('on_open', 'chest', 'chest-001');
    await sync.load(PLACE);
    expect(playing?.state).toBe('ended');
    expect(manager.has('sfx.chest.open')).toBe(false);
    expect(sync.scope).toEqual(PLACE);
  });

  it('dispose stops its sounds, removes its definitions and the resolver, and ignores later loads', async () => {
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    const playing = await sync.trigger('on_open', 'chest', 'chest-001');
    sync.dispose();
    sync.dispose();
    expect(playing?.state).toBe('ended');
    expect(manager.has('sfx.chest.open')).toBe(false);
    await expect(sync.load(REGION)).resolves.toEqual({ status: 'disposed', revision: null });
    await expect(sync.trigger('on_open', 'chest', 'chest-001')).resolves.toBeNull();
  });

  it('a load that finishes after dispose registers nothing', async () => {
    let release: () => void = () => undefined;
    const { sync } = make(
      () =>
        new Promise((resolve) => {
          release = () => resolve(manifestFor(REGION, 'r1'));
        }),
    );
    const pending = sync.load(REGION);
    sync.dispose();
    release();
    await expect(pending).resolves.toMatchObject({ status: 'disposed' });
    expect(manager.has('sfx.chest.open')).toBe(false);
  });

  it('two syncs can coexist without clearing each other', async () => {
    const a = make(async () => manifestFor(REGION, 'r1')).sync;
    const b = make(async (scope) => ({
      ...manifestFor(scope, 'p1'),
      sounds: [
        { id: 'sfx.coin.collect', assetId: 'coin@1', channel: 'sfx', volume: 1, loop: false },
      ],
      assignments: [],
    })).sync;
    await a.load(REGION);
    await b.load(PLACE);
    a.dispose();
    expect(manager.has('sfx.coin.collect')).toBe(true);
    expect(manager.has('sfx.chest.open')).toBe(false);
  });

  it('works with the existing Phase 1 playback after the manager keeps running', async () => {
    const { sync } = make(async () => manifestFor(REGION, 'r1'));
    await sync.load(REGION);
    manager.register({ id: 'ui.click', channel: 'ui', url: 'test://click' });
    const handle = await manager.play('ui.click');
    expect(handle?.state).toBe('playing');
  });
});
