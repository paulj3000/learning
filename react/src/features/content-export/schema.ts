/**
 * The JSON Schema (draft 2020-12 subset) for the exported content files, plus a small validator for
 * exactly that subset (LAI-0302). Written from the TypeScript types the content already satisfies;
 * every object is closed (`additionalProperties: false`), so a new field or shape fails the export
 * until the schema is updated on purpose. A full JSON Schema validator in Python is chosen when
 * Django ingests this (LAI-0304); this one only has to be correct for the keywords used here.
 *
 * Keywords used: type, enum, const, required, properties, additionalProperties, items, minItems,
 * minLength, minimum, maximum, oneOf, $ref (to #/$defs only).
 */
import { LEARNING_DOMAINS } from '../learning-profile/types';
import { FILE_LAYOUT, SCHEMA_VERSION, type ContentFileName } from './types';

type Schema = Record<string, unknown>;

const text: Schema = { type: 'string', minLength: 1 };
const anyText: Schema = { type: 'string' };
const int: Schema = { type: 'integer' };
const num: Schema = { type: 'number' };
const bool: Schema = { type: 'boolean' };
const arr = (items: Schema): Schema => ({ type: 'array', items });
const texts = arr(text);
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const enumOf = (...values: string[]): Schema => ({ type: 'string', enum: values });
const obj = (required: Record<string, Schema>, optional: Record<string, Schema> = {}): Schema => ({
  type: 'object',
  properties: { ...required, ...optional },
  required: Object.keys(required),
  additionalProperties: false,
});
const tagged = (
  discriminant: string,
  variants: Record<string, [Record<string, Schema>, Record<string, Schema>?]>,
): Schema => ({
  oneOf: Object.entries(variants).map(([tag, [required, optional]]) =>
    obj({ [discriminant]: { const: tag }, ...required }, optional),
  ),
});

const AGE_BANDS = ['SPROUT', 'PATHFINDER', 'EXPLORER'];
const ageBands = arr(enumOf(...AGE_BANDS));

