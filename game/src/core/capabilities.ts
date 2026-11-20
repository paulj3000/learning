/**
 * Configuration and capability registry.
 *
 * A **capability** is a named, versioned unit of engine behaviour that an adventure turns on
 * with data: `movement.jump`, `movement.sprint`, `camera.thirdPerson`, `gameplay.platforms`,
 * `environment.weather`. Jumping is a capability like any other (jumping standard: shared,
 * optional per adventure), not a separate "platformer" category.
 *
 * Each definition declares:
 * - `defaults` and a `validate` function that turns untrusted config (a manifest, a Django
 *   published Area) into a typed config or validation issues, clamping nothing silently;
 * - `requires`: other capabilities it needs (installed first; cycles rejected);
 * - `install`: composes the behaviour into a runtime (adds systems, components, listeners)
 *   and returns an optional uninstall. Composition, not inheritance.
 *
 * `resolveCapabilities` is pure: it validates a whole adventure's capability set and returns
 * the install order, so the SDK's content validator and the runtime share one code path.
 */

import { EngineError, type ValidationIssue, type ValidationResult } from './errors';

export type CapabilityId = string;

export interface CapabilityDefinition<Config, Context = unknown> {
  readonly id: CapabilityId;
  /** Semver of the capability's config contract. */
  readonly version: string;
  readonly description: string;
  readonly requires?: readonly CapabilityId[];
  readonly defaults: Config;
  /** Validates a partial override merged over `defaults`. Must not throw. */
  validate(input: unknown): ValidationResult<Config>;
  /** Composes the capability into a running engine. Returns an optional teardown. */
  install?(context: Context, config: Config): void | (() => void);
}

// A registry stores definitions with erased config types; lookups re-narrow by id.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased at the registry edge only
type AnyCapability<Context> = CapabilityDefinition<any, Context>;

export interface CapabilityRequest {
  id: CapabilityId;
  /** Partial config override; omitted means the defaults. */
  config?: unknown;
}

export interface ResolvedCapability<Context = unknown> {
  definition: AnyCapability<Context>;
  config: unknown;
}

export interface CapabilityResolution<Context = unknown> {
  ok: boolean;
  /** Install order: every capability after the ones it requires. */
  order: ResolvedCapability<Context>[];
  issues: ValidationIssue[];
}

export interface CapabilityRegistry<Context = unknown> {
  register<Config>(definition: CapabilityDefinition<Config, Context>): void;
  has(id: CapabilityId): boolean;
  get(id: CapabilityId): AnyCapability<Context> | undefined;
  list(): AnyCapability<Context>[];
  resolve(requests: readonly CapabilityRequest[]): CapabilityResolution<Context>;
}

const ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export function createCapabilityRegistry<Context = unknown>(): CapabilityRegistry<Context> {
  const definitions = new Map<CapabilityId, AnyCapability<Context>>();

  const registry: CapabilityRegistry<Context> = {
    register(definition) {
      if (!ID_PATTERN.test(definition.id)) {
        throw new EngineError('INVALID_CONFIG', `Capability id "${definition.id}" must be dotted lowerCamel with a namespace`, {
          id: definition.id,
        });
      }
      if (!SEMVER.test(definition.version)) {
        throw new EngineError('INVALID_CONFIG', `Capability "${definition.id}" version must be semver`, {
          id: definition.id,
          version: definition.version,
        });
      }
      if (definitions.has(definition.id)) {
        throw new EngineError('DUPLICATE_ID', `Capability "${definition.id}" is already registered`, { id: definition.id });
      }
      definitions.set(definition.id, definition as AnyCapability<Context>);
    },
    has: (id) => definitions.has(id),
    get: (id) => definitions.get(id),
    list: () => [...definitions.values()],
    resolve(requests) {
      return resolveCapabilities(definitions, requests);
    },
  };
  return registry;
}

export function resolveCapabilities<Context>(
  definitions: ReadonlyMap<CapabilityId, AnyCapability<Context>>,
  requests: readonly CapabilityRequest[],
): CapabilityResolution<Context> {
  const issues: ValidationIssue[] = [];
  const requested = new Map<CapabilityId, CapabilityRequest>();
  requests.forEach((request, index) => {
    if (requested.has(request.id)) {
      issues.push({ path: `capabilities[${index}]`, message: `Capability "${request.id}" is listed twice` });
      return;
    }
    requested.set(request.id, request);
  });

  // Close over `requires`: a required capability not requested is added with its defaults.
  const needed = new Map<CapabilityId, CapabilityRequest>(requested);
  const queue = [...requested.keys()];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const definition = definitions.get(id);
    if (!definition) {
      issues.push({ path: `capabilities.${id}`, message: `Unknown capability "${id}"` });
      continue;
    }
    for (const dependency of definition.requires ?? []) {
      if (!definitions.has(dependency)) {
        issues.push({ path: `capabilities.${id}.requires`, message: `"${id}" requires unknown capability "${dependency}"` });
      } else if (!needed.has(dependency)) {
        needed.set(dependency, { id: dependency });
        queue.push(dependency);
      }
    }
  }

  // Topological order (depth-first, deterministic by request order), rejecting cycles.
  const order: ResolvedCapability<Context>[] = [];
  const state = new Map<CapabilityId, 'visiting' | 'done'>();
  const visit = (id: CapabilityId, trail: CapabilityId[]): void => {
    const definition = definitions.get(id);
    if (!definition || state.get(id) === 'done') {
      return;
    }
    if (state.get(id) === 'visiting') {
      issues.push({ path: `capabilities.${id}`, message: `Capability dependency cycle: ${[...trail, id].join(' -> ')}` });
      return;
    }
    state.set(id, 'visiting');
    for (const dependency of definition.requires ?? []) {
      visit(dependency, [...trail, id]);
    }
    state.set(id, 'done');
    const request = needed.get(id)!;
    const result = definition.validate(request.config ?? {});
    if (result.ok) {
      order.push({ definition, config: result.value });
    } else {
      for (const issue of result.issues) {
        issues.push({ path: `capabilities.${id}${issue.path ? `.${issue.path}` : ''}`, message: issue.message });
      }
    }
  };
  for (const id of needed.keys()) {
    visit(id, []);
  }
  return { ok: issues.length === 0, order, issues };
}
