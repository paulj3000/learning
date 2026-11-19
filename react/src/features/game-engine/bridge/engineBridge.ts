import type { Box3 } from 'three';
import {
  CheckpointsService,
  createAabbPhysicsProvider,
  createEngineRuntime,
  createGameplayEventFactory,
  createPlayerTransform,
  createStandardCapabilityRegistry,
  EnvironmentQueryService,
  GameplayEventFactoryService,
  GameplaySettingsService,
  onPresentation,
  PhysicsProviderService,
  PLAYER_ENTITY_ID,
  PlatformsService,
  PlayerTransformComponent,
  RequirementCheckService,
  signalBoard,
  validateGameplayEvent,
  type AnyGameplayEvent,
  type CapabilityRequest,
  type ColliderSpec,
  type EngineRuntime,
  type EnginePresentationEventMap,
  type EventMap,
  type GameplayEventContext,
  type GameplayEventFactory,
  type GameplayEventFactoryOptions,
  type GameplaySettings,
  type PhysicsProvider,
  type RequirementChecker,
  type ValidationIssue,
  type Vec3Like,
} from '@lai/game-engine';
import type { JsonValue } from '../../island-map/three/runtime/locationManifest';
import type { WorldExtension, WorldExtensionContext, WorldExtensionMount } from '../../island-map/three/runtime/extensionRegistry';
import { mountBridgePresentation, type BridgePresentation } from './bridgePresentation';
import { deviceParticleTier, hostSupport, type BridgeHostSupport, type BridgePlayerState, type LocationBridgeHost } from './bridgeHost';

/**
 * GE-065: the location engine bridge.
 *
 * Region-play Areas (Treasure Cove, Heart of Firepeak, North Pole) still run on the island-map
 * `createLocationEngine`. Rather than a second host, this `WorldExtension` mounts an engine
 * runtime *inside* that live runtime and lets the Area use the engine's gameplay and environment
 * capabilities (telegraphed hazards, force and surface volumes, checkpoints, collectibles,
 * puzzles, atmosphere) from its manifest config:
 *
 * ```json
 * { "extensionId": "engineBridge", "config": { "capabilities": [{ "id": "gameplay.hazards", "config": { ... } }] } }
 * ```
 *
 * The live runtime keeps owning what it already does: movement, camera, avatar (`movement.*`,
 * `camera.*`, `character.*` are refused) and platforms (`gameplay.platforms` is refused unless
 * the bridge is created with `allowEnginePlatforms`, until GE-076), so nothing runs twice. An Area
 * may mix live and engine platforms, each id in one system only (Django refuses an id in both).
 *
 * Wiring:
 * - the engine reads the child from `host.playerState()` (fallback: `playerPosition()`) and
 *   writes the canonical `PlayerTransform` once per step, before every component;
 * - engine colliders (doors, gates) are mirrored into the host's live collider list with
 *   `engine:` ids, by reference, so in-place moves are live;
 * - `environment.volumes` hands its `EnvironmentQuery` to `host.setEnvironment` (null on dispose);
 * - a hazard asks the host to `teleportPlayer`, then exactly one
 *   `PlayerRecovered { reason: 'HAZARD', checkpointId, hazardId }` goes on the host bus;
 * - presentation events both buses share are forwarded to the host bus;
 * - gameplay claims go to `onGameplayEvent` (decision E15): validated, and an invalid claim or a
 *   throwing sink is caught, dropped and counted, never thrown at the child.
 */

export const ENGINE_BRIDGE_EXTENSION_ID = 'engineBridge';

/** Capability namespaces the live location runtime owns. */
const HOST_OWNED_PREFIXES = ['movement.', 'camera.', 'character.'] as const;
const ENGINE_PLATFORMS = 'gameplay.platforms';
const ENVIRONMENT_VOLUMES = 'environment.volumes';