const defs: Record<string, Schema> = {
  choiceOption: obj({ id: text, label: text }, { groups: arr(num) }),
  worldChangePayload: obj({ changeType: text, changeKey: text, locationSlug: text }),
  presentation: tagged('kind', {
    narrative: [{ speaker: text, text }, { aiNarrated: bool }],
    'number-input': [{ prompt: text, correctValue: num }],
    choice: [{ prompt: text, options: arr(ref('choiceOption')), correctOptionId: text }],
    ordering: [{ prompt: text, items: arr(ref('choiceOption')), correctOrder: texts }],
    matching: [{ prompt: text, pairs: arr(obj({ leftId: text, rightId: text })) }],
    'short-response': [
      { prompt: text, options: arr(ref('choiceOption')), acceptedOptionIds: texts },
    ],
    'creative-choice': [{ prompt: text, options: arr(ref('choiceOption')) }],
    reflection: [{ prompt: text }],
    'world-change': [{ text, payload: ref('worldChangePayload') }],
    complete: [{ text }],
  }),
  adventureStep: obj(
    {
      id: text,
      type: enumOf(
        'NARRATIVE',
        'CHOICE',
        'NUMBER_INPUT',
        'ORDERING',
        'MATCHING',
        'SHORT_RESPONSE',
        'CREATIVE_CHOICE',
        'REFLECTION',
        'WORLD_CHANGE',
        'COMPLETE',
      ),
      objectiveIds: texts,
      presentation: ref('presentation'),
      transitions: arr(
        obj({ when: enumOf('correct', 'incorrect', 'partial', 'always'), nextStepId: text }),
      ),
      fallback: obj({ text }),
    },
    { hintPolicy: obj({ ladder: texts }) },
  ),
  adventure: obj(
    {
      slug: text,
      version: int,
      title: text,
      locationSlug: text,
      ageBands,
      entryStepId: text,
      steps: arr(ref('adventureStep')),
    },
    {
      /** Both optional and independent of `ageBands`; absent on adventures authored before schema 2. */
      skillDomain: enumOf(...LEARNING_DOMAINS),
      skillLevel: { type: 'integer', minimum: 1, maximum: 6 },
    },
  ),
  learningObjective: obj({
    code: text,
    domain: enumOf(
      'literacy',
      'numeracy',
      'science',
      'creativity',
      'social-emotional',
      'executive-function',
    ),
    title: text,
  }),
  wonderWallQuestion: obj({
    id: text,
    category: enumOf('Animals', 'Plants', 'Sky and Weather', 'Growing and Changing'),
    question: text,
  }),
  storyScene: tagged('kind', {
    NARRATIVE: [
      { id: text, speaker: text, text },
      {
        aiNarrated: bool,
        branches: arr(obj({ when: obj({ flagKey: text, equals: text }), text })),
      },
    ],
    CHOICE: [
      {
        id: text,
        prompt: text,
        flagKey: text,
        options: arr(obj({ id: text, label: text, flagValue: text }, { groups: arr(num) })),
      },
    ],
    ADVENTURE: [{ id: text, templateSlug: text }],
    REFLECTION: [{ id: text, prompt: text, objectiveIds: texts }],
  }),
  story: obj({
    slug: text,
    title: text,
    description: text,
    supportedAgeBands: ageBands,
    entryChapterId: text,
    chapters: arr(
      obj({ id: text, title: text, scenes: arr(ref('storyScene')) }, { nextChapterId: text }),
    ),
    completionWorldChange: ref('worldChangePayload'),
  }),
  relationshipLevel: enumOf('STRANGER', 'ACQUAINTANCE', 'FRIEND', 'TRUSTED_FRIEND'),
  questCondition: tagged('type', {
    ALWAYS: [{}],
    QUEST_COMPLETED: [{ questId: text }],
    WORLD_CHANGE: [{ changeKey: text }],
    ITEM_OWNED: [{ itemId: text }],
    RELATIONSHIP_AT_LEAST: [{ npcId: text, level: ref('relationshipLevel') }],
    OBJECTIVE_COMPLETED: [{ objectiveId: text }],
  }),
  questWorldChange: obj({ locationSlug: text, changeType: text, changeKey: text }),
  questObjective: tagged('kind', {
    TALK_TO: [{ id: text, label: text, npcId: text, memoryFlag: text }, { optional: bool }],
    HELP_NPC: [{ id: text, label: text, npcId: text, memoryFlag: text }, { optional: bool }],
    DELIVER: [
      { id: text, label: text, itemId: text, npcId: text, memoryFlag: text },
      { optional: bool },
    ],
    FIND: [{ id: text, label: text, itemId: text }, { optional: bool }],
    CRAFT: [{ id: text, label: text, itemId: text }, { optional: bool }],
    COLLECT: [
      { id: text, label: text, itemIds: texts },
      { optional: bool, requiredCount: int },
    ],
    SOLVE: [{ id: text, label: text, adventureSlug: text }, { optional: bool }],
    BUILD: [{ id: text, label: text, changeKey: text }, { optional: bool }],
    EXPLORE: [{ id: text, label: text, locationSlug: text }, { optional: bool }],
    LEARN: [
      {
        id: text,
        label: text,
        learningObjectiveCode: text,
        atLeast: enumOf('LOCKED', 'INTRODUCED', 'DEVELOPING', 'PROFICIENT', 'MASTERED'),
      },
      { optional: bool },
    ],
    DISCOVER: [{ id: text, label: text, discoveryKey: text }, { optional: bool }],
  }),
  quest: obj(
    {
      id: text,
      title: text,
      summary: text,
      ageBands,
      prerequisites: arr(ref('questCondition')),
      entryStageId: text,
      stages: arr(
        obj(
          { id: text, title: text, objectives: arr(ref('questObjective')) },
          {
            branches: arr(obj({ conditions: arr(ref('questCondition')), nextStageId: text })),
            nextStageId: text,
            worldChanges: arr(ref('questWorldChange')),
          },
        ),
      ),
      completion: obj(
        { journalNote: text },
        {
          worldChanges: arr(ref('questWorldChange')),
          setsNpcMemoryFlags: arr(obj({ npcId: text, flags: texts })),
        },
      ),
    },
    { giverNpcId: text },
  ),
  item: obj(
    {
      id: text,
      displayName: text,
      description: text,
      category: enumOf('COLLECTIBLE', 'COSMETIC', 'QUEST_ITEM', 'KEEPSAKE'),
      rarity: enumOf('COMMON', 'UNCOMMON', 'RARE'),
    },
    { setId: text, hidden: bool, cosmeticSlot: enumOf('HAT', 'BACKPACK', 'ACCESSORY', 'OUTFIT') },
  ),
  collectibleSet: obj(
    { id: text, displayName: text, completionMessage: text, itemIds: texts },
    { completionItemId: text },
  ),
  rewardRule: obj({
    id: text,
    trigger: tagged('type', {
      ADVENTURE_COMPLETED: [{ templateSlug: text }],
      STORY_COMPLETED: [{ storySlug: text }],
      QUEST_COMPLETED: [{ questId: text }],
      WORLD_CHANGE: [{ changeKey: text }],
      NPC_RELATIONSHIP: [{ npcId: text, level: text }],
      DISCOVERY: [{ discoveryKey: text }],
    }),
    itemIds: texts,
    message: text,
  }),
  npcCondition: tagged('type', {
    ALWAYS: [{}],
    MEMORY_FLAG: [{ flag: text, equals: bool }],
    RELATIONSHIP_AT_LEAST: [{ level: ref('relationshipLevel') }],
    WORLD_CHANGE: [{ changeKey: text }],
    QUEST_COMPLETED: [{ questId: text }],
    TIME_OF_DAY: [{ timeOfDay: enumOf('MORNING', 'AFTERNOON', 'EVENING') }],
  }),
  npc: obj({
    id: text,
    displayName: text,
    role: text,
    homeLocationSlug: text,
    interactionId: text,
    schedule: arr(
      obj(
        { timeOfDay: enumOf('MORNING', 'AFTERNOON', 'EVENING'), locationSlug: text },
        { zoneId: text },
      ),
    ),
    dialogue: arr(
      obj(
        {
          id: text,
          conditions: arr(ref('npcCondition')),
          text,
          choices: arr(
            obj(
              { id: text, label: text },
              { nextNodeId: text, conditions: arr(ref('npcCondition')) },
            ),
          ),
        },
        {
          setsMemoryFlags: texts,
          awardsRelationshipPoints: num,
          followUpOnly: bool,
          narration: obj({ allowedTopic: text, fallbackText: text }),
        },
      ),
    ),
    questOffers: arr(obj({ questId: text, summary: text, conditions: arr(ref('npcCondition')) })),
  }),
  discovery: obj(
    {
      id: text,
      locationSlug: text,
      kind: enumOf('HIDDEN_CAVE', 'SECRET_PASSAGE', 'LOCKED_DOOR', 'HIDDEN_OBJECT'),
      title: text,
      revealMessage: text,
      lockedMessage: text,
      requirements: arr(
        tagged('type', {
          ALWAYS: [{}],
          WORLD_CHANGE_PRESENT: [{ changeKey: text }],
          ITEM_OWNED: [{ itemId: text }],
          DISCOVERY_PRESENT: [{ discoveryId: text }],
        }),
      ),
    },
    { worldChange: ref('questWorldChange'), startsQuestId: text },
  ),
  /** x, z in meters and yaw in radians, in the original first-person region coordinate system. */
  checkpoint: obj({ id: text, regionId: text, label: text, x: num, z: num, yaw: num }),
  interaction: obj(
    {
      id: text,
      type: enumOf('NPC', 'OBJECT', 'LOCATION', 'DISCOVERY', 'ADVENTURE'),
      trigger: enumOf('TAP', 'APPROACH', 'ENTER', 'USE'),
      title: text,
      targetId: text,
      action: tagged('kind', {
        NAVIGATE: [{ to: text }],
        SHOW_MESSAGE: [{ message: text }],
        START_ADVENTURE: [{ locationSlug: text, templateSlug: text }],
        DISCOVER: [{ discoveryId: text }],
        TALK_TO: [{ npcId: text }],
        START_STORY: [{ storySlug: text }],
      }),
    },
    {
      requirements: arr(
        tagged('type', {
          ALWAYS: [{}],
          WORLD_CHANGE_PRESENT: [{ changeKey: text }],
          WORLD_CHANGE_ABSENT: [{ changeKey: text }],
          ITEM_OWNED: [{ itemId: text }],
          DISCOVERY_PRESENT: [{ discoveryId: text }],
        }),
      ),
      zoneId: text,
    },
  ),
  regionInteractions: obj({ regionSlug: text, interactions: arr(ref('interaction')) }),
  regionAssets: obj({ regionSlug: text, assetIds: texts }),
  subject: obj({ id: text, title: text }),
  grade: obj({ id: text, subjectId: text, title: text, ageBands }),
  domain: obj({ id: text, gradeId: text, title: text }),
  skill: obj(
    {
      id: text,
      domainId: text,
      title: text,
      description: anyText,
      prerequisiteSkillIds: texts,
      difficulty: { type: 'integer', minimum: 1, maximum: 5 },
      representations: arr(enumOf('numeric', 'visual', 'word-problem', 'game-interaction')),
    },
    { standardsRefs: texts },
  ),
  asset: obj(
    {
      id: text,
      url: text,
      kind: enumOf('kit-piece', 'character', 'prop', 'collectible'),
      clips: texts,
    },
    { lod: obj({ lowDetailId: text, distanceMeters: num }) },
  ),
  location: obj(
    {
      slug: text,
      worldSlug: text,
      title: text,
      tagline: text,
      description: text,
      skills: texts,
      decoration: text,
    },
    { unlockRequirement: obj({ changeKey: text }) },
  ),
  island: obj(
    {
      slug: text,
      title: text,
      tagline: text,
      description: text,
      supportedAgeBands: ageBands,
      pack: obj({
        version: int,
        locationSlugs: texts,
        adventureSlugs: texts,
        questIds: texts,
        itemIds: texts,
        collectibleSetIds: texts,
        npcIds: texts,
        discoveryIds: texts,
        storySlugs: texts,
      }),
    },
    {
      isHome: bool,
      arrival: obj({ locationSlug: text, text, changeKey: text }),
      travelRequirement: obj({ anyOfChangeKeys: texts, lockedHint: text }),
    },
  ),
};

