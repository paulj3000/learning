/** The part of `WebGLRenderer.info` the diagnostics read; test doubles can supply it too. */
export interface RendererInfoLike {
  readonly render: { readonly calls: number; readonly triangles: number };
  readonly memory: { readonly geometries: number; readonly textures: number };
}

export interface RendererSnapshot {
  readonly calls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
}

function whole(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** A plain copy, so later renderer changes cannot alter a recorded snapshot. */
export function snapshotInfo(info: RendererInfoLike): RendererSnapshot {
  return {
    calls: whole(info.render?.calls),
    triangles: whole(info.render?.triangles),
    geometries: whole(info.memory?.geometries),
    textures: whole(info.memory?.textures),
  };
}
