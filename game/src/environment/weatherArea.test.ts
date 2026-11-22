import { describe, expect, it } from 'vitest';
import { DEFAULT_WEATHER_AREA, validateWeatherConfig } from './weather';

describe('weather area (GE-L14)', () => {
  it('is optional, keeping the fixed box at the start', () => {
    const result = validateWeatherConfig({ initial: 'SNOW' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.area).toBeUndefined();
    expect(DEFAULT_WEATHER_AREA).toEqual({ mode: 'AT_START', halfX: 25, halfZ: 25, height: 15 });
  });

  it('accepts FOLLOW_PLAYER with bounded sizes, defaulting missing ones', () => {
    const result = validateWeatherConfig({
      initial: 'SNOW',
      area: { mode: 'FOLLOW_PLAYER', halfX: 20 },
    });
    expect(result.ok && result.value.area).toEqual({
      mode: 'FOLLOW_PLAYER',
      halfX: 20,
      halfZ: 25,
      height: 15,
    });
    expect(validateWeatherConfig({ area: { mode: 'EVERYWHERE' } }).ok).toBe(false);
    expect(validateWeatherConfig({ area: { halfX: 1 } }).ok).toBe(false);
    expect(validateWeatherConfig({ area: { height: 100 } }).ok).toBe(false);
    expect(validateWeatherConfig({ area: 'FOLLOW_PLAYER' }).ok).toBe(false);
  });
});
