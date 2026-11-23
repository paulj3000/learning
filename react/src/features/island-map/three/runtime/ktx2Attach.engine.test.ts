import { describe, expect, it, vi } from 'vitest';
import { mount } from './testing/engineHarness';

/**
 * The engine's KTX2 hook (ADR-070 review fix): the assets get the renderer before the first
 * model loads, give it back before the renderer is disposed, and a failing hook never stops
 * the place from running.
 */
describe('LocationEngine assets.attachRenderer', () => {
  it('attaches before the first model load and detaches before renderer.dispose', async () => {
    const order: string[] = [];
    const detach = vi.fn(() => order.push('detach'));
    const h = mount({
      attachRenderer: vi.fn(() => {
        order.push('attach');
        return detach;
      }),
      loadModel: async () => {
        order.push('load');
        const { BoxGeometry, Mesh, MeshBasicMaterial } = await import('three');
        return { scene: new Mesh(new BoxGeometry(), new MeshBasicMaterial()), animations: [] };
      },
    });
    h.runFrames(1);
    await Promise.resolve();
    expect(order[0]).toBe('attach');
    h.renderer.dispose.mockImplementation(() => order.push('renderer.dispose'));
    h.engine.dispose();
    expect(order.indexOf('detach')).toBeLessThan(order.indexOf('renderer.dispose'));
    expect(detach).toHaveBeenCalledTimes(1);
  });

  it('runs without KTX2 when attaching throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = mount({
      attachRenderer: () => {
        throw new Error('no workers');
      },
    });
    h.runFrames(2);
    expect(h.renderer.render).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'KTX2 texture support is unavailable; continuing without it',
      expect.any(Error),
    );
    h.engine.dispose();
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a failing detach still disposes the renderer', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = mount({
      attachRenderer: () => () => {
        throw new Error('already gone');
      },
    });
    h.engine.dispose();
    expect(h.renderer.dispose).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
