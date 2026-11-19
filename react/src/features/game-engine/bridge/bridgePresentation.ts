import { Box3, BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry, Vector3, type Material, type Object3D, type Scene } from 'three';
import {
  LightingService,
  ParticlesService,
  PlatformsService,
  WeatherService,
  createLightingView,
  createParticleView,
  createWeatherView,
  onPresentation,
  type EngineRuntime,
  type EventMap,
  type PlatformSpec,
  type QualityTier,
  type TelegraphedHazardSpec,
  type LightingView,
  type ParticleView,
  type WeatherView,
} from '@lai/game-engine';

/**
 * GE-066: the bridge's default Three.js presentation, drawn only when the host exposes a scene.
 *
 * - engine platforms: one box mesh per platform following the platform's current position, with
 *   the crumble warning (a blink, or a steady dim under reduced motion), hidden while GONE or not
 *   present (switched off, not yet appeared);
 * - telegraphed hazards: a flat ground rectangle over the impact area that fills over the warning
 *   (steady and full under reduced motion), plus the falling object during ACTIVE;
 * - weather, lighting and particles through the engine's `environment/presentation` views, when
 *   those capabilities are installed.
 *
 * Every geometry, material, mesh and view is tracked in `runtime.resources`, so disposing the
 * runtime removes every object this module added to the scene.
 */

const GROUND_LIFT = 0.03;
const ROCK_START_HEIGHT = 6;
const ROCK_RADIUS = 0.45;
/** GE-L14: a terrain telegraph has a vertex about every metre, at most 16 by 16 cells. */
const TELEGRAPH_SEGMENT_METRES = 1;
const MAX_TELEGRAPH_SEGMENTS = 16;

type GroundSampler = (x: number, z: number) => number | null;

/** The host's ground query, with non-finite answers treated as unknown; null without one. */
function groundSampler(source: ((x: number, z: number) => number | null) | undefined): GroundSampler | null {
  if (!source) return null;
  return (x, z) => {
    const y = source(x, z);
    return typeof y === 'number' && Number.isFinite(y) ? y : null;
  };
}

/**
 * GE-L14: sets each vertex of a horizontal plane (centred on cx, cz, drawn at x/z `scale`) to the
 * ground under where it will be drawn, plus `lift`. Unknown ground is y 0, the flat fallback.
 */
function drape(plane: PlaneGeometry, cx: number, cz: number, scale: number, ground: GroundSampler, lift: number): void {
  const positions = plane.getAttribute('position');
  for (let i = 0; i < positions.count; i += 1) {
    const x = cx + positions.getX(i) * scale;
    const z = cz + positions.getZ(i) * scale;
    positions.setY(i, (ground(x, z) ?? 0) + lift);
  }
  positions.needsUpdate = true;
  plane.computeBoundingBox();
  plane.computeBoundingSphere();
}
const BLINK_HERTZ = 3;
const DIM_OPACITY = 0.5;

export interface BridgePresentationOptions {
  reducedMotion: () => boolean;
  /** Where weather falls: defaults to a box around `center`. */
  center: { x: number; z: number };
  /** GE-L14: the device's weather tier (from the host render quality); wins over the seed's particle tier. */
  tier?: QualityTier;
  /** GE-L14: the child's position now, for weather with `area.mode` FOLLOW_PLAYER. */
  playerPosition?: () => { x: number; z: number };
  /** GE-068: loads an asset model for a platform with `assetId`. Absent: platforms stay coloured boxes. */
  loadModel?: (assetId: string) => Promise<{ scene: Object3D }>;
  /** GE-L14: ground height for terrain-following hazard telegraphs. Absent or null: flat at y 0. */
  groundHeightAt?: (x: number, z: number) => number | null;
}

export interface BridgePresentation {
  /** Once per rendered frame, after `runtime.tick`. */
  update(dt: number): void;
}

interface PlatformView {
  spec: PlatformSpec;
  mesh: Mesh;
  material: MeshStandardMaterial;
  /** GE-068: the loaded model's own materials (cloned), which follow the crumble blink. */
  modelMaterials: Material[];
}

const DEFAULT_PLATFORM_COLOR = 0xc9a46a;

interface HazardView {
  spec: TelegraphedHazardSpec;
  outline: Mesh;
  fill: Mesh;
  rock: Mesh;
  phase: 'WARN' | 'ACTIVE' | 'REST';
  /** Seconds left in the warning, or elapsed in ACTIVE. */
  clock: number;
  /** GE-L14: ground height at the centre (0 when flat), where the object lands. */
  groundY: number;
  /** GE-L14: re-drapes the shrinking fill over the ground at its scale; null when flat. */
  drapeFill: ((scale: number) => void) | null;
}

/**
 * Clones a loaded model, scales it to fill `size` (the platform box) and centres it on the box.
 * Materials are cloned so the crumble blink never touches the shared, cached asset; geometry is
 * the cache's and is not disposed here. Null when the model has no measurable size.
 */
