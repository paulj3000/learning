import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { CHATTY_SYSTEM_PROMPT } from './chattyPersona';
import { claimCoopSlot } from '../functions/claim-coop-slot/resource';

/**
 * Phase 1-4 schema (docs/DATA_MODEL.md): ParentProfile, ChildProfile,
 * CompanionProfile, the Phase 3 adventure-engine models (AdventureSession,
 * AdventureAction, SkillEvidence, SkillProgress, WorldChange), and the
 * Phase 4 AI-companion models (AIInteractionAudit, SafetyEvent) plus the
 * `generateCompanionTurn` AI generation route. Every model uses owner
 * authorization, so `.list()`/`.get()` calls from the client are already
 * scoped to the authenticated parent's own records — the owner is always
 * the signed-in parent (CLAUDE.md section 10), since children act inside
 * the parent's authenticated session rather than authenticating
 * themselves. IslandLocation and AdventureTemplate/AdventureStepDefinition
 * remain content authored in source control (see
 * src/features/island/locations.ts and src/features/adventures/content/),
 * per DATA_MODEL.md's note to prefer that over a DB model for MVP.
 *
 * `ParentProfile`, `ChildProfile`, `AdventureSession`, `SkillProgress`, and
 * `WorldChange` additionally carry `allow.group('Admins').to(['read'])`
 * (docs/AUTHORIZATION_REVIEW.md section 4.3, CLAUDE.md section 2's
 * Administrator role): a second, independent authorization rule that lets
 * a Cognito `Admins`-group member `.list()`/`.get()` every parent's/child's
 * record, not just their own, for the read-only `src/features/admin/`
 * dashboard (`docs/DATA_MODEL.md`'s "admin read only when explicitly
 * required"). Deliberately narrow: `CompanionProfile`, `StoryArtifact`,
 * `AIInteractionAudit`, and `SafetyEvent` are NOT admin-readable here —
 * those carry AI-narrated or free-text-adjacent content and belong to the
 * still-unbuilt safety-review admin workflow this phase does not attempt
 * (see `docs/IMPLEMENTATION_STATUS.md`).
 * @see https://docs.amplify.aws/react/build-a-backend/data/
 * @see https://docs.amplify.aws/react/ai/concepts/generation-routes/
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
    .authorization((allow) => [allow.owner(), allow.group('Admins').to(['read'])]),

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
      /**
       * Parent-facing AI kill switch (docs/ROADMAP.md Phase 7: "controls for
       * AI, voice, session time, and retention"). When false,
       * `requestCompanionTurn` (src/features/companion/api.ts) never calls
       * the Bedrock route at all and returns authored fallback content
       * directly — this is a stronger guarantee than relying on the
       * existing validation/fallback pipeline, since it means no child data
       * leaves the app for that family until a parent turns AI back on.
       *
       * Deliberately NOT `.required()`: `.default()` only applies to rows
       * created after this field was added, not to rows that already
       * existed in the table. A required field with no stored value makes
       * AppSync null out the *entire* list item (GraphQL non-null
       * propagation), not just the field — every call site must treat
       * missing/null as "on" (`?? true`).
       */
      aiEnabled: a.boolean().default(true),
      companionProfile: a.hasOne('CompanionProfile', 'childProfileId'),
      adventureSessions: a.hasMany('AdventureSession', 'childProfileId'),
      skillEvidence: a.hasMany('SkillEvidence', 'childProfileId'),
      skillProgress: a.hasMany('SkillProgress', 'childProfileId'),
      worldChanges: a.hasMany('WorldChange', 'childProfileId'),
      aiInteractionAudits: a.hasMany('AIInteractionAudit', 'childProfileId'),
      safetyEvents: a.hasMany('SafetyEvent', 'childProfileId'),
      storyArtifacts: a.hasMany('StoryArtifact', 'childProfileId'),
      childStoryProgress: a.hasMany('ChildStoryProgress', 'childProfileId'),
    })
    .authorization((allow) => [allow.owner(), allow.group('Admins').to(['read'])]),

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
  // --- Phase 20: Mastery Engine (docs/ROADMAP.md, src/features/mastery/) ---
  SkillStatus: a.enum(['LOCKED', 'INTRODUCED', 'DEVELOPING', 'PROFICIENT', 'MASTERED']),
  ErrorPattern: a.enum(['NONE', 'NEEDS_SUPPORT', 'INCONSISTENT', 'STALLED']),

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
      /**
       * Set only for a Phase 17 household co-op play-through (docs/DECISIONS.md
       * ADR-006). Links this child's own private `AdventureSession` to the
       * shared `CoopSession` both children joined, without making
       * `CoopSession` a record of who learned what — this child's own
       * `AdventureAction`/`SkillEvidence` trail is unaffected and stays
       * attributed only to them. Deliberately not `.required()`: every
       * `AdventureSession` row created before this phase has no value for
       * it (same already-populated-table precedent as `ChildProfile.aiEnabled`
       * above).
       */
      coopSessionId: a.string(),
    })
    .authorization((allow) => [allow.owner(), allow.group('Admins').to(['read'])]),

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
      /**
       * Phase 22 Interaction Engine "duration capture" deliverable —
       * milliseconds from first presenting this step/interaction to this
       * attempt's submission. Optional: every caller before this phase
       * (the existing step types) does not measure or pass it.
       */
      durationMs: a.integer(),
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
      /** Phase 22 Interaction Engine "duration capture" deliverable, see `AdventureAction.durationMs`. */
      durationMs: a.integer(),
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
      /**
       * Phase 20 Mastery Engine status, computed by
       * `src/features/mastery/status.ts` and written by `upsertSkillProgress`
       * on every evidence event. Was declared but never written before this
       * phase (an unused free-text field) — now the actual "per-skill
       * status" deliverable, typed against `SkillStatus` rather than a free
       * string. Field name kept as `recentLevel` rather than renamed to
       * `status`, since renaming an Amplify model field is a drop+add at
       * the DynamoDB layer, not a free rename, and this field already means
       * "this skill's most recently computed level."
       */
      recentLevel: a.ref('SkillStatus'),
      /**
       * Consecutive independent (unsupported) correct results, most recent
       * first — resets to 0 on any supported completion or incorrect/partial
       * result. Feeds both the MASTERED threshold and `errorPattern` below.
       */
      consecutiveIndependentCorrect: a.integer().required().default(0),
      /** Phase 20 lightweight error-pattern signal, see `errorPattern.ts`. */
      errorPattern: a.ref('ErrorPattern'),
      lastPracticedAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner(), allow.group('Admins').to(['read'])]),

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
    .authorization((allow) => [allow.owner(), allow.group('Admins').to(['read'])]),

  // --- Phase 4: Safe AI Companion (docs/AI_AND_CHILD_SAFETY.md) ---

  CompanionEmotion: a.enum(['CHEERFUL', 'CURIOUS', 'CALM', 'ENCOURAGING']),
  CompanionIntent: a.enum(['NARRATE', 'ASK', 'HINT', 'CELEBRATE', 'REDIRECT']),
  SafetyDisposition: a.enum(['ALLOW', 'REDIRECT', 'STOP']),

  /** Matches AI_AND_CHILD_SAFETY.md's `CompanionTurn` structured-response example. */
  CompanionChoice: a.customType({
    id: a.string().required(),
    label: a.string().required(),
  }),

  /**
   * `emotion`/`intent`/`safetyDisposition` are plain strings here, not
   * `a.ref()` enums, even though `CompanionEmotion`/`CompanionIntent`/
   * `SafetyDisposition` exist as schema enums (used for the *argument*
   * side of `generateCompanionTurn` below, and for our own code's writes
   * to `AIInteractionAudit`/`SafetyEvent`). Declaring them as enums here
   * too made AppSync reject the entire generation response whenever
   * Bedrock's structured output didn't match the enum literal exactly —
   * confirmed live: GraphQL nulled out the whole `CompanionTurn` object
   * (including a possibly-fine `spokenText`) on an enum mismatch, with no
   * visibility into what the model actually returned (no query logging
   * configured). `src/features/companion/schema.ts`'s
   * `validateCompanionTurn` already re-validates these exact same values
   * at the application layer (CLAUDE.md section 13: "Validate all
   * external and AI-generated data at runtime") — that TypeScript check is
   * the real safety gate, so the GraphQL-level enum constraint was
   * redundant and, in practice, less safe than a plain string here.
   */
  CompanionTurn: a.customType({
    spokenText: a.string().required(),
    emotion: a.string().required(),
    intent: a.string().required(),
    choices: a.ref('CompanionChoice').array(),
    safetyDisposition: a.string().required(),
  }),

  /**
   * Single request-response AI generation route (CLAUDE.md section 7 —
   * structured generation, never a free-form chat route). The systemPrompt
   * is fixed (chattyPersona.ts); everything call-specific is a typed
   * argument, so prompt-context minimization
   * (docs/AI_AND_CHILD_SAFETY.md) is enforced by the schema itself: there
   * is no field here for a parent email, legal name, exact birthdate, or
   * raw free-text history. `src/features/companion/schema.ts` re-validates
   * every response against this same shape at runtime before it reaches a
   * child (CLAUDE.md section 13: "Validate all external and AI-generated
   * data at runtime").
   */
  generateCompanionTurn: a
    .generation({
      aiModel: a.ai.model('Claude Haiku 4.5'),
      systemPrompt: CHATTY_SYSTEM_PROMPT,
      inferenceConfiguration: { temperature: 0.4, maxTokens: 300 },
    })
    .arguments({
      ageBand: a.ref('AgeBand').required(),
      intent: a.ref('CompanionIntent').required(),
      stepSummary: a.string().required(),
      maxLength: a.integer().required(),
      learningObjectiveCode: a.string(),
      hintLevel: a.integer(),
      authoredBaseText: a.string(),
      allowedChoiceIds: a.string().array(),
    })
    .returns(a.ref('CompanionTurn'))
    .authorization((allow) => [allow.authenticated()]),

  ValidationStatus: a.enum(['VALID', 'INVALID_SCHEMA', 'INVALID_CONTENT', 'ERROR']),

  /** Metadata only, per DATA_MODEL.md's AIInteractionAudit — never raw child text. */
  AIInteractionAudit: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      sessionId: a.string(),
      stepId: a.string(),
      routeName: a.string().required(),
      promptTemplateVersion: a.integer().required(),
      modelId: a.string().required(),
      inputCategory: a.string().required(),
      outputSchemaVersion: a.integer().required(),
      validationStatus: a.ref('ValidationStatus').required(),
      safetyDisposition: a.ref('SafetyDisposition').required(),
      fallbackUsed: a.boolean().required(),
      latencyMs: a.integer(),
      createdAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.owner()]),

  SafetyEventSeverity: a.enum(['LOW', 'MEDIUM', 'HIGH']),
  SafetyEventSource: a.enum(['INPUT', 'OUTPUT', 'SYSTEM']),
  SafetyEventReviewStatus: a.enum(['OPEN', 'REVIEWED', 'DISMISSED']),

  SafetyEvent: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      sessionId: a.string(),
      category: a.string().required(),
      severity: a.ref('SafetyEventSeverity').required(),
      source: a.ref('SafetyEventSource').required(),
      actionTaken: a.string().required(),
      reviewStatus: a.ref('SafetyEventReviewStatus').required(),
      createdAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.owner()]),

  // --- Phase 5: Storykeeper Castle (docs/ROADMAP.md) ---

  /**
   * The assembled, saved collaborative story from one Storykeeper Castle
   * play-through (docs/ROADMAP.md Phase 5: "generated story artifact with
   * parent-controlled retention"). `scenes` is `a.json()` for the same
   * reason `WorldChange.payload` already is: every scene's text already
   * passed `validateCompanionTurn` before it was ever shown to the child
   * (src/features/adventures/useAdventureSession.ts), so this is our own
   * already-validated write, not untrusted input at this layer. Retention
   * is parent-controlled by ordinary owner-authorized delete from
   * src/routes/StoryKeepsakes.tsx — no auto-expiry policy yet (see
   * "Decisions pending: retention schedule" in IMPLEMENTATION_STATUS.md).
   */
  StoryArtifact: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      sessionId: a.string().required(),
      templateSlug: a.string().required(),
      title: a.string().required(),
      scenes: a.json().required(),
      createdAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.owner()]),

  // --- Phase 12: Story Engine (docs/ROADMAP.md, docs/DATA_MODEL.md ChildStoryProgress) ---

  /**
   * Resumable, multi-session progress through one authored long-form story
   * (`StoryDefinition`, content-authored in source control, same "not a DB
   * model" precedent as `AdventureTemplate`/`AdventureStepDefinition` — see
   * src/features/story/content/). Distinct from the single-session
   * `AdventureSession`: a story spans many chapters, each of which may embed
   * one or more `AdventureSession`s of its own. `storyFlags` is bounded,
   * authored-value JSON only (docs/DATA_MODEL.md: "never free-form child
   * text") — e.g. `{ trackDirection: 'cave' }` — read back by later chapters
   * to select authored narrative branches, never evaluated as arbitrary
   * script.
   */
  ChildStoryProgress: a
    .model({
      childProfileId: a.id().required(),
      childProfile: a.belongsTo('ChildProfile', 'childProfileId'),
      storyId: a.string().required(),
      currentChapterId: a.string().required(),
      completedChapterIds: a.string().array(),
      storyFlags: a.json(),
      startedAt: a.datetime().required(),
      lastPlayedAt: a.datetime().required(),
      completedAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),

  // --- Phase 17: Household Co-Presence (docs/DECISIONS.md ADR-006, docs/DATA_MODEL.md CoopSession) ---

  CoopSessionStatus: a.enum(['ACTIVE', 'COMPLETED', 'ABANDONED']),

  /**
   * Two `ChildProfile`s under the same `ParentProfile` sharing one
   * adventure instance (household-only for v1; cross-family pairing is
   * out of scope per ADR-006). `hostParentProfileId` is the owner-auth
   * field rather than the implicit `owner` field every other model uses,
   * because both participating children act under that one parent's
   * authenticated session (ADR-006's "why household-only is an
   * architectural constraint" section) — `.identityClaim('sub')` pins it
   * to the stable Cognito `sub` (rather than the default compound
   * `sub::username` owner string) so `amplify/functions/claim-coop-slot`
   * can compare it directly against the Lambda's own AppSync identity
   * context without reproducing Amplify's default owner-string format.
   *
   * `sharedState` holds `{ slots: Record<slotKey, childProfileId>,
   * presence: string[] }`, written only by `claimCoopSlot` (slots — an
   * atomic, conflict-resolved server write, never a direct client write)
   * and by `src/features/coop/api.ts`'s `setCoopPresence` (presence — a
   * best-effort, last-write-wins join/leave signal; ADR-006 explicitly
   * excludes continuous cursor/telemetry-level presence from v1, so no
   * stronger guarantee is needed there). Presence is intentionally not
   * its own stored model (DATA_MODEL.md) — it rides inside this same
   * JSON field instead, changes to which every participant observes
   * through the model's own generated `onUpdate` subscription.
   */
  CoopSession: a
    .model({
      /**
       * Deliberately NOT `.required()`, even though it is always set in
       * practice: the client never supplies this field itself (see
       * `startCoopSession`, src/features/coop/api.ts) — AppSync's owner
       * authorization resolver auto-populates it from the caller's
       * identity on create. A `.required()` field would force every
       * `CoopSession.create()` call site to pass a value the server is
       * going to overwrite anyway.
       */
      hostParentProfileId: a.string(),
      templateSlug: a.string().required(),
      templateVersion: a.integer().required(),
      participantChildProfileIds: a.string().array().required(),
      status: a.ref('CoopSessionStatus').required(),
      sharedState: a.json(),
      startedAt: a.datetime().required(),
      completedAt: a.datetime(),
      lastActivityAt: a.datetime().required(),
    })
    .authorization((allow) => [allow.ownerDefinedIn('hostParentProfileId').identityClaim('sub')]),

  /**
   * The one privileged write in this phase: atomically claims a
   * coop-eligible step's shared slot (docs/ADVENTURE_ENGINE.md "Co-op
   * sessions" — `NUMBER_INPUT`/`ORDERING`/`MATCHING`/shared-construction
   * `WORLD_CHANGE` steps only). Backed by a function rather than a plain
   * client update because "first write wins, second write rejected
   * server-side without an error" needs a real conditional write — the
   * generated `CoopSession.update()` mutation has no such guarantee, and
   * bypassing AppSync's own authorization here means
   * `amplify/functions/claim-coop-slot/handler.ts` re-checks
   * host/participant/status itself before ever touching DynamoDB.
   * `allow.authenticated()` (not `allow.owner()`) because a custom
   * mutation has no model-level owner field of its own to scope by — same
   * precedent as `generateCompanionTurn` above.
   */
  claimCoopSlot: a
    .mutation()
    .arguments({
      coopSessionId: a.id().required(),
      slotKey: a.string().required(),
      childProfileId: a.id().required(),
    })
    .returns(a.ref('CoopSession'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(claimCoopSlot)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