/**
 * Presentation events forwarded to the host bus: exactly the names `EnginePresentationEventMap`
 * shares with `WorldEngineEventMap` (the parity test keeps those payloads equal).
 * `PlayerRecovered` is excluded here because the bridge emits it itself, once, after the teleport.
 */
const FORWARDED_EVENTS = [
  'PlayerJumped',
  'PlayerLanded',
  'PlayerGaitChanged',
  'PlayerFootstep',
  'PlayerEnteredZone',
  'PlayerLeftZone',
  'CourseCheckpointReached',
  'PlatformGoalReached',
  'PlayerBounced',
  'PressurePlatePressed',
  'PressurePlateReleased',
  'HazardTelegraph',
  'PlatformPhaseChanged',
  'PlatformActivated',
  'PlatformMoving',
  'PlatformStopped',
  'SurfaceFootstep',
] as const satisfies readonly Exclude<keyof EnginePresentationEventMap, 'PlayerRecovered'>[];

// Every presentation event except PlayerRecovered is forwarded (a type error lists any missed).
/** Host (live movement) events relayed into the engine runtime for components that consume them. */
const RELAYED_HOST_EVENTS = ['PlayerFootstep'] as const satisfies readonly (keyof EnginePresentationEventMap)[];

type Unforwarded = Exclude<keyof EnginePresentationEventMap, (typeof FORWARDED_EVENTS)[number] | 'PlayerRecovered'>;
const allForwarded: [Unforwarded] extends [never] ? true : false = true;
void allForwarded;

export interface EngineBridgeOptions {
  /**
   * Binds claims to the realm, adventure, area and session. Omit for no claims. May be a
   * function read at emit time, for a bridge registered once at module load whose context
   * (`sessionRef` above all) only exists per visit: while it returns null, the bridge emits no
   * claims (they are counted as unbound, not as invalid).
   */
  claims?: ClaimsBinding | (() => ClaimsBinding | null);
  /** The claim sink (decision E15). Same signature as `GameHost`'s `onGameplayEvent`. */
  onGameplayEvent?: (event: AnyGameplayEvent) => void;
  /** Requirement check for engine doors, gates and portals (quest steps, world changes). */
  requirements?: RequirementChecker;
  /**
   * Lets `gameplay.platforms` run in the engine. Live platforms may run beside them; a platform id
   * belongs to one system only (Django `scene_engine_bridge_problems` refuses an id in both).
   */
  allowEnginePlatforms?: boolean;
  /** Called with refused or invalid capability requests (the bridge then installs nothing). */
  onIssues?: (issues: readonly ValidationIssue[]) => void;
}

export interface EngineBridgeApi {
  readonly runtime: EngineRuntime<EventMap> | null;
  /** Refused or invalid requests; non-empty means nothing was installed. */
  readonly issues: readonly ValidationIssue[];
  readonly support: BridgeHostSupport;
  /** Claims dropped because they were invalid or the sink threw. */
  droppedClaims(): number;
  /** Claims not emitted because a lazy `claims` binding returned null (no visit context yet). */
  unboundClaims(): number;
  /**
   * Resumes a returning child's checkpoints (Firepeak acceptance scenario 10): marks each known
   * id reached, in authored order and without events or claims, then places the child at the
   * furthest one through the host's (checked, silent) teleport. Unknown ids are reported, not
   * thrown. Call once after the host's bootstrap with the checkpoints the server says were
   * earned. Returns the checkpoint the child was placed at, or null when none was known.
   */
  resume(checkpointIds: readonly string[]): { placedAt: string | null; unknown: string[] };
  /**
   * The latest checkpoint the child reached on the bridge, for the host's live fall recovery:
   * a fall below the ground (the live controller's own recovery) then returns the child to the
   * same place a bridge hazard would. Null before any checkpoint, or with no gameplay.checkpoints.
   */
  latestCheckpoint(): { id: string; x: number; z: number; yaw: number } | null;
  /**
   * Sets exactly these signals on (and turns off the ones a previous call set that are absent),
   * leaving every other signal alone (plates, switches, puzzles). A checkpoint, door or platform
   * gated by `requiresSignalId` opens when its signal is on. Region play feeds world-change keys
   * here (convention: `world:<changeKey>`, as `signalPlatforms` uses) from its bootstrap and
   * whenever the server reports new world changes.
   */
  setSignals(signalIds: readonly string[]): void;
  /**
   * GE-068: false when (x, y, z) is on the top of an engine platform that moves, rotates, falls or
   * bounces, so the host's last-safe-ground never records one. True with no engine platforms.
   */
  isSafeGround(x: number, y: number, z: number): boolean;
  /** GE-068: every engine platform's state, for realm parity tests. Empty with no engine platforms. */
  platforms(): readonly { id: string; phase: string; position: Vec3Like; size: Vec3Like; kind: string }[];
}

