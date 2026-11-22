import { describe, expect, it } from 'vitest';
import { signalBoard } from './common';
import { validatePlatformsConfig } from './platforms';
import { registerGameplayComponents } from './registerGameplayComponents';
import { createHarness } from './testHarness';

/**
 * GE-069 (Treasure Rush, Pirate's Leap lift and ferry): engine moving platforms emit the live
 * platform system's PlatformActivated, PlatformMoving and PlatformStopped, with the platform's
 * own cues, so a host's platform sounds work for either runtime.
 */

const harness = () => createHarness(registerGameplayComponents);
const size = { x: 3, y: 0.4, z: 3 };
const SOUND_EVENTS = ['PlatformActivated', 'PlatformMoving', 'PlatformStopped'];

const lift = {
  id: 'leap-lift',
  position: { x: 0, y: 0, z: 0 },
  size,
  route: 'OPTIONAL',
  moving: {
    path: [{ x: 0, y: 3, z: 0 }],
    mode: 'ONCE',
    speed: 1,
    pauseSeconds: 0,
    activeSignalId: 'plate.lift',
  },
  sounds: { activated: 'sfx.lift.clunk', moving: 'sfx.lift.creak', stopped: 'sfx.lift.thud' },
};

const soundEvents = (h: ReturnType<typeof harness>) =>
  h.events.filter((e) => SOUND_EVENTS.includes(e.name)).map((e) => [e.name, e.payload]);

describe('engine moving platform sound events', () => {
  it('a signalled lift: activated when its signal turns on, moving, then stopped at the end, with its cues', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [lift] } }]);
    h.advance(1);
    expect(soundEvents(h)).toEqual([]); // waiting for the plate: silent
    signalBoard(h.runtime).set('plate.lift', true);
    h.advance(5); // 3 m at 1 m/s, then at rest at the top
    expect(soundEvents(h)).toEqual([
      ['PlatformActivated', { platformId: 'leap-lift', cue: 'sfx.lift.clunk' }],
      ['PlatformMoving', { platformId: 'leap-lift', cue: 'sfx.lift.creak' }],
      ['PlatformStopped', { platformId: 'leap-lift', cue: 'sfx.lift.thud' }],
    ]);
    h.dispose();
  });

  it('activates again each time its signal turns back on, and never repeats while it stays on', async () => {
    const h = harness();
    const platform = { ...lift, moving: { ...lift.moving, returnWhenInactive: true } };
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [platform] } }]);
    const board = signalBoard(h.runtime);
    board.set('plate.lift', true);
    h.advance(1);
    board.set('plate.lift', false);
    h.advance(5); // returns to the start: moving, then stopped
    board.set('plate.lift', true);
    h.advance(0.5);
    expect(h.eventsNamed('PlatformActivated')).toHaveLength(2);
    h.dispose();
  });

  it('an always-on ferry: activated once at start, and stopped and moving round each waypoint pause', async () => {
    const h = harness();
    const ferry = {
      id: 'leap-moving-dock',
      position: { x: 0, y: 0, z: 0 },
      size,
      route: 'OPTIONAL',
      moving: { path: [{ x: 4, y: 0, z: 0 }], mode: 'PING_PONG', speed: 2, pauseSeconds: 1 },
    };
    await h.start([{ id: 'gameplay.platforms', config: { platforms: [ferry] } }]);
    h.advance(2.5); // 2 s across, then into the 1 s pause at the far end
    const names = soundEvents(h).map(([name]) => name);
    expect(names[0]).toBe('PlatformActivated');
    expect(names).toContain('PlatformStopped');
    h.advance(1); // the pause ends: it moves again
    const all = soundEvents(h).map(([name]) => name);
    expect(all.filter((n) => n === 'PlatformActivated')).toHaveLength(1);
    expect(all.at(-1)).toBe('PlatformMoving');
    // No cues authored: the payload has none, so the host uses its defaults.
    expect(h.eventsNamed('PlatformMoving')[0]).toEqual({ platformId: 'leap-moving-dock' });
    h.dispose();
  });

  it('a static platform is silent', async () => {
    const h = harness();
    await h.start([
      {
        id: 'gameplay.platforms',
        config: { platforms: [{ id: 'step', position: { x: 0, y: 0, z: 0 }, size }] },
      },
    ]);
    h.advance(2);
    expect(soundEvents(h)).toEqual([]);
    h.dispose();
  });

  it('validates sound cues as semantic ids', () => {
    expect(validatePlatformsConfig({ platforms: [lift] }).ok).toBe(true);
    expect(
      validatePlatformsConfig({ platforms: [{ ...lift, sounds: { moving: 'has spaces' } }] }).ok,
    ).toBe(false);
    expect(validatePlatformsConfig({ platforms: [{ ...lift, sounds: 'sfx.lift' }] }).ok).toBe(
      false,
    );
  });
});
