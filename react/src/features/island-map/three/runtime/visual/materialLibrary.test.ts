import { describe, expect, it, vi } from 'vitest';
import { DataTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { MaterialPresetSpec } from '../locationManifest';
import { createMaterialLibrary, UNKNOWN_PRESET_COLOR } from './materialLibrary';

const PRESETS: MaterialPresetSpec[] = [
  { id: 'flagstone', pattern: 'FLAGSTONE', baseColor: 0xb59a7a, metersPerRepeat: 2 },
  {
    id: 'glow',
    pattern: 'PLAIN',
    baseColor: 0x223344,
    emissive: 0xffd27a,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    metersPerRepeat: 1,
  },
];

describe('createMaterialLibrary', () => {
  it('shares one material and one texture per preset', () => {
    const library = createMaterialLibrary(PRESETS, { quality: 'MEDIUM' });
    const first = library.get('flagstone');
    expect(library.get('flagstone')).toBe(first);
    expect(library.stats()).toEqual({ materials: 1, textures: 1, fallbacks: 0 });
  });

  it('paints a repeating sRGB texture sized by the tier, white-tinted so it keeps its colour', () => {
    for (const [quality, size] of [
      ['LOW', 64],
      ['MEDIUM', 128],
      ['HIGH', 256],
    ] as const) {
      const material = createMaterialLibrary(PRESETS, { quality }).get('flagstone');
      const map = material.map as DataTexture;
      expect(map).toBeInstanceOf(DataTexture);
      expect(map.image.width).toBe(size);
      expect(map.wrapS).toBe(RepeatWrapping);
      expect(map.wrapT).toBe(RepeatWrapping);
      expect(map.colorSpace).toBe(SRGBColorSpace);
      expect(material.color.getHex()).toBe(0xffffff);
    }
  });

  it('uses a plain preset as flat colour with its emissive', () => {
    const material = createMaterialLibrary(PRESETS, { quality: 'MEDIUM' }).get('glow');
    expect(material.map).toBeNull();
    expect(material.color.getHexString()).toBe('223344');
    expect(material.emissive.getHexString()).toBe('ffd27a');
    expect(material.emissiveIntensity).toBe(0.6);
    expect(material.roughness).toBe(0.4);
  });

  it('falls back to flat colour when the texture cannot be painted', () => {
    const library = createMaterialLibrary(PRESETS, {
      quality: 'MEDIUM',
      paint: () => {
        throw new Error('no texture for you');
      },
    });
    const material = library.get('flagstone');
    expect(material.map).toBeNull();
    expect(material.color.getHexString()).toBe('b59a7a');
    expect(library.stats().fallbacks).toBe(1);
  });

  it('gives an unknown preset a neutral flat material instead of throwing', () => {
    const library = createMaterialLibrary(PRESETS, { quality: 'MEDIUM' });
    const material = library.get('nope');
    expect(material.color.getHex()).toBe(UNKNOWN_PRESET_COLOR);
    expect(library.stats().fallbacks).toBe(1);
  });

  it('disposes every material and texture once, and refuses use afterwards', () => {
    const library = createMaterialLibrary(PRESETS, { quality: 'MEDIUM' });
    const flagstone = library.get('flagstone');
    const glow = library.get('glow');
    const texture = flagstone.map as DataTexture;
    const spies = [
      vi.spyOn(flagstone, 'dispose'),
      vi.spyOn(glow, 'dispose'),
      vi.spyOn(texture, 'dispose'),
    ];
    library.dispose();
    library.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(() => library.get('flagstone')).toThrow(/after dispose/);
  });
});