/** Reads `config.capabilities` and refuses what the live runtime owns. Pure; never throws. */
const ENVIRONMENT_PARTICLES = 'environment.particles';
const TIER_ORDER = ['OFF', 'LOW', 'MEDIUM', 'HIGH'] as const;
type Tier = (typeof TIER_ORDER)[number];

export function bridgeCapabilityRequests(
  config: { readonly [key: string]: JsonValue },
  allowEnginePlatforms = false,
  /** GE-L14: the device tier caps the seed's particle tier (never raises it). */
  deviceTier?: Tier,
): { requests: CapabilityRequest[]; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const requests: CapabilityRequest[] = [];
  const list = config.capabilities;
  if (list === undefined) {
    return { requests, issues };
  }
  if (!Array.isArray(list)) {
    return { requests, issues: [{ path: 'capabilities', message: 'must be a list of { id, config }' }] };
  }
  list.forEach((entry, index) => {
    const path = `capabilities[${index}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry) || typeof entry.id !== 'string') {
      issues.push({ path, message: 'must be { id, config }' });
      return;
    }
    const id = entry.id;
    if (HOST_OWNED_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      issues.push({ path, message: `"${id}" is owned by the live location runtime (movement, camera and avatar); the bridge never runs it` });
      return;
    }
    if (id === ENGINE_PLATFORMS && !allowEnginePlatforms) {
      issues.push({ path, message: `"${id}" is owned by the live platform system until GE-076; set allowEnginePlatforms to run engine platforms (beside any live ones, each id in one system)` });
      return;
    }
    // GE-068: staff tuning (`scene.platformTuning`, handed over as `platformTuning`) reaches the
    // platforms capability, which validates and applies it. The platforms' own config wins.
    const tuning = config.platformTuning;
    const entryConfig = entry.config;
    if (id === ENGINE_PLATFORMS && typeof tuning === 'object' && tuning !== null && !Array.isArray(tuning)) {
      const own = typeof entryConfig === 'object' && entryConfig !== null && !Array.isArray(entryConfig) ? entryConfig : {};
      requests.push({ id, config: { platformTuning: tuning, ...own } });
      return;
    }
    if (id === ENVIRONMENT_PARTICLES && deviceTier !== undefined) {
      const own = typeof entryConfig === 'object' && entryConfig !== null && !Array.isArray(entryConfig) ? entryConfig : {};
      const seedTier = (TIER_ORDER as readonly JsonValue[]).includes(own.tier ?? null) ? (own.tier as Tier) : 'MEDIUM';
      const tier = TIER_ORDER[Math.min(TIER_ORDER.indexOf(seedTier), TIER_ORDER.indexOf(deviceTier))];
      requests.push({ id, config: { ...own, tier } });
      return;
    }
    requests.push(entry.config === undefined ? { id } : { id, config: entry.config });
  });
  return { requests, issues };
}

/** The bridge as a `WorldExtension` for the island-map extension registry. */
export function createEngineBridgeExtension(options: EngineBridgeOptions = {}): WorldExtension {
  return {
    id: ENGINE_BRIDGE_EXTENSION_ID,
    mount(context: WorldExtensionContext): WorldExtensionMount {
      // No cast: today's context satisfies the bridge host structurally.
      const host: LocationBridgeHost = context;
      return mountEngineBridge(host, options);
    },
  };
}

interface HostCollider {
  hostId: string;
  box: Box3;
}

/**
 * A `PhysicsProvider` for engine components that keeps its own AABB bookkeeping (raycast,
 * overlaps) and mirrors every blocking collider into the host's live list by reference.
 */
function createHostMirroredPhysics(host: LocationBridgeHost, warn: (code: string, id: string) => void) {
  const inner = createAabbPhysicsProvider();
  const mirrored = new Map<string, HostCollider>();

  const boxOf = (id: string): Box3 | undefined => inner.boxes.find((box) => inner.idOfBox(box) === id);

  const mirror = (spec: ColliderSpec): void => {
    if (spec.kind === 'TRIGGER') {
      return; // triggers never block, so the host never sees them
    }
    const box = boxOf(spec.id);
    if (!box) {
      return;
    }
    const requested = `engine:${spec.id}`;
    const returned = host.addCollider(box, {
      jumpable: spec.kind === 'JUMPABLE' && spec.gate !== true,
      id: requested,
      ...(spec.gate ? { gate: true } : {}),
    });
    mirrored.set(spec.id, { hostId: typeof returned === 'string' ? returned : requested, box });
  };

  const unmirror = (id: string): void => {
    const entry = mirrored.get(id);
    if (!entry) {
      return;
    }
    mirrored.delete(id);
    if (!host.removeCollider(entry.hostId)) {
      warn('HOST_COLLIDER_REMOVE_FAILED', id);
    }
  };

  const provider: PhysicsProvider = {
    id: 'lai.bridge',
    addCollider(spec) {
      inner.addCollider(spec);
      mirror(spec);
    },
    updateCollider(id, min, max) {
      // In place: the host holds the same Box3, so the move is live there too.
      inner.updateCollider(id, min, max);
    },
    removeCollider(id) {
      unmirror(id);
      return inner.removeCollider(id);
    },
    hasCollider: (id) => inner.hasCollider(id),
    getCollider: (id) => inner.getCollider(id),
    colliders: () => inner.colliders(),
    raycast: (origin, direction, maxDistance, filter) => inner.raycast(origin, direction, maxDistance, filter),
    overlaps: (min, max) => inner.overlaps(min, max),
    onChange: (listener) => inner.onChange(listener),
  };
  return {
    provider,
    hostIds: () => [...mirrored.values()].map((entry) => entry.hostId),
    disposeAll: () => {
      for (const id of [...mirrored.keys()]) {
        unmirror(id);
      }
    },
  };
}

/** Reads the child from the host, with the documented fallback for a host without `playerState`. */
function createPlayerReader(host: LocationBridgeHost) {
  let last: Vec3Like | null = null;
  return (dt: number): BridgePlayerState => {
    if (host.playerState) {
      return host.playerState();
    }
    const ground = host.playerPosition();
    const position = { x: ground.x, y: 0, z: ground.z };
    const velocity =
      last && dt > 0 ? { x: (position.x - last.x) / dt, y: 0, z: (position.z - last.z) / dt } : { x: 0, y: 0, z: 0 };
    last = position;
    return { position, yaw: host.childPlacement?.().yaw ?? 0, velocity, grounded: true, supportId: null };
  };
}

export interface ClaimsBinding {
  context: GameplayEventContext;
  options?: GameplayEventFactoryOptions;
}

/**
 * A factory that resolves its binding at emit time. It rebuilds the inner factory only when the
 * binding's context changes (a new visit), and returns null (no claim) while unbound.
 */
function lazyFactory(resolve: () => ClaimsBinding | null, onUnbound: () => void): GameplayEventFactory {
  let boundContext: GameplayEventContext | null = null;
  let inner: GameplayEventFactory | null = null;
  const current = (): GameplayEventFactory | null => {
    const binding = resolve();
    if (!binding) {
      return null;
    }
    if (!inner || binding.context !== boundContext) {
      boundContext = binding.context;
      inner = createGameplayEventFactory(binding.context, binding.options);
    }
    return inner;
  };
  return {
    get context() {
      return current()?.context ?? UNBOUND_CONTEXT;
    },
    create(type, payload, overrides) {
      const factory = current();
      if (!factory) {
        onUnbound();
        return null as never;
      }
      return factory.create(type, payload, overrides);
    },
  };
}

const UNBOUND_CONTEXT: Readonly<GameplayEventContext> = Object.freeze({
  realmId: 'unbound',
  adventureId: 'unbound',
  areaId: null,
  sessionRef: null,
});

/** Wraps a factory so a claim that fails validation is counted and dropped, never thrown. */
function droppingFactory(inner: GameplayEventFactory, onDrop: () => void): GameplayEventFactory {
  return {
    context: inner.context,
    create(type, payload, overrides) {
      try {
        return inner.create(type, payload, overrides);
      } catch {
        onDrop();
        // `emitClaim` puts this on the bus; the bridge's claim listener ignores null.
        return null as never;
      }
    },
  };
}

/** A mounted bridge: always disposable (unlike the optional `WorldExtensionMount.dispose`). */
export interface EngineBridgeMount extends WorldExtensionMount {
  api: EngineBridgeApi;
  dispose(): void;
}

export function mountEngineBridge(host: LocationBridgeHost, options: EngineBridgeOptions = {}): EngineBridgeMount {
  const support = hostSupport(host);
  let dropped = 0;
  let unbound = 0;
  // `scene.engineBridge.allowEnginePlatforms` (seed data) or the creation option may allow it.
  const allowPlatforms = options.allowEnginePlatforms === true || host.config.allowEnginePlatforms === true;
  const deviceTier = deviceParticleTier(host.quality);
  const { requests, issues } = bridgeCapabilityRequests(host.config, allowPlatforms, deviceTier);

  const registry = createStandardCapabilityRegistry();
  if (issues.length === 0) {
    issues.push(...registry.resolve(requests).issues);
  }
  if (issues.length > 0) {
    options.onIssues?.(issues);
    return {
      api: {
        runtime: null,
        issues,
        support,
        droppedClaims: () => dropped,
        unboundClaims: () => unbound,
        resume: (ids) => ({ placedAt: null, unknown: [...ids] }),
        latestCheckpoint: () => null,
        setSignals: () => {},
        isSafeGround: () => true,
        platforms: () => [],
      },
      dispose() {},
    };
  }

  const runtime = createEngineRuntime<EventMap>({ id: ENGINE_BRIDGE_EXTENSION_ID, capabilities: registry });
  const warn = (code: string, id: string) => runtime.diagnostics.warn(code, { id });
  const physics = createHostMirroredPhysics(host, warn);
  const settings: GameplaySettings = { reducedMotion: host.reducedMotion };
  runtime.services.provide(PhysicsProviderService, physics.provider);
  runtime.services.provide(GameplaySettingsService, settings);
  if (options.requirements) {
    runtime.services.provide(RequirementCheckService, options.requirements);
  }
  if (options.claims) {
    const binding = options.claims;
    const factory =
      typeof binding === 'function'
        ? lazyFactory(binding, () => (unbound += 1))
        : createGameplayEventFactory(binding.context, binding.options);
    runtime.services.provide(GameplayEventFactoryService, droppingFactory(factory, () => (dropped += 1)));
  }
  if (!support.playerState) {
    runtime.diagnostics.warn('HOST_PLAYER_STATE_MISSING', { fallback: 'playerPosition' });
  }

  // The canonical transform, written from the host before any component runs.
  const player = runtime.world.create(PLAYER_ENTITY_ID);
  const first = createPlayerReader(host)(0);
  runtime.world.add(player, PlayerTransformComponent, createPlayerTransform(first.position, first.yaw));
  const readPlayer = createPlayerReader(host);
  runtime.systems.add({
    id: 'bridge.playerTransform',
    phase: 'input',
    order: -1000,
    update({ dt }) {
      const previous = runtime.world.require(player, PlayerTransformComponent);
      const state = readPlayer(dt);
      const moving = Math.hypot(state.velocity.x, state.velocity.z) > 0.2;
      runtime.world.set(player, PlayerTransformComponent, {
        position: { ...state.position },
        previousPosition: { ...previous.position },
        yaw: state.yaw,
        pitch: 0,
        velocity: { ...state.velocity },
        grounded: state.grounded,
        state: state.grounded ? (moving ? 'WALK' : 'IDLE') : state.velocity.y > 0 ? 'AIRBORNE' : 'FALLING',
        gait: state.grounded && moving ? 'walk' : 'idle',
        supportId: state.supportId,
      });
    },
  });

  // Claims: validated, then handed to the sink; nothing reaches the child as an error.
  runtime.events.on('gameplay.event' as never, ((event: AnyGameplayEvent | null) => {
    if (event === null) {
      return; // already counted by the dropping factory
    }
    if (!validateGameplayEvent(event).ok) {
      dropped += 1;
      return;
    }
    try {
      options.onGameplayEvent?.(event);
    } catch {
      dropped += 1;
    }
  }) as never);

  // Events the HOST's live movement emits that engine components consume (the host owns movement
  // under the bridge). Relayed host -> engine, and never forwarded back, so the buses cannot loop.
  // PlayerFootstep drives environment volumes' SurfaceFootstep (per-surface footstep cues).
  let relaying: string | null = null;
  for (const name of RELAYED_HOST_EVENTS) {
    runtime.resources.track(
      host.bus.on(name, (payload) => {
        relaying = name;
        try {
          runtime.events.emit(name as never, payload as never);
        } finally {
          relaying = null;
        }
      }),
    );
  }

  // Presentation events both buses share go to the host bus (never one the host just sent us).
  for (const name of FORWARDED_EVENTS) {
    runtime.events.on(name as never, ((payload: unknown) => {
      if (relaying === name) {
        return;
      }
      host.bus.emit(name, payload as never);
    }) as never);
  }

  // Hazards: the host moves the child, then exactly one PlayerRecovered names the hazard.
  runtime.resources.track(
    onPresentation(runtime, 'HazardRecoveryRequested', (request) => {
      host.teleportPlayer(request.position.x, request.position.z, request.yaw);
      host.bus.emit('PlayerRecovered', { reason: 'HAZARD', checkpointId: request.checkpointId, hazardId: request.hazardId });
    }),
  );

  // Synchronous: no setup step, so a valid start finishes before this returns.
  void runtime.start(requests).catch(() => {
    // Requests were resolved above; a failure here is reported through diagnostics.
  });

  let environmentHanded = false;
  const environment = runtime.installed.has(ENVIRONMENT_VOLUMES) ? runtime.services.get(EnvironmentQueryService) : undefined;
  if (environment) {
    if (host.setEnvironment) {
      host.setEnvironment(environment);
      environmentHanded = true;
    } else {
      runtime.diagnostics.warn('HOST_ENVIRONMENT_UNSUPPORTED', { capability: ENVIRONMENT_VOLUMES });
    }
  }

  // Presentation: only with a scene; otherwise one warning and nothing is drawn.
  const wantsPresentation = (['gameplay.platforms', 'gameplay.hazards', 'environment.weather', 'environment.lighting', 'environment.particles'] as const).some((id) => runtime.installed.has(id));
  let presentation: BridgePresentation | null = null;
  if (host.scene) {
    presentation = mountBridgePresentation(runtime, host.scene, { reducedMotion: () => settings.reducedMotion, center: host.playerPosition(), playerPosition: () => host.playerPosition(), ...(deviceTier ? { tier: deviceTier } : {}), ...(host.loadModel ? { loadModel: (assetId) => host.loadModel!(assetId) } : {}) });
  } else if (wantsPresentation) {
    runtime.diagnostics.warn('HOST_SCENE_MISSING', { fallback: 'nothing is drawn' });
  }

  // Engine platforms: carry and bounce go through the host's live controller.
  const platforms = runtime.services.get(PlatformsService);
  if (platforms && !support.carryLaunch) {
    runtime.diagnostics.warn('HOST_CARRY_UNSUPPORTED', { carryPlayer: typeof host.carryPlayer === 'function', launchPlayer: typeof host.launchPlayer === 'function' });
  }
  const applyPlatformMotion = (seconds: number): void => {
    if (!platforms) {
      return;
    }
    const transform = runtime.world.require(player, PlayerTransformComponent);
    const supportId = transform.supportId;
    if (supportId !== null && supportId.startsWith('engine:') && host.carryPlayer && seconds > 0) {
      const live = host.playerState?.();
      const at = live?.position ?? transform.position;
      const v = platforms.carryVelocityAt(supportId, at.x, at.z);
      if (v.x !== 0 || v.y !== 0 || v.z !== 0) {
        host.carryPlayer(v.x * seconds, v.y * seconds, v.z * seconds);
      }
    }
    // Always consumed, so an unsupported host never replays a stale bounce.
    const launch = platforms.consumeLaunch();
    if (launch && host.launchPlayer) {
      host.launchPlayer(launch.height);
    }
  };

  const stopFrames = host.onFrame((seconds) => {
    runtime.tick(seconds);
    applyPlatformMotion(seconds);
    presentation?.update(seconds);
  });

  // Resume: authored order decides "furthest" (the order of gameplay.checkpoints' list).
  const authoredOrder = (): string[] => {
    const config = runtime.capabilityConfig<{ checkpoints?: { id: string }[] }>('gameplay.checkpoints');
    return (config?.checkpoints ?? []).map((checkpoint) => checkpoint.id);
  };
  const resume = (checkpointIds: readonly string[]): { placedAt: string | null; unknown: string[] } => {
    const checkpoints = runtime.services.get(CheckpointsService);
    if (!checkpoints) {
      return { placedAt: null, unknown: [...checkpointIds] };
    }
    const order = authoredOrder();
    const unknown = checkpointIds.filter((id) => !checkpoints.has(id));
    const known = checkpointIds.filter((id) => checkpoints.has(id)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const id of known) {
      checkpoints.markReached(id); // no event, no claim: the server already holds these
    }
    const furthest = known.length > 0 ? checkpoints.latest() : null;
    if (furthest) {
      host.teleportPlayer(furthest.position.x, furthest.position.z, furthest.yaw);
    }
    return { placedAt: furthest?.id ?? null, unknown };
  };

  // Signals the host feeds (world changes); only these are ever switched off by setSignals.
  const fed = new Set<string>();
  const setSignals = (signalIds: readonly string[]): void => {
    const board = signalBoard(runtime);
    const next = new Set(signalIds);
    for (const id of fed) {
      if (!next.has(id)) {
        board.set(id, false);
      }
    }
    for (const id of next) {
      board.set(id, true);
    }
    fed.clear();
    for (const id of next) {
      fed.add(id);
    }
  };

  let disposed = false;
  return {
    api: {
      runtime,
      issues,
      support,
      droppedClaims: () => dropped,
      unboundClaims: () => unbound,
      resume,
      latestCheckpoint: () => {
        const latest = runtime.services.get(CheckpointsService)?.latest() ?? null;
        return latest ? { id: latest.id, x: latest.position.x, z: latest.position.z, yaw: latest.yaw } : null;
      },
      setSignals,
      isSafeGround: (x, y, z) => platforms?.isSafeGround(x, y, z) ?? true,
      platforms: () => platforms?.snapshot() ?? [],
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stopFrames();
      if (environmentHanded) {
        host.setEnvironment?.(null);
      }
      runtime.dispose();
      physics.disposeAll();
    },
  };
}
