import { describe, expect, it, vi } from 'vitest';
import { createSoundManager } from './SoundManager';
import { FakeEngine } from './testing/fakes';
import type { SoundDefinition } from './AudioTypes';

function setup(definitions: SoundDefinition[], now = () => 0) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine, definitions, now });
  return { engine, manager };
}

describe('definition ownership (manifest replacement)', () => {
  it('replaces only what the owner registered before', () => {
    const { manager } = setup([{ id: 'ui.click', channel: 'ui', url: 'test://c' }]);
    expect(
      manager.replaceDefinitions('manifest', [
        { id: 'sfx.a.one', channel: 'sfx', url: 'x' },
        { id: 'sfx.a.two', channel: 'sfx', url: 'x' },
      ]),
    ).toEqual([]);
    manager.replaceDefinitions('manifest', [{ id: 'sfx.a.three', channel: 'sfx', url: 'x' }]);
    expect([
      manager.has('sfx.a.one'),
      manager.has('sfx.a.two'),
      manager.has('sfx.a.three'),
    ]).toEqual([false, false, true]);
    expect(manager.has('ui.click')).toBe(true);
  });

  it('refuses an id held by the application or another owner, and applies the rest', () => {
    const { manager } = setup([{ id: 'sfx.mine.one', channel: 'sfx', url: 'x' }]);
    manager.replaceDefinitions('a', [{ id: 'sfx.a.one', channel: 'sfx', url: 'x' }]);
    const refused = manager.replaceDefinitions('b', [
      { id: 'sfx.mine.one', channel: 'sfx', url: 'y' },
      { id: 'sfx.a.one', channel: 'sfx', url: 'y' },
      { id: 'sfx.b.one', channel: 'sfx', url: 'y' },
    ]);
    expect(refused).toEqual(['sfx.mine.one', 'sfx.a.one']);
    expect(manager.has('sfx.b.one')).toBe(true);
  });

  it('refuses invalid definitions without registering them', () => {
    const { manager } = setup([]);
    const refused = manager.replaceDefinitions('m', [
      { id: 'sfx.ok.one', channel: 'sfx', url: 'x' },
      { id: 'sfx.bad.one', channel: 'sfx', url: 'x', maxConcurrent: 0 },
      { id: 'sfx.bad.two', channel: 'sfx', url: 'x', cooldownMs: -5 },
    ]);
    expect(refused).toEqual(['sfx.bad.one', 'sfx.bad.two']);
    expect(manager.has('sfx.ok.one')).toBe(true);
  });

  it('lets the application take over an id once the owner releases it', () => {
    const { manager } = setup([]);
    manager.replaceDefinitions('m', [{ id: 'sfx.a.one', channel: 'sfx', url: 'x' }]);
    manager.releaseDefinitions('m');
    expect(manager.has('sfx.a.one')).toBe(false);
    manager.register({ id: 'sfx.a.one', channel: 'sfx', url: 'app' });
    manager.releaseDefinitions('m');
    expect(manager.has('sfx.a.one')).toBe(true);
  });

  it('does nothing after the manager is disposed', () => {
    const { manager } = setup([]);
    manager.dispose();
    expect(
      manager.replaceDefinitions('m', [{ id: 'sfx.a.one', channel: 'sfx', url: 'x' }]),
    ).toEqual(['sfx.a.one']);
    expect(manager.has('sfx.a.one')).toBe(false);
  });
});

describe('asset resolver and diagnostics', () => {
  it('uses the resolver that is current when the sound plays, and none after it is removed', async () => {
    const { manager, engine } = setup([{ id: 'sfx.a.one', channel: 'sfx', assetId: 'a@1' }]);
    await expect(manager.play('sfx.a.one')).resolves.toBeNull();
    manager.setAssetResolver({ resolve: async (id) => ({ id, url: `signed://${id}` }) });
    await expect(manager.play('sfx.a.one')).resolves.not.toBeNull();
    expect(engine.loadLog.at(-1)?.url).toBe('signed://a@1');
    manager.setAssetResolver(undefined);
    await expect(manager.play('sfx.a.one')).resolves.toBeNull();
  });

  it('records outside problems in the same de-duplicated ring', () => {
    const { manager } = setup([]);
    const sink = vi.fn();
    manager.reportIssue('manifest-failed', 'x');
    manager.reportIssue('manifest-failed', 'x');
    expect(manager.getDiagnostics()).toMatchObject([{ code: 'manifest-failed', count: 2 }]);
    void sink;
  });
});

describe('cue playback settings', () => {
  it('ignores a play inside the cooldown and allows it after', async () => {
    let clock = 1000;
    const { manager, engine } = setup(
      [{ id: 'sfx.coin.collect', channel: 'sfx', url: 'x', cooldownMs: 200 }],
      () => clock,
    );
    expect(await manager.play('sfx.coin.collect')).not.toBeNull();
    clock = 1100;
    expect(await manager.play('sfx.coin.collect')).toBeNull();
    clock = 1200;
    expect(await manager.play('sfx.coin.collect')).not.toBeNull();
    expect(engine.voices).toHaveLength(2);
    expect(manager.getDiagnostics()).toEqual([]); // a cooldown is normal, not a problem
  });

  it('limits copies of one sound, counting plays that are still loading', async () => {
    const { manager, engine } = setup([
      { id: 'sfx.coin.collect', channel: 'sfx', url: 'x', maxConcurrent: 2 },
      { id: 'sfx.other.one', channel: 'sfx', url: 'x' },
    ]);
    engine.autoLoad = false;
    const first = manager.play('sfx.coin.collect');
    const second = manager.play('sfx.coin.collect');
    await Promise.resolve();
    await Promise.resolve();
    expect(await manager.play('sfx.coin.collect')).toBeNull(); // two are already loading
    engine.autoLoad = true;
    engine.loads.forEach((load) => load.resolve());
    const [a, b] = await Promise.all([first, second]);
    expect(a && b).toBeTruthy();
    expect(await manager.play('sfx.coin.collect')).toBeNull();
    expect(await manager.play('sfx.other.one')).not.toBeNull();
    a?.stop();
    expect(await manager.play('sfx.coin.collect')).not.toBeNull();
  });

  it('uses the cue fade-in unless the caller overrides it', async () => {
    const { manager, engine } = setup([
      { id: 'music.a.theme', channel: 'music', url: 'x', fadeInMs: 800 },
    ]);
    await manager.play('music.a.theme');
    await manager.play('music.a.theme', { fadeInMs: 100 });
    await manager.play('music.a.theme', { fadeInMs: 0 });
    expect(engine.voices.map((v) => v.options.fadeInMs)).toEqual([800, 100, 0]);
  });

  it('uses the cue fade-out for every way a sound can be stopped, unless overridden', async () => {
    const { manager, engine } = setup([
      { id: 'music.a.theme', channel: 'music', url: 'x', fadeOutMs: 600 },
    ]);
    const direct = await manager.play('music.a.theme');
    const overridden = await manager.play('music.a.theme');
    const byId = await manager.play('music.a.theme');
    const scope = manager.createScope('s');
    await scope.play('music.a.theme');
    direct?.stop();
    overridden?.stop({ fadeOutMs: 50 });
    expect(engine.voices.map((v) => v.stopFadeMs).slice(0, 2)).toEqual([600, 50]);
    manager.stop('music.a.theme');
    expect(byId?.state).toBe('ended');
    expect(engine.voices[2]?.stopFadeMs).toBe(600);
    scope.dispose();
    expect(engine.voices[3]?.stopFadeMs).toBe(600);
  });
});
