import { describe, expect, it } from 'vitest';
import {
  chooseRenderQuality,
  deviceHintsFromNavigator,
  pixelRatioFor,
  RENDER_QUALITY_PRESETS,
  selectLightsForQuality,
} from './renderQuality';

describe('chooseRenderQuality', () => {
  it('defaults to MEDIUM, the tablet default, when the device says nothing', () => {
    expect(chooseRenderQuality()).toBe('MEDIUM');
    expect(chooseRenderQuality({})).toBe('MEDIUM');
  });

  it('drops to LOW on a small device by cores or by memory', () => {
    expect(chooseRenderQuality({ hardwareConcurrency: 4 })).toBe('LOW');
    expect(chooseRenderQuality({ hardwareConcurrency: 8, deviceMemory: 4 })).toBe('LOW');
    expect(chooseRenderQuality({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe('MEDIUM');
  });

  it('never picks HIGH on its own, but honours an explicit override', () => {
    expect(chooseRenderQuality({ hardwareConcurrency: 64, deviceMemory: 64 })).toBe('MEDIUM');
    expect(chooseRenderQuality({ hardwareConcurrency: 2, override: 'HIGH' })).toBe('HIGH');
  });
});

describe('deviceHintsFromNavigator', () => {
  it('reads the hints a browser exposes and ignores nonsense', () => {
    expect(deviceHintsFromNavigator({ hardwareConcurrency: 6 })).toEqual({
      hardwareConcurrency: 6,
      deviceMemory: undefined,
    });
    expect(
      deviceHintsFromNavigator({ hardwareConcurrency: 0, deviceMemory: 'lots' } as never),
    ).toEqual({ hardwareConcurrency: undefined, deviceMemory: undefined });
    expect(deviceHintsFromNavigator({})).toEqual({
      hardwareConcurrency: undefined,
      deviceMemory: undefined,
    });
  });
});

describe('selectLightsForQuality', () => {
  const lights = Array.from({ length: 20 }, (_, index) => ({
    id: `light-${index}`,
    priority: index === 19 ? 5 : index % 3 === 0 ? 1 : 0,
  }));

  it('keeps every light when the tier can afford them', () => {
    expect(selectLightsForQuality(lights, 'HIGH')).toHaveLength(20);
  });

  it('keeps the highest-priority lights, in authored order, at a lower tier', () => {
    const low = selectLightsForQuality(lights, 'LOW');
    expect(low).toHaveLength(RENDER_QUALITY_PRESETS.LOW.maxPlacedLights);
    expect(low.map((light) => light.id)).toContain('light-19');
    const indices = low.map((light) => Number(light.id.split('-')[1]));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    // Every priority-1 light (0, 3, 6, ... 18: seven of them) outranks the priority-0 ones.
    expect(low.filter((light) => light.priority === 1)).toHaveLength(7);
  });

  it('is deterministic', () => {
    expect(selectLightsForQuality(lights, 'MEDIUM')).toEqual(
      selectLightsForQuality(lights, 'MEDIUM'),
    );
  });
});

describe('pixelRatioFor', () => {
  it('caps the device ratio by tier and never goes below 1', () => {
    expect(pixelRatioFor(3, 'LOW')).toBe(1);
    expect(pixelRatioFor(3, 'MEDIUM')).toBe(1.5);
    expect(pixelRatioFor(1.25, 'HIGH')).toBe(1.25);
    expect(pixelRatioFor(0.5, 'HIGH')).toBe(1);
    expect(pixelRatioFor(undefined, 'MEDIUM')).toBe(1);
    expect(pixelRatioFor(Number.NaN, 'MEDIUM')).toBe(1);
  });
});