/** collection key -> definition name */
const COLLECTION_DEFS: Record<string, string> = {
  islands: 'island',
  locations: 'location',
  adventures: 'adventure',
  learningObjectives: 'learningObjective',
  wonderWallQuestions: 'wonderWallQuestion',
  stories: 'story',
  quests: 'quest',
  items: 'item',
  collectibleSets: 'collectibleSet',
  rewardRules: 'rewardRule',
  npcs: 'npc',
  discoveries: 'discovery',
  checkpoints: 'checkpoint',
  interactions: 'regionInteractions',
  subjects: 'subject',
  grades: 'grade',
  domains: 'domain',
  skills: 'skill',
  assets: 'asset',
  locationAssets: 'regionAssets',
};

const fileKey = (name: string) => `file:${name}`;

for (const [name, collections] of Object.entries(FILE_LAYOUT)) {
  defs[fileKey(name)] = obj({
    schemaVersion: { const: SCHEMA_VERSION },
    ...Object.fromEntries(
      collections.map((key) => [key, arr(ref(COLLECTION_DEFS[key] as string))]),
    ),
  });
}

defs.manifest = obj({
  schemaVersion: { const: SCHEMA_VERSION },
  exportTool: obj({ name: text, version: text }),
  contentDigest: { type: 'string', minLength: 64, maxLength: 64 },
  files: arr(
    obj({
      path: text,
      sha256: { type: 'string', minLength: 64, maxLength: 64 },
      counts: { type: 'object', additionalProperties: int },
    }),
  ),
  knownAmbiguities: arr(obj({ kind: text, ids: texts, detail: text })),
});