function fitModel(source: Object3D, size: { x: number; y: number; z: number }, scope: EngineRuntime<EventMap>['resources'], materials: Material[]): Group | null {
  const clone = source.clone(true);
  const box = new Box3().setFromObject(clone);
  const extent = box.getSize(new Vector3());
  if (!(extent.x > 1e-6 && extent.y > 1e-6 && extent.z > 1e-6)) {
    return null;
  }
  const centre = box.getCenter(new Vector3());
  clone.position.sub(centre);
  const group = new Group();
  group.name = 'engine.platform.model';
  group.add(clone);
  group.scale.set(size.x / extent.x, size.y / extent.y, size.z / extent.z);
  clone.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => {
          const copy = scope.track(m.clone());
          materials.push(copy);
          return copy;
        })
      : (() => {
          const copy = scope.track(mesh.material.clone());
          materials.push(copy);
          return copy;
        })();
  });
  return group;
}

export function mountBridgePresentation(runtime: EngineRuntime<EventMap>, scene: Scene, options: BridgePresentationOptions): BridgePresentation {
  const scope = runtime.resources;
  let elapsed = 0;

  const addMesh = (mesh: Mesh): Mesh => {
    scene.add(mesh);
    scope.track(() => {
      scene.remove(mesh);
    });
    return mesh;
  };

  // --- platforms ---
  const platforms: PlatformView[] = [];
  const platformsApi = runtime.services.get(PlatformsService);
  const platformSpecs = runtime.capabilityConfig<{ platforms?: PlatformSpec[] }>('gameplay.platforms')?.platforms ?? [];
  if (platformsApi) {
    for (const spec of platformSpecs) {
      const geometry = scope.track(new BoxGeometry(spec.size.x, spec.size.y, spec.size.z));
      const material = scope.track(new MeshStandardMaterial({ color: spec.color ?? DEFAULT_PLATFORM_COLOR, transparent: true, opacity: 1 }));
      const mesh = addMesh(new Mesh(geometry, material));
      mesh.name = `engine.platform.${spec.id}`;
      mesh.visible = false;
      const view: PlatformView = { spec, mesh, material, modelMaterials: [] };
      platforms.push(view);
      if (spec.assetId !== undefined && options.loadModel) {
        // The coloured box shows while the model loads and stays if it fails (or the bridge is gone).
        let alive = true;
        scope.track(() => {
          alive = false;
        });
        const assetId = spec.assetId;
        void options.loadModel(assetId).then(
          (loaded) => {
            if (!alive) {
              return;
            }
            const model = fitModel(loaded.scene, spec.size, scope, view.modelMaterials);
            if (model) {
              mesh.add(model);
              material.visible = false;
            }
          },
          () => {
            runtime.diagnostics.warn('PLATFORM_ASSET_FAILED', { id: spec.id, assetId });
          },
        );
      }
    }
  }

  // --- hazard telegraphs ---
  const hazards = new Map<string, HazardView>();
  const hazardSpecs = runtime.capabilityConfig<{ telegraphed?: TelegraphedHazardSpec[] }>('gameplay.hazards')?.telegraphed ?? [];
  for (const spec of hazardSpecs) {
    const width = spec.rect.maxX - spec.rect.minX;
    const depth = spec.rect.maxZ - spec.rect.minZ;
    const cx = (spec.rect.minX + spec.rect.maxX) / 2;
    const cz = (spec.rect.minZ + spec.rect.maxZ) / 2;
    const terrain = groundSampler(options.groundHeightAt);
    const segX = terrain ? Math.min(MAX_TELEGRAPH_SEGMENTS, Math.max(1, Math.ceil(width / TELEGRAPH_SEGMENT_METRES))) : 1;
    const segZ = terrain ? Math.min(MAX_TELEGRAPH_SEGMENTS, Math.max(1, Math.ceil(depth / TELEGRAPH_SEGMENT_METRES))) : 1;
    const plane = scope.track(new PlaneGeometry(width, depth, segX, segZ));
    plane.rotateX(-Math.PI / 2);
    // The fill shrinks in x and z during the warning, so it needs its own vertices to re-drape.
    const fillPlane = terrain ? scope.track(plane.clone()) : plane;
    if (terrain) {
      drape(plane, cx, cz, 1, terrain, GROUND_LIFT);
      drape(fillPlane, cx, cz, 1, terrain, GROUND_LIFT + 0.005);
    }
    const outlineMaterial = scope.track(new MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false }));
    const fillMaterial = scope.track(new MeshBasicMaterial({ color: 0xe76f51, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }));
    const rockMaterial = scope.track(new MeshStandardMaterial({ color: 0x7a6a5a }));
    const outline = addMesh(new Mesh(plane, outlineMaterial));
    const fill = addMesh(new Mesh(fillPlane, fillMaterial));
    const rock = addMesh(new Mesh(scope.track(new SphereGeometry(ROCK_RADIUS, 12, 8)), rockMaterial));
    outline.name = `engine.hazard.${spec.id}.outline`;
    fill.name = `engine.hazard.${spec.id}.fill`;
    rock.name = `engine.hazard.${spec.id}.object`;
    // Flat fallback (no ground query): the planes sit at the lift, exactly as before GE-L14.
    // On terrain the lift is in each vertex, so the meshes sit at y 0.
    outline.position.set(cx, terrain ? 0 : GROUND_LIFT, cz);
    fill.position.set(cx, terrain ? 0 : GROUND_LIFT + 0.005, cz);
    const groundY = terrain ? (terrain(cx, cz) ?? 0) : 0;
    rock.position.set(cx, groundY + ROCK_START_HEIGHT, cz);
    outline.visible = fill.visible = rock.visible = false;
    let drapedAt = 1;
    const drapeFill = terrain
      ? (scale: number) => {
          if (Math.abs(scale - drapedAt) < 1e-3) return;
          drapedAt = scale;
          drape(fillPlane, cx, cz, scale, terrain, GROUND_LIFT + 0.005);
        }
      : null;
    hazards.set(spec.id, { spec, outline, fill, rock, phase: 'REST', clock: 0, groundY, drapeFill });
  }
  if (hazards.size > 0) {
    scope.track(
      onPresentation(runtime, 'HazardTelegraph', ({ hazardId, phase, secondsToImpact }) => {
        const view = hazards.get(hazardId);
        if (!view) {
          return;
        }
        view.phase = phase;
        view.clock = phase === 'WARN' ? secondsToImpact : 0;
      }),
    );
  }

  // --- atmosphere ---
  const lighting = runtime.services.get(LightingService);
  const weather = runtime.services.get(WeatherService);
  const particles = runtime.services.get(ParticlesService);
  let lightingView: LightingView | null = null;
  let weatherView: WeatherView | null = null;
  const particleViews: { view: ParticleView; handle: ReturnType<NonNullable<typeof particles>['emitters']>[number] }[] = [];
  if (lighting) {
    lightingView = createLightingView(scene, scope, lighting);
  }
  if (weather) {
    const tier: QualityTier = options.tier ?? particles?.tier() ?? 'MEDIUM';
    const area = weather.area();
    const follow = area.mode === 'FOLLOW_PLAYER' ? options.playerPosition : undefined;
    weatherView = createWeatherView(scene, scope, weather, {
      tier,
      reducedMotion: options.reducedMotion,
      area: { x: options.center.x, y: 0, z: options.center.z, halfX: area.halfX, halfZ: area.halfZ, height: area.height },
      ...(follow ? { follow } : {}),
    });
  }
  if (particles) {
    for (const handle of particles.emitters()) {
      const spec = handle.effective().spec;
      particleViews.push({ view: createParticleView(scene, scope, handle.pool.capacity, { name: `engine.particles.${handle.id}`, color: spec.color, size: spec.size }), handle });
    }
  }

  return {
    update(dt) {
      elapsed += dt;
      const reduced = options.reducedMotion();
      if (platformsApi) {
        for (const { spec, mesh, material, modelMaterials } of platforms) {
          const phase = platformsApi.phaseOf(spec.id);
          const top = platformsApi.positionOf(spec.id);
          const shown = top !== undefined && phase !== 'GONE' && platformsApi.isPresent(spec.id);
          mesh.visible = shown;
          if (!shown || !top) {
            continue;
          }
          mesh.position.set(top.x, top.y - spec.size.y / 2, top.z);
          // GE-L15: a turntable's mesh (and its model) turns with the simulated yaw.
          mesh.rotation.y = platformsApi.yawOf(spec.id) ?? 0;
          if (phase === 'CRUMBLING') {
            material.opacity = reduced ? DIM_OPACITY : Math.sin(elapsed * Math.PI * 2 * BLINK_HERTZ) > 0 ? 1 : DIM_OPACITY;
          } else {
            material.opacity = 1;
          }
          for (const m of modelMaterials) {
            m.transparent = material.opacity < 1;
            m.opacity = material.opacity;
          }
        }
      }
      for (const view of hazards.values()) {
        const warning = view.phase === 'WARN';
        const active = view.phase === 'ACTIVE';
        view.outline.visible = warning || active;
        view.fill.visible = warning || active;
        view.rock.visible = active;
        if (warning) {
          view.clock = Math.max(0, view.clock - dt);
          const progress = reduced ? 1 : 1 - view.clock / view.spec.telegraphSeconds;
          view.fill.scale.set(Math.max(0.05, progress), 1, Math.max(0.05, progress));
          view.drapeFill?.(Math.max(0.05, progress));
        } else if (active) {
          view.clock += dt;
          view.fill.scale.set(1, 1, 1);
          view.drapeFill?.(1);
          const fall = Math.min(1, view.clock / Math.max(0.1, view.spec.activeSeconds));
          view.rock.position.y = view.groundY + ROCK_START_HEIGHT * (1 - fall * fall) + ROCK_RADIUS * fall * fall;
        }
      }
      lightingView?.update();
      weatherView?.update(dt);
      for (const { view, handle } of particleViews) {
        view.update(handle.pool);
      }
    },
  };
}
