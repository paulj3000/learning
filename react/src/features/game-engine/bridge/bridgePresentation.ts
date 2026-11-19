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
    const plane = scope.track(new PlaneGeometry(width, depth));
    plane.rotateX(-Math.PI / 2);
    const outlineMaterial = scope.track(new MeshBasicMaterial({ color: 0xffb703, transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false }));
    const fillMaterial = scope.track(new MeshBasicMaterial({ color: 0xe76f51, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }));
    const rockMaterial = scope.track(new MeshStandardMaterial({ color: 0x7a6a5a }));
    const outline = addMesh(new Mesh(plane, outlineMaterial));
    const fill = addMesh(new Mesh(plane, fillMaterial));
    const rock = addMesh(new Mesh(scope.track(new SphereGeometry(ROCK_RADIUS, 12, 8)), rockMaterial));
    outline.name = `engine.hazard.${spec.id}.outline`;
    fill.name = `engine.hazard.${spec.id}.fill`;
    rock.name = `engine.hazard.${spec.id}.object`;
    outline.position.set(cx, GROUND_LIFT, cz);
    fill.position.set(cx, GROUND_LIFT + 0.005, cz);
    rock.position.set(cx, ROCK_START_HEIGHT, cz);
    outline.visible = fill.visible = rock.visible = false;
    hazards.set(spec.id, { spec, outline, fill, rock, phase: 'REST', clock: 0 });
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
        } else if (active) {
          view.clock += dt;
          view.fill.scale.set(1, 1, 1);
          const fall = Math.min(1, view.clock / Math.max(0.1, view.spec.activeSeconds));
          view.rock.position.y = ROCK_START_HEIGHT * (1 - fall * fall) + ROCK_RADIUS * fall * fall;
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