export const CONTENT_SCHEMA: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'content.schema.json',
  title: 'Learning Adventure Island exported content',
  description:
    'Schema for content/exported/*.json. Each file is validated against its entry in "x-files". Closed objects: unknown fields are errors.',
  'x-schemaVersion': SCHEMA_VERSION,
  'x-files': {
    'manifest.json': '#/$defs/manifest',
    ...Object.fromEntries(
      Object.keys(FILE_LAYOUT).map((name) => [name, `#/$defs/${fileKey(name)}`]),
    ),
  },
  $defs: defs,
};

export function schemaForFile(name: ContentFileName | 'manifest.json'): Schema {
  return { $ref: (CONTENT_SCHEMA['x-files'] as Record<string, string>)[name] };
}

// --- validator ------------------------------------------------------------------------------

export function validate(value: unknown, schema: Schema, path = '$'): string[] {
  const errors: string[] = [];
  check(value, schema, path, errors);
  return errors;
}

function resolve(schema: Schema): Schema {
  const target = schema.$ref;
  if (typeof target !== 'string') return schema;
  if (!target.startsWith('#/$defs/')) throw new Error(`Unsupported $ref ${target}`);
  const resolved = (CONTENT_SCHEMA.$defs as Record<string, Schema>)[target.slice(8)];
  if (!resolved) throw new Error(`Unknown $ref ${target}`);
  return resolved;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function check(value: unknown, rawSchema: Schema, path: string, errors: string[]): void {
  const schema = resolve(rawSchema);
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as Schema[]).filter((option) => {
      const trial: string[] = [];
      check(value, option, path, trial);
      return trial.length === 0;
    });
    if (matches.length !== 1) {
      const tag = ['kind', 'type']
        .map((k) => (value as Record<string, unknown> | null)?.[k])
        .find((v) => typeof v === 'string');
      errors.push(`${path}: matches ${matches.length} variants${tag ? ` (tag "${tag}")` : ''}`);
      // Report the closest variant's problems to make the failure actionable.
      const closest = (schema.oneOf as Schema[]).find((option) => {
        const props = option.properties as Record<string, Schema> | undefined;
        return tag && props && ['kind', 'type'].some((k) => props[k]?.const === tag);
      });
      if (closest) check(value, closest, path, errors);
    }
    return;
  }
  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`);
    return;
  }
  const expected = schema.type as string | undefined;
  const actual = typeOf(value);
  if (expected && !(actual === expected || (expected === 'number' && actual === 'integer'))) {
    errors.push(`${path}: expected ${expected}, got ${actual}`);
    return;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      errors.push(`${path}: shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      errors.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      errors.push(`${path}: below ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      errors.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) =>
      check(item, schema.items as Schema, `${path}[${index}]`, errors),
    );
  }
  if (actual === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) errors.push(`${path}: missing required "${key}"`);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key in properties) check(child, properties[key] as Schema, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false)
        errors.push(`${path}: unexpected property "${key}"`);
      else if (typeof schema.additionalProperties === 'object')
        check(child, schema.additionalProperties as Schema, `${path}.${key}`, errors);
    }
  }
}
