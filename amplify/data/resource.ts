import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Phase 1-3 schema (docs/DATA_MODEL.md): ParentProfile, ChildProfile,
 * CompanionProfile, and the Phase 3 adventure-engine models (AdventureSession,
 * AdventureAction, SkillEvidence, SkillProgress, WorldChange). All models use
 * owner authorization, so `.list()`/`.get()` calls from the client are
 * already scoped to the authenticated parent's own records — the owner is
 * always the signed-in parent (CLAUDE.md section 10), since children act
 * inside the parent's authenticated session rather than authenticating
 * themselves. IslandLocation and AdventureTemplate/AdventureStepDefinition
 * remain content authored in source control (see
 * src/features/island/locations.ts and src/features/adventures/content/),
 * per DATA_MODEL.md's note to prefer that over a DB model for MVP.
 * @see https://docs.amplify.aws/react/build-a-backend/data/
 */
const schema = a.schema({
  AgeBand: a.enum(['SPROUT', 'PATHFINDER', 'EXPLORER']),
  ReadingMode: a.enum(['VOICE_FIRST', 'READ_ALONG', 'INDEPENDENT']),

  ParentProfile: a
    .model({
      displayName: a.string().required(),
      timezone: a.string(),
      childProfiles: a.hasMany('ChildProfile', 'parentProfileId'),
    })
    .authorization((allow) => [allow.owner()]),

  ChildProfile: a
    .model({
      parentProfileId: a.id().required(),
      parentProfile: a.belongsTo('ParentProfile', 'parentProfileId'),
      nickname: a.string().required(),
      ageBand: a.ref('AgeBand').required(),
      avatarKey: a.string().required(),
      interests: a.string().array(),
      readingMode: a.ref('ReadingMode').required(),
      sessionMinutes: a.integer().required(),
      active: a.boolean().required().default(true),
      companionProfile: a.hasOne('CompanionProfile', 'childProfileId'),
      adventureSessions: a.hasMany('AdventureSession', 'childProfileId'),
      skillEvidence: a.hasMany('SkillEvidence', 'childProfileId'),
      skillProgress: a.hasMany('SkillProgress', 'childProfileId'),
      worldChanges: a.hasMany('WorldChange', 'childProfileId'),
    })
    .authorization((allow) => [allow.owner()]),

  CompanionType: a.enum(['CHATTY_PARROT']),

  CompanionProfile: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      companionType: a.ref('CompanionType').required(),
      displayName: a.string().required(),
      lastGreetingAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),

  SessionStatus: a.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'SAFETY_STOPPED']),
  Correctness: a.enum(['CORRECT', 'INCORRECT', 'PARTIAL', 'NOT_APPLICABLE']),

  AdventureSession: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      templateSlug: a.string().required(),
      templateVersion: a.integer().required(),
      status: a.ref('SessionStatus').required(),
      currentStepId: a.string().required(),
      startedAt: a.datetime().required(),
      completedAt: a.datetime(),
      lastActivityAt: a.datetime().required(),
      actions: a.hasMany('AdventureAction', 'sessionId'),
    })
    .authorization((allow) => [allow.owner()]),

  AdventureAction: a
    .model({
      sessionId: a.id().required(),
      session: a.belongsTo('AdventureSession', 'sessionId'),
      stepId: a.string().required(),
      actionType: a.string().required(),
      normalizedAnswer: a.string(),
      correctness: a.ref('Correctness').required(),
      hintLevel: a.integer().required().default(0),
      attemptNumber: a.integer().required(),
    })
    .authorization((allow) => [allow.owner()]),

  SkillEvidence: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      sessionId: a.string().required(),
      learningObjectiveCode: a.string().required(),
      evidenceType: a.string().required(),
      result: a.ref('Correctness').required(),
      supportLevel: a.integer().required(),
      observedAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.owner()]),

  SkillProgress: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      learningObjectiveCode: a.string().required(),
      exposureCount: a.integer().required().default(0),
      independentSuccessCount: a.integer().required().default(0),
      supportedSuccessCount: a.integer().required().default(0),
      recentLevel: a.string(),
      lastPracticedAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),

  WorldChange: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      locationSlug: a.string().required(),
      changeType: a.string().required(),
      changeKey: a.string().required(),
      payload: a.json(),
      sourceSessionId: a.string(),
      createdAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
