/**
 * Gameplay event contracts, version 1 (`lai.gameplay-event`, v1).
 *
 * The engine emits these as **claims** about what happened in play. It never decides points,
 * rewards, mastery, progression or ownership: Django is authoritative and confirms each claim
 * against its own records (ADR-020 item 6; scoring standard: "the 3D engine never grants
 * anything"). Scoring (GE-100 to GE-110, `core/ge-scoring`) consumes these through its Django
 * intake validator, which tests against the same golden vectors as this module
 * (`tests/contracts/gameplay-events-v1.json`).
 *
 * Contract rules (stable for every v1 type):
 * 1. **Semantic ids only.** Every id is an authored, published content id or a Django record
 *    id (`SEMANTIC_ID`). No Three.js UUIDs, positions or camera data.
 * 2. **No child data.** No names, free text, audio, profile ids or ages. Payloads are strict:
 *    an unknown key is a validation error, so nothing can ride along.
 * 3. **The engine never grades learning.** A learning event carries the ids Django grades
 *    against (the `LearningRef`), never "correct", a score, a support level or a difficulty.
 *    Django already holds those and is their only source.
 * 4. **Accessible routes are equal.** A jump challenge completed by its non-jump route is the
 *    same `jump.challenge.completed` claim, with that route's id. The optional
 *    `jump.alternative.used` is informational, for reporting on route use only; consumers must
 *    never value it, or the alternative route, lower.
 * 5. **Falls and respawns are not gameplay events.** They can never cost anything, so they stay
 *    presentation events (`PlayerRecovered`) and are not in this contract.
 * 6. **`eventId` dedupes transport only.** Award idempotency is the consumer's, keyed on the
 *    source record, so a re-emitted completion with a fresh `eventId` still counts once.
 *
 * Versioning: adding an optional payload field or a new type is a minor change within v1 and
 * consumers must ignore unknown *types* they do not handle. Removing or renaming a field,
 * changing its meaning, or making it required is a breaking change and needs v2 alongside v1.
 */

import type { ValidationIssue, ValidationResult } from '../core/errors';

export const GAMEPLAY_EVENT_SCHEMA = 'lai.gameplay-event' as const;
export const GAMEPLAY_EVENT_VERSION = 1 as const;

/** Authored content ids and Django record ids: no spaces, so free text cannot pass. */
export const SEMANTIC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/**
 * What a learning event refers to: the server record Django grades against. Exactly one kind,
 * with exactly that kind's ids.
 */
export type LearningRef =
  /** A step of a step-based adventure session (`AdventureStep`). */
  | { kind: 'ADVENTURE_STEP'; stepId: string }
  /** A treasure chest's challenge attempt (Treasure Rush TR-20). */
  | { kind: 'CHEST_CHALLENGE'; chestEntityId: string; challengeAttemptId: string }
  /** A server-graded Area puzzle (rune stones, pattern locks, seating). */
  | { kind: 'AREA_PUZZLE'; puzzleId: string; challengeAttemptId: string }
  /** A published Question Studio item served into the world. */
  | { kind: 'QUESTION_ITEM'; questionId: string; challengeAttemptId: string };

export type GameplayEventPayloads = {
  // Learning questions
  'learning.question.presented': { learningRef: LearningRef };
  /** The child submitted an answer. `choiceId` is the authored option id, never typed text. */
  'learning.answer.submitted': { learningRef: LearningRef; choiceId: string | null };
  // Exploration
  'exploration.area.entered': { areaId: string };
  'exploration.discovery.found': { discoveryId: string };
  // Collectibles
  /**
   * `collectibleId` is the placement's entity id. `pickupKey` (optional, added in v1 for the
   * GE-100 intake) is the placement's server pickup change key, when the host knows it, so a
   * pending notification can be matched to the server pickup record exactly.
   */
  'collectible.collected': {
    collectibleId: string;
    setId: string | null;
    pickupKey?: string | null;
  };
  // Jump challenges
  'jump.challenge.started': { challengeId: string };
  'jump.challenge.completed': { challengeId: string; routeId: string };
  'jump.alternative.used': { challengeId: string; routeId: string };
  // Platform courses
  'course.checkpoint.reached': { courseId: string; checkpointId: string };
  'course.completed': { courseId: string; goalId: string };
  // Puzzles
  'puzzle.completed': { puzzleId: string };
  // NPCs
  'npc.interaction.completed': { npcId: string; interactionId: string };
  // Quests
  'quest.step.completed': { questId: string; stepId: string };
  'quest.completed': { questId: string };
  // Adventures
  'adventure.started': Record<string, never>;
  'adventure.completed': Record<string, never>;
  // Realm milestones
  'realm.milestone.reached': { milestoneId: string };
};

export type GameplayEventType = keyof GameplayEventPayloads;

