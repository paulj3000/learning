import { describe, expect, it, vi } from 'vitest';
import type { EffectSpec } from '../locationManifest';
import { createMoteField, moteCountFor, moteHomes } from './motes';

const EFFECT: EffectSpec = {
  kind: 'MOTES',
  id: 'dust',
  area: { id: 'dust:area', minX: 0, maxX: 4, minZ: 0, maxZ: 2 },
  minY: 0.5,
  maxY: 2.5,
  color: 0xffe6a8,
  count: 60,
  seed: 3,
};

describe('motes', () => {
  it('caps the count by tier, with none at LOW', () => {
    expect(moteCountFor(EFFECT, 'LOW')).toBe(0);
    expect(moteCountFor(EFFECT, 'MEDIUM')).toBe(40);
    expect(moteCountFor(EFFECT, 'HIGH')).toBe(60);
    expect(createMoteField(EFFECT, 'LOW')).toBeNull();
  });

  it('scatters homes inside the volume, the same way every time', () => {
    const { homes } = moteHomes(EFFECT, 40);
    expect(moteHomes(EFFECT, 40).homes).toEqual(homes);
    for (let i = 0; i < 40; i += 1) {
      expect(homes[i * 3]).toBeGreaterThanOrEqual(0);
      expect(homes[i * 3]).toBeLessThanOrEqual(4);
      expect(homes[i * 3 + 1]).toBeGreaterThanOrEqual(0.5);
      expect(homes[i * 3 + 1]).toBeLessThanOrEqual(2.5);
      expect(homes[i * 3 + 2]).toBeGreaterThanOrEqual(0);
      expect(homes[i * 3 + 2]).toBeLessThanOrEqual(2);
    }
  });

  it('drifts as a pure function of time and stays near home', () => {
    const field = createMoteField(EFFECT, 'MEDIUM');
    if (!field) throw new Error('expected motes at MEDIUM');
    const positions = () =>
      Array.from(field.points.geometry.getAttribute('position').array as Float32Array);
    field.setTime(1);
    const atOne = positions();
    field.setTime(5);
    expect(positions()).not.toEqual(atOne);
    field.setTime(1);
    expect(positions()).toEqual(atOne);
    const { homes } = moteHomes(EFFECT, 40);
    atOne.forEach((value, index) => expect(Math.abs(value - homes[index])).toBeLessThan(0.2));
  });

  it('releases its geometry and material', () => {
    const field = createMoteField(EFFECT, 'HIGH');
    if (!field) throw new Error('expected motes at HIGH');
    const geometry = vi.spyOn(field.points.geometry, 'dispose');
    const material = vi.spyOn(field.points.material as { dispose(): void }, 'dispose');
    field.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
  });
});
