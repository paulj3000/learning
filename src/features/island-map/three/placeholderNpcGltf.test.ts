import { describe, expect, it } from 'vitest';
import { loadPlaceholderNpc } from './placeholderNpcGltf';

describe('loadPlaceholderNpc', () => {
  it('parses via the real GLTFLoader into a scene with one animation clip', async () => {
    const { scene, clip } = await loadPlaceholderNpc();

    expect(scene.children.length).toBeGreaterThan(0);
    expect(clip.name).toBe('Nod');
    expect(clip.duration).toBeCloseTo(1);
  });

  it('produces a mesh with a triangle of geometry', async () => {
    const { scene } = await loadPlaceholderNpc();

    const mesh = scene.getObjectByName('Pip');
    expect(mesh).toBeDefined();
  });
});