export const GAMEPLAY_EVENT_TYPES = Object.freeze([
  'learning.question.presented',
  'learning.answer.submitted',
  'exploration.area.entered',
  'exploration.discovery.found',
  'collectible.collected',
  'jump.challenge.started',
  'jump.challenge.completed',
  'jump.alternative.used',
  'course.checkpoint.reached',
  'course.completed',
  'puzzle.completed',
  'npc.interaction.completed',
  'quest.step.completed',
  'quest.completed',
  'adventure.started',
  'adventure.completed',
  'realm.milestone.reached',
] as const satisfies readonly GameplayEventType[]);

export interface GameplayEventContext {
  realmId: string;
  adventureId: string;
  /** The 3D Area the event happened in, when it happened in one. */
  areaId: string | null;
  /** The Django `AdventureSession` UUID, when play runs inside one. */
  sessionRef: string | null;
}

export interface GameplayEvent<
  T extends GameplayEventType = GameplayEventType,
> extends GameplayEventContext {
  schema: typeof GAMEPLAY_EVENT_SCHEMA;
  version: typeof GAMEPLAY_EVENT_VERSION;
  type: T;
  /** Unique per emission; transport dedupe only. */
  eventId: string;
  /** ISO 8601 UTC with `Z`. */
  occurredAt: string;
  payload: GameplayEventPayloads[T];
}

/** Any v1 event, discriminated on `type`. */
export type AnyGameplayEvent = { [T in GameplayEventType]: GameplayEvent<T> }[GameplayEventType];

// --- validation --------------------------------------------------------------------------

type FieldRule = 'id' | 'idOrNull' | 'optionalIdOrNull' | 'learningRef';

const PAYLOAD_RULES: {
  [T in GameplayEventType]: Readonly<Record<keyof GameplayEventPayloads[T] & string, FieldRule>>;
} = {
  'learning.question.presented': { learningRef: 'learningRef' },
  'learning.answer.submitted': { learningRef: 'learningRef', choiceId: 'idOrNull' },
  'exploration.area.entered': { areaId: 'id' },
  'exploration.discovery.found': { discoveryId: 'id' },
  'collectible.collected': {
    collectibleId: 'id',
    setId: 'idOrNull',
    pickupKey: 'optionalIdOrNull',
  },
  'jump.challenge.started': { challengeId: 'id' },
  'jump.challenge.completed': { challengeId: 'id', routeId: 'id' },
  'jump.alternative.used': { challengeId: 'id', routeId: 'id' },
  'course.checkpoint.reached': { courseId: 'id', checkpointId: 'id' },
  'course.completed': { courseId: 'id', goalId: 'id' },
  'puzzle.completed': { puzzleId: 'id' },
  'npc.interaction.completed': { npcId: 'id', interactionId: 'id' },
  'quest.step.completed': { questId: 'id', stepId: 'id' },
  'quest.completed': { questId: 'id' },
  'adventure.started': {},
  'adventure.completed': {},
  'realm.milestone.reached': { milestoneId: 'id' },
};

const LEARNING_REF_FIELDS: Record<LearningRef['kind'], readonly string[]> = {
  ADVENTURE_STEP: ['stepId'],
  CHEST_CHALLENGE: ['chestEntityId', 'challengeAttemptId'],
  AREA_PUZZLE: ['puzzleId', 'challengeAttemptId'],
  QUESTION_ITEM: ['questionId', 'challengeAttemptId'],
};

const ENVELOPE_KEYS = new Set([
  'schema',
  'version',
  'type',
  'eventId',
  'occurredAt',
  'sessionRef',
  'realmId',
  'adventureId',
  'areaId',
  'payload',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkId(value: unknown, path: string, issues: ValidationIssue[], nullable = false): void {
  if (value === null && nullable) {
    return;
  }
  if (typeof value !== 'string' || !SEMANTIC_ID.test(value)) {
    issues.push({
      path,
      message: nullable ? 'must be a semantic id or null' : 'must be a semantic id',
    });
  }
}

function checkStrictKeys(
  value: Record<string, unknown>,
  allowed: Iterable<string>,
  path: string,
  issues: ValidationIssue[],
): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) {
      issues.push({
        path: path ? `${path}.${key}` : key,
        message: 'is not part of the v1 contract',
      });
    }
  }
}

function checkLearningRef(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push({ path, message: 'must be an object' });
    return;
  }
  const kind = value.kind;
  if (typeof kind !== 'string' || !(kind in LEARNING_REF_FIELDS)) {
    issues.push({
      path: `${path}.kind`,
      message: `must be one of ${Object.keys(LEARNING_REF_FIELDS).join(', ')}`,
    });
    return;
  }
  const fields = LEARNING_REF_FIELDS[kind as LearningRef['kind']];
  checkStrictKeys(value, ['kind', ...fields], path, issues);
  for (const field of fields) {
    checkId(value[field], `${path}.${field}`, issues);
  }
}

