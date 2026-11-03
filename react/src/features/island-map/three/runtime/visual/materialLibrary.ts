import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import type { MaterialPresetSpec } from '../locationManifest';
import { RENDER_QUALITY_PRESETS, type RenderQuality } from './renderQuality';
import { defaultAccent, paintSurfacePattern } from './surfacePatterns';

/**
 * The scene's material presets, made on first use and shared by every
 * surface that names them: one `MeshStandardMaterial` and at most one
 * texture per preset, however many rooms use it. The library owns both and
 * `dispose()` releases both, which the engine calls on unmount.
 *
 * Fallbacks never throw into the scene: an unknown preset id gets a neutral
 * flat material (validation reports the id in tests), and a preset whose
 * texture cannot be painted at this tier gets its own flat base colour.
 */
export interface MaterialLibrary {
  /** The shared material for `presetId`. Always returns a usable material. */
  get(presetId: string): MeshStandardMaterial;
  /** The preset's spec, if the manifest declares one. */
  spec(presetId: string): MaterialPresetSpec | undefined;
  /** What has been created so far, for budgets and disposal tests. */
  stats(): { materials: number; textures: number; fallbacks: number };
  dispose(): void;
}

export const UNKNOWN_PRESET_COLOR = 0x9a9a9a;
const DEFAULT_ROUGHNESS = 0.85;
const DEFAULT_METALNESS = 0.05;

export interface MaterialLibraryOptions {
  quality: RenderQuality;
  /** Replaces the painter, so a test can force a failure. */
  paint?: typeof paintSurfacePattern;
}

export function createMaterialLibrary(
  presets: readonly MaterialPresetSpec[],
  options: MaterialLibraryOptions,
): MaterialLibrary {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const materials = new Map<string, MeshStandardMaterial>();
  const textures: DataTexture[] = [];
  let fallbacks = 0;
  let disposed = false;
  const paint = options.paint ?? paintSurfacePattern;
  const textureSize = RENDER_QUALITY_PRESETS[options.quality].textureSize;

  function patternTexture(preset: MaterialPresetSpec): DataTexture | null {
    if (preset.pattern === 'PLAIN' || textureSize === 0) return null;
    try {
      const pixels = paint(
        preset.pattern,
        textureSize,
        { base: preset.baseColor, accent: preset.accentColor ?? defaultAccent(preset.baseColor) },
        preset.seed ?? 1,
      );
      const texture = new DataTexture(
        pixels,
        textureSize,
        textureSize,
        RGBAFormat,
        UnsignedByteType,
      );
      texture.name = `surface:${preset.id}`;
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.colorSpace = SRGBColorSpace;
      texture.magFilter = LinearFilter;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      textures.push(texture);
      return texture;
    } catch {
      fallbacks += 1;
      return null;
    }
  }

  function create(presetId: string): MeshStandardMaterial {
    const preset = byId.get(presetId);
    if (!preset) {
      fallbacks += 1;
      const unknown = new MeshStandardMaterial({
        color: UNKNOWN_PRESET_COLOR,
        roughness: DEFAULT_ROUGHNESS,
      });
      unknown.name = `material:${presetId}:unknown`;
      return unknown;
    }
    const map = patternTexture(preset);
    const material = new MeshStandardMaterial({
      // A painted texture already carries the colour; tinting it again would darken it.
      color: map ? 0xffffff : preset.baseColor,
      map,
      roughness: preset.roughness ?? DEFAULT_ROUGHNESS,
      metalness: preset.metalness ?? DEFAULT_METALNESS,
      emissive: preset.emissive ?? 0x000000,
      emissiveIntensity: preset.emissive === undefined ? 0 : (preset.emissiveIntensity ?? 1),
    });
    material.name = `material:${preset.id}`;
    return material;
  }

  return {
    get(presetId) {
      if (disposed) throw new Error('material library used after dispose');
      let material = materials.get(presetId);
      if (!material) {
        material = create(presetId);
        materials.set(presetId, material);
      }
      return material;
    },
    spec: (presetId) => byId.get(presetId),
    stats: () => ({ materials: materials.size, textures: textures.length, fallbacks }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const texture of textures) texture.dispose();
      for (const material of materials.values()) material.dispose();
      textures.length = 0;
      materials.clear();
    },
  };
}
