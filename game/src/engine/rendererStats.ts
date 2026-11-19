/**
 * Renderer statistics as diagnostics gauges.
 *
 * Reads `renderer.info` (draw calls, triangles, geometries, textures) and writes it into the
 * runtime's `Diagnostics` as `renderer.*` gauges, which the React DebugOverlay shows. Takes
 * the structural subset of `WebGLRenderer` it needs, so tests pass a plain object.
 */

import type { Diagnostics } from '../core/diagnostics';

export interface RendererInfoLike {
  info: {
    render: { calls: number; triangles: number };
    memory: { geometries: number; textures: number };
  };
}

export interface RendererStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export const RENDERER_GAUGES = Object.freeze({
  drawCalls: 'renderer.drawCalls',
  triangles: 'renderer.triangles',
  geometries: 'renderer.geometries',
  textures: 'renderer.textures',
} as const);

export function readRendererStats(renderer: RendererInfoLike): RendererStats {
  const { render, memory } = renderer.info;
  return { drawCalls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures };
}

export interface RendererStatsCollector {
  /** Call after `renderer.render`; writes the gauges and returns what it read. */
  collect(): RendererStats;
}

export function createRendererStatsCollector(renderer: RendererInfoLike, diagnostics: Diagnostics): RendererStatsCollector {
  return {
    collect() {
      const stats = readRendererStats(renderer);
      if (diagnostics.enabled) {
        diagnostics.gauge(RENDERER_GAUGES.drawCalls, stats.drawCalls);
        diagnostics.gauge(RENDERER_GAUGES.triangles, stats.triangles);
        diagnostics.gauge(RENDERER_GAUGES.geometries, stats.geometries);
        diagnostics.gauge(RENDERER_GAUGES.textures, stats.textures);
      }
      return stats;
    },
  };
}