/** Validates untrusted input as a v1 gameplay event. Never throws. */
export function validateGameplayEvent(input: unknown): ValidationResult<AnyGameplayEvent> {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    return { ok: false, issues: [{ path: '', message: 'must be an object' }] };
  }
  checkStrictKeys(input, ENVELOPE_KEYS, '', issues);
  if (input.schema !== GAMEPLAY_EVENT_SCHEMA) {
    issues.push({ path: 'schema', message: `must be "${GAMEPLAY_EVENT_SCHEMA}"` });
  }
  if (input.version !== GAMEPLAY_EVENT_VERSION) {
    issues.push({ path: 'version', message: `must be ${GAMEPLAY_EVENT_VERSION}` });
  }
  if (typeof input.eventId !== 'string' || !EVENT_ID.test(input.eventId)) {
    issues.push({ path: 'eventId', message: 'must be 8 to 64 letters, digits or hyphens' });
  }
  if (
    typeof input.occurredAt !== 'string' ||
    !ISO_UTC.test(input.occurredAt) ||
    Number.isNaN(Date.parse(input.occurredAt))
  ) {
    issues.push({ path: 'occurredAt', message: 'must be an ISO 8601 UTC timestamp ending in Z' });
  }
  if (
    input.sessionRef !== null &&
    (typeof input.sessionRef !== 'string' || !UUID.test(input.sessionRef))
  ) {
    issues.push({ path: 'sessionRef', message: 'must be a UUID or null' });
  }
  checkId(input.realmId, 'realmId', issues);
  checkId(input.adventureId, 'adventureId', issues);
  checkId(input.areaId, 'areaId', issues, true);

  const type = input.type;
  if (typeof type !== 'string' || !(type in PAYLOAD_RULES)) {
    issues.push({ path: 'type', message: 'is not a v1 gameplay event type' });
  } else if (!isRecord(input.payload)) {
    issues.push({ path: 'payload', message: 'must be an object' });
  } else {
    const rules = PAYLOAD_RULES[type as GameplayEventType] as Record<string, FieldRule>;
    checkStrictKeys(input.payload, Object.keys(rules), 'payload', issues);
    for (const [field, rule] of Object.entries(rules)) {
      const path = `payload.${field}`;
      if (!(field in input.payload)) {
        if (rule !== 'optionalIdOrNull') {
          issues.push({ path, message: 'is required' });
        }
        continue;
      }
      const value = input.payload[field];
      if (rule === 'learningRef') {
        checkLearningRef(value, path, issues);
      } else {
        checkId(value, path, issues, rule === 'idOrNull' || rule === 'optionalIdOrNull');
      }
    }
  }
  return issues.length === 0
    ? { ok: true, value: input as unknown as AnyGameplayEvent, issues: [] }
    : { ok: false, issues };
}

export function isGameplayEventType(value: unknown): value is GameplayEventType {
  return typeof value === 'string' && value in PAYLOAD_RULES;
}

// --- construction ------------------------------------------------------------------------

export interface GameplayEventFactoryOptions {
  /** Unique id per event. Default: `crypto.randomUUID()`. */
  newEventId?: () => string;
  /** Current time. Default: `Date.now`. */
  now?: () => number;
}

export interface GameplayEventFactory {
  readonly context: Readonly<GameplayEventContext>;
  /** Builds and validates an event; throws a `TypeError` listing issues if it is invalid. */
  create<T extends GameplayEventType>(
    type: T,
    payload: GameplayEventPayloads[T],
    overrides?: Partial<Pick<GameplayEventContext, 'areaId'>>,
  ): GameplayEvent<T>;
}

export function createGameplayEventFactory(
  context: GameplayEventContext,
  options: GameplayEventFactoryOptions = {},
): GameplayEventFactory {
  const newEventId = options.newEventId ?? (() => globalThis.crypto.randomUUID());
  const now = options.now ?? Date.now;
  const frozen = Object.freeze({ ...context });
  return {
    context: frozen,
    create(type, payload, overrides = {}) {
      const event = {
        schema: GAMEPLAY_EVENT_SCHEMA,
        version: GAMEPLAY_EVENT_VERSION,
        type,
        eventId: newEventId(),
        occurredAt: new Date(now()).toISOString(),
        sessionRef: frozen.sessionRef,
        realmId: frozen.realmId,
        adventureId: frozen.adventureId,
        areaId: overrides.areaId !== undefined ? overrides.areaId : frozen.areaId,
        payload,
      } satisfies GameplayEvent<typeof type>;
      const result = validateGameplayEvent(event);
      if (!result.ok) {
        throw new TypeError(
          `Invalid gameplay event "${type}": ${result.issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
        );
      }
      return event;
    },
  };
}

/** The runtime bus event that carries gameplay claims to the host. */
export type GameplayEventBusMap = { 'gameplay.event': AnyGameplayEvent };
