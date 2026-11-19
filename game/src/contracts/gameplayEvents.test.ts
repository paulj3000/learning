import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GAMEPLAY_EVENT_TYPES,
  createGameplayEventFactory,
  isGameplayEventType,
  validateGameplayEvent,
  type GameplayEventContext,
} from './gameplayEvents';
import { renderGameplayEventVectors } from './gameplayEventVectors';

interface Golden {
  schema: string;
  version: number;
  valid: { name: string; event: unknown }[];
  invalid: { name: string; event: unknown; issuePath: string }[];
}

const goldenText = readFileSync(fileURLToPath(new URL('../../../tests/contracts/gameplay-events-v1.json', import.meta.url)), 'utf8');
const golden = JSON.parse(goldenText) as Golden;

const context: GameplayEventContext = {
  realmId: 'treasure-rush',
  adventureId: 'treasure-cove',
  areaId: 'treasure-cove-beach',
  sessionRef: '3b9f6a2e-1c4d-4f8a-b7e2-9d0c5a6f1e23',
};

describe('gameplay event contract v1: golden vectors', () => {
  it.each(golden.valid.map((v) => [v.name, v.event] as const))('accepts %s', (_name, event) => {
    const result = validateGameplayEvent(event);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it.each(golden.invalid.map((v) => [v.name, v.event, v.issuePath] as const))('rejects %s', (_name, event, issuePath) => {
    const result = validateGameplayEvent(event);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path)).toContain(issuePath);
  });

  it('covers every v1 event type with at least one valid vector', () => {
    const covered = new Set(golden.valid.map((v) => (v.event as { type: string }).type));
    expect([...GAMEPLAY_EVENT_TYPES].filter((t) => !covered.has(t))).toEqual([]);
  });

  it('is exactly what the vector module renders (npm run engine:vectors)', () => {
    expect(goldenText).toBe(renderGameplayEventVectors());
  });

  it('declares the schema and version it was written for', () => {
    expect(golden.schema).toBe('lai.gameplay-event');
    expect(golden.version).toBe(1);
  });
});

describe('gameplay event factory', () => {
  const factory = createGameplayEventFactory(context, {
    newEventId: () => '11111111-2222-4333-8444-555555555555',
    now: () => Date.UTC(2026, 10, 18, 20, 0, 0),
  });

  it('builds a valid envelope from the bound context', () => {
    const event = factory.create('course.completed', { courseId: 'pirates-leap-course', goalId: 'crows-nest' });
    expect(event).toEqual({
      schema: 'lai.gameplay-event',
      version: 1,
      type: 'course.completed',
      eventId: '11111111-2222-4333-8444-555555555555',
      occurredAt: '2026-11-18T20:00:00.000Z',
      ...context,
      payload: { courseId: 'pirates-leap-course', goalId: 'crows-nest' },
    });
    expect(validateGameplayEvent(event).ok).toBe(true);
  });

  it('lets a single event override the area', () => {
    expect(factory.create('exploration.area.entered', { areaId: 'cave' }, { areaId: 'cave' }).areaId).toBe('cave');
  });

  it('refuses free text where an id belongs', () => {
    expect(() => factory.create('collectible.collected', { collectibleId: 'a shiny shell', setId: null })).toThrow(TypeError);
  });

  it('refuses smuggled fields at runtime even when types are bypassed', () => {
    const payload = { questId: 'lost-map', points: 5 } as unknown as { questId: string };
    expect(() => factory.create('quest.completed', payload)).toThrow(/payload.points/);
  });

  it('treats the accessible route of a jump challenge as the same completion claim', () => {
    const jumped = factory.create('jump.challenge.completed', { challengeId: 'stones', routeId: 'stones-jump' });
    const walked = factory.create('jump.challenge.completed', { challengeId: 'stones', routeId: 'stones-boardwalk' });
    expect(jumped.type).toBe(walked.type);
    expect(Object.keys(jumped.payload)).toEqual(Object.keys(walked.payload));
  });
});

describe('isGameplayEventType', () => {
  it('knows the v1 types and nothing else', () => {
    expect(isGameplayEventType('quest.completed')).toBe(true);
    expect(isGameplayEventType('player.recovered')).toBe(false);
    expect(isGameplayEventType(7)).toBe(false);
  });
});
