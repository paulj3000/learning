import { afterEach, describe, expect, it, vi } from 'vitest';
import { castleTaleExtension } from '../../extensions/castleTale/castleTaleScene';
import { mount, standAt, type Harness } from '../testing/engineHarness';
import { manifestForBand } from '../manifestForBand';
import { STORYBOOK_PATHWAY_GROUP, padPlatformId, padZoneId } from './castleRooms/castlePlatforms';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';

/**
 * The real runtime, the real `castle-tale` scene half and the real castle manifest with its
 * platforms: pads are there for Pathfinders and Explorers, only flat markers for Sprouts, a child
 * can jump onto one and stand in its answer zone, and the pathway starts hidden.
 */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

const named = (h: Harness, name: string) => h.events.filter((event) => event.name === name);

describe('castle platforms in the real engine', () => {
  it('builds the solid pads for Pathfinders and keeps the storybook pathway hidden until a page is back', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({
      manifest: manifestForBand(MANIFEST, 'PATHFINDER'),
      extensions: [castleTaleExtension],
    });
    harness.runFrames(2);
    const platforms = harness.engine.platforms();
    expect(platforms.length).toBe(MANIFEST.platforming!.platforms.length);
    expect(harness.scene().getObjectByName('platforming')).toBeDefined();
    for (const pad of STORYBOOK_PATHWAY_GROUP.pads) {
      const state = platforms.find(
        (candidate) => candidate.spec.id === padPlatformId('storybook-pathway', pad.key),
      );
      expect(state?.present, pad.key).toBe(false);
    }
    const stone = platforms.find(
      (candidate) => candidate.spec.id === padPlatformId('story-hall', 'choice'),
    );
    expect(stone?.present).toBe(true);
  });

  it('shows a page’s pathway pad at once when the view signals its recorded world change', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: MANIFEST, extensions: [castleTaleExtension] });
    harness.runFrames(2);
    const first = harness.engine
      .platforms()
      .find((candidate) => candidate.spec.id === padPlatformId('storybook-pathway', 'p1'))!;
    expect(first.present).toBe(false);
    harness.engine.signalPlatforms('world:FIRST_STORY_TOLD');
    harness.runFrames(3);
    expect(first.present).toBe(true);
  });

  it('gives Sprouts no solid platform at all, only flat markers', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({
      manifest: manifestForBand(MANIFEST, 'SPROUT'),
      extensions: [castleTaleExtension],
    });
    harness.runFrames(2);
    expect(harness.engine.platforms()).toEqual([]);
    const root = harness.scene().getObjectByName('platforming');
    expect(root).toBeDefined();
    expect(root?.getObjectByName('pressure-plate:castle-marker:story-hall:problem')).toBeDefined();
  });

  it('lets a child jump onto a story stone and stand in its answer zone, and walk off it unharmed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: MANIFEST, extensions: [castleTaleExtension] });
    const stone = MANIFEST.platforming!.platforms.find(
      (p) => p.id === padPlatformId('story-hall', 'ending'),
    )!;
    // Two metres south of the stone, facing it (north is yaw 0), then jump and walk forward.
    harness.setDrive(standAt(stone.position.x, stone.position.z - 2, 0));
    harness.runFrames(2);
    let jumped = false;
    harness.setDrive((controller, delta) => {
      if (!jumped) {
        controller.pressJump();
        jumped = true;
      }
      controller.update(delta, { forward: 1, strafe: 0 });
    });
    harness.runFrames(60);
    harness.setDrive((controller, delta) => controller.update(delta, { forward: 0, strafe: 0 }));
    harness.runFrames(60);
    const at = harness.engine.childPlacement();
    expect(Math.abs(at.x - stone.position.x)).toBeLessThan(stone.size.width / 2 + 0.6);
    expect(named(harness, 'PlayerJumped').length).toBeGreaterThan(0);
    // The ground-plane answer zone is what the session listens to, whatever the child's height.
    const entered = named(harness, 'PlayerEnteredZone').map(
      (event) => (event.detail as { zoneId: string }).zoneId,
    );
    expect(entered).toContain(padZoneId('story-hall', 'ending'));
    // A missed or finished jump never costs anything: no recovery was needed.
    expect(named(harness, 'PlayerRecovered')).toEqual([]);
  });
});
