import { describe, expect, it } from 'vitest';
import { AGE_BAND_LABELS, type AgeBandValue } from '../../child-profile/constants';
import {
  CASTLE_CEILING_UNDERSIDE,
  CASTLE_ENGINE_PROFILE,
  CASTLE_MOVEMENT_BY_BAND,
  CASTLE_PAD_DWELL_MS,
  CASTLE_PLATFORM_TOP_CAP,
  castleMovementSpec,
} from './castleEngineProfile';
import { PAD_DWELL_MS } from './extensions/castleTale/usePadAnswers';
import { resolveJumpConfiguration } from '@lai/game-engine/movement';
import { resolvePlayerCamera } from '@lai/game-engine/camera';
import { EYE_HEIGHT } from './sceneKit';
import { manifestForBand } from './runtime/manifestForBand';
import { CASTLE_MAX_PLATFORM_TOP } from './runtime/manifests/castleRooms/castlePlatforms';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './runtime/manifests/storykeeperCastle';
import { solidColliders } from './runtime/sceneLayout';

const BANDS = Object.keys(AGE_BAND_LABELS) as AgeBandValue[];

describe('castle engine profile (SC-JMP-01)', () => {
  it('is the one source of the movement and camera the manifest hands the shared engine', () => {
    expect(MANIFEST.movement).toEqual(castleMovementSpec());
    expect(MANIFEST.player?.camera).toEqual(CASTLE_ENGINE_PROFILE.camera);
  });

  it('stays inside the shared controller and camera limits, so nothing is clamped', () => {
    const jump = resolveJumpConfiguration(MANIFEST.movement?.jump);
    expect(jump.jumpHeight).toBe(CASTLE_ENGINE_PROFILE.movement.jump.jumpHeight);
    expect(jump.allowDoubleJump).toBe(false);
    const camera = resolvePlayerCamera(MANIFEST.player?.camera);
    for (const key of [
      'distance',
      'minDistance',
      'maxDistance',
      'heightOffset',
      'maxHeight',
    ] as const) {
      expect(camera[key], key).toBe(CASTLE_ENGINE_PROFILE.camera[key]);
    }
  });

  it('keeps the eye under the ceiling even jumping from the highest pad, and the camera under it too', () => {
    const highestEye =
      CASTLE_PLATFORM_TOP_CAP + CASTLE_ENGINE_PROFILE.movement.jump.jumpHeight + EYE_HEIGHT;
    expect(highestEye).toBeLessThan(CASTLE_CEILING_UNDERSIDE);
    expect(CASTLE_ENGINE_PROFILE.camera.maxHeight).toBeLessThan(CASTLE_CEILING_UNDERSIDE);
    expect(CASTLE_PLATFORM_TOP_CAP).toBe(CASTLE_MAX_PLATFORM_TOP);
  });

  it('has no jumpable wall, door or gate: only platforms can be stood on', () => {
    expect(CASTLE_ENGINE_PROFILE.wallsJumpable).toBe(false);
    expect(solidColliders(MANIFEST).filter((collider) => collider.jumpable)).toEqual([]);
    expect(MANIFEST.colliders.filter((collider) => collider.jumpable)).toEqual([]);
  });

  it('records recovery as position-only shared behaviour', () => {
    expect(CASTLE_ENGINE_PROFILE.recovery).toEqual([
      'LAST_SAFE_GROUND',
      'SAVED_CHECKPOINT_ON_ENTRY',
    ]);
  });
});

describe('castle movement by age band (SC-JMP-18)', () => {
  it('covers every age band', () => {
    expect(Object.keys(CASTLE_MOVEMENT_BY_BAND).sort()).toEqual([...BANDS].sort());
  });

  it.each(BANDS)('%s: says what the band manifest actually builds', (band) => {
    const rule = CASTLE_MOVEMENT_BY_BAND[band];
    const platforming = manifestForBand(MANIFEST, band).platforming;
    const platforms = platforming?.platforms ?? [];
    const plates = platforming?.pressurePlates ?? [];
    if (rule.platforms === 'flat-markers') {
      expect(platforms, band).toEqual([]);
      expect(plates.length, band).toBeGreaterThan(0);
    } else {
      expect(platforms.length, band).toBeGreaterThan(0);
    }
    const highest = Math.max(
      0,
      ...platforms.map((platform) => platform.position.y + platform.size.height),
    );
    expect(highest, band).toBeLessThanOrEqual(rule.highestSurface + 1e-9);
  });

  it.each(BANDS)(
    '%s: no hazard, timer, moving, vanishing, bouncing or spinning surface',
    (band) => {
      expect(CASTLE_MOVEMENT_BY_BAND[band].hazardsOrTimers).toBe(false);
      const platforming = manifestForBand(MANIFEST, band).platforming;
      expect(platforming?.hazards ?? [], band).toEqual([]);
      for (const platform of platforming?.platforms ?? []) {
        expect(platform.motion, platform.id).toBeUndefined();
        expect(platform.vanish, platform.id).toBeUndefined();
        expect(platform.bounce, platform.id).toBeUndefined();
        expect(platform.spin, platform.id).toBeUndefined();
      }
    },
  );

  it.each(BANDS)(
    '%s: never needs a jump for learning, and offers aiming only where there is a reticle',
    (band) => {
      const rule = CASTLE_MOVEMENT_BY_BAND[band];
      expect(rule.jumpRequiredForLearning).toBe(false);
      expect(rule.equivalentRoutes).toContain('hud-card');
      const hasReticle = !(MANIFEST.noReticleBands ?? []).includes(band);
      expect(rule.equivalentRoutes.includes('aim'), band).toBe(hasReticle);
    },
  );

  it('uses the pad dwell the pad hook uses', () => {
    expect(CASTLE_PAD_DWELL_MS).toBe(PAD_DWELL_MS);
    for (const band of BANDS) expect(CASTLE_MOVEMENT_BY_BAND[band].padDwellMs).toBe(PAD_DWELL_MS);
  });
});
