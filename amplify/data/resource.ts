import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Phase 1 + 2 schema (docs/DATA_MODEL.md): ParentProfile, ChildProfile, and
 * CompanionProfile. All three use owner authorization, so `.list()`/`.get()`
 * calls from the client are already scoped to the authenticated parent's own
 * records. IslandLocation, WorldChange, and AdventureSession are deferred:
 * Phase 2 locations are static content and Phase 2 has no real adventures
 * yet to produce world changes or sessions (see docs/ROADMAP.md Phase 3).
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
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
