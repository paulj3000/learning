# Implementation Status

## Current state

Phase 0 foundation, Phase 1 (parent accounts and child profiles), Phase 2
(island shell), Phase 3 (deterministic adventure engine), Phase 4 (safe AI
companion), Phase 5 (Storykeeper Castle), and Phase 6 (Wonderwild Forest)
are complete. Pathfinder-band children can now play a full adventure in
all three MVP locations: "Repair the Moonlight Bridge" in Pirate Builder
Bay, "The Storykeeper's Tale" in Storykeeper Castle, and "Buzz and the
Waggle Dance" in Wonderwild Forest. Storykeeper Castle is a bounded
collaborative story where the child picks a hero and setting from curated
options, Chatty narrates a short AI-varied scene for each choice, the
child answers a comprehension check and orders the story's beats, and the
finished story is saved as a parent-viewable, parent-deletable
`StoryArtifact`. Wonderwild Forest is a bounded curiosity adventure: the
child picks a question from a curated Wonder Wall (only "why do bees
dance?" has a built adventure so far; every other question gets a calm,
deterministic redirect into that same adventure rather than a dead end),
shrinks into a beehive with an AI-narrated (but authored-text-grounded)
scene, then observes and answers evidence-based questions about the
honeybee waggle dance anchored to fixed, cited facts
(`docs/CONTENT_SOURCES.md`). All three adventures get hints when stuck
(optionally AI-phrased by Chatty the Parrot, with an authored fallback),
see Chatty celebrate correct answers, and end in a persistent world change
on the island. Every AI response is schema- and content-validated before
it can reach a child, and falls back to authored copy on any failure;
correctness and step transitions remain 100% deterministic and are never
touched by AI — Storykeeper Castle's comprehension/sequencing steps and
Wonderwild Forest's observation/comprehension steps are deliberately
anchored to fixed, authored text rather than to any AI-generated scene, so
this holds even though both locations "run on" AI narration for part of
their presentation.

`generateCompanionTurn` has been confirmed working against **live Amazon
Bedrock** in this session (not just structurally deployed) — a real signed-in
parent, a real child profile, and a real HINT-intent call all the way through
to a validated `CompanionTurn` and a written `AIInteractionAudit` row. Getting
there required diagnosing and fixing two real upstream Amplify AI Kit gaps;
both are documented in detail in "Known risks/TODOs" and in code comments at
their fix sites (`amplify/backend.ts`, `amplify/data/resource.ts`), since
neither is obvious from the Amplify docs and both will matter again if the
Bedrock model choice ever changes.

## Current phase

Phase 6 — Wonderwild Forest: complete.

## Completed

- Product concept documented.
- Initial architecture documented.
- Initial domain model documented.
- AI and child-safety requirements documented.
- MVP roadmap documented.
- React + Vite + strict TypeScript scaffold (`src/`, `index.html`, `vite.config.ts`,
  `tsconfig*.json`).
- Amplify Gen 2 backend scaffold (`amplify/backend.ts`) with no resources defined yet;
  auth and data are deferred to Phase 1 by design.
- oxlint (linting) and Prettier (formatting) configured.
- Vitest + React Testing Library configured, with a smoke test for the application shell.
- Playwright configured, with a smoke end-to-end test for the home route.
- GitHub Actions CI workflow running typecheck, lint, format check, unit tests, build,
  and end-to-end tests.
- Base design tokens (`src/styles/tokens.css`) and an accessible application shell
  (routing, error boundary, skip link) with a placeholder home route. No island map,
  auth, or adventure features.
- Repository folder skeleton for `src/features/*`, `src/lib`, `src/components` per
  `CLAUDE.md` section 8 (empty, `.gitkeep` placeholders only).
- Local development and Amplify sandbox setup documented in `README.md`.
- `amplify.yml` build spec added at repo root so Amplify Hosting builds the frontend
  (`dist/`) and runs `ampx pipeline-deploy` for the backend.
- `amplify.yml` caching tightened: `npm install` now points at a repo-local
  `.npm-cache` directory (via `npm config set cache`) and runs with
  `--prefer-offline`, and that directory is added alongside `node_modules` to the
  Amplify Hosting `cache.paths`. Amplify was already caching `node_modules`, but
  `node_modules` cache-misses (e.g. any lockfile change) previously forced a full
  re-download from the npm registry on every build; caching the npm download cache
  too means those installs resolve from local disk instead.
- **Phase 1 — Auth backend** (`amplify/auth/resource.ts`): Cognito email/password
  login for parent accounts only (ADR-001); no child identities.
- **Phase 1 — Data backend** (`amplify/data/resource.ts`): `ParentProfile` and
  `ChildProfile` models per `docs/DATA_MODEL.md`, both owner-authorized so
  `.list()`/`.get()` are automatically scoped to the signed-in parent. Wired into
  `amplify/backend.ts` alongside auth.
- **Phase 1 — Auth UI** (`src/features/auth/`): custom sign-up, email confirmation
  (with resend), sign-in, and forgot/reset-password forms built directly against
  `aws-amplify/auth` (no new dependency); an `AuthProvider`/`useAuth` context
  backed by `getCurrentUser` and a Hub listener; a `RequireParent` route guard
  with distinct loading/unauthenticated/"backend not connected" states; Cognito
  errors mapped to plain-language, readable-aloud copy (`errors.ts`).
- **Phase 1 — Child profile UI** (`src/features/child-profile/`): create/edit
  form (nickname, age band, avatar, up to 5 curated interests, reading mode,
  session-minute bounds per age band from CLAUDE.md section 3), a dashboard list
  with deactivate/reactivate and "Enter island", and a `ParentGate` arithmetic
  challenge component used before deactivating a profile and before leaving
  child mode.
- **Phase 1 — Routes** (`src/routes/`, wired in `src/app/AppRoutes.tsx`):
  `/sign-up`, `/confirm`, `/sign-in`, `/forgot-password`, `/parent` (dashboard),
  `/parent/children/new`, `/parent/children/:childId/edit`, and a placeholder
  `/island/:childId` child-mode shell establishing the parent/child route split
  ahead of Phase 2's real island content. `Home.tsx` rewritten as a landing page
  with sign-up/sign-in CTAs (or a calm "backend not connected" notice when
  `amplify_outputs.json` is absent).
- **Phase 1 — Amplify config loading** (`src/lib/amplify-config.ts`): loads
  `amplify_outputs.json` via `import.meta.glob` (zero-match-safe) instead of a
  static import, since that file is gitignored and does not exist in CI or in a
  fresh checkout; `isAmplifyConfigured` is `false` when it's missing, so
  `dev`/`build`/`test`/`test:e2e` all still work with no deployed backend.
  **Fixed after initial Phase 1 delivery:** `Amplify.configure()` now runs as a
  side effect of importing this module, rather than via an exported function a
  caller had to remember to invoke. The original version required `App.tsx` to
  call `configureAmplify()`, but ES module evaluation order meant
  `src/lib/data-client.ts`'s `generateClient()` always ran first regardless of
  route, breaking every screen that touched the data client (surfaced as
  "Client could not be generated..." on `/parent`). `data-client.ts` now
  imports `amplify-config.ts` directly, immediately before calling
  `generateClient()`, which guarantees correct ordering no matter what else is
  going on in the wider import graph.
- Unit/component tests added alongside every Phase 1 module (validators, forms,
  `ParentGate`, `ChildProfileForm`, `ChildProfileList`); `App.test.tsx` and
  `e2e/smoke.spec.ts` updated for the new landing page and extended with
  render-only checks for `/sign-up` and `/sign-in`.
- **Phase 2 — Data backend** (`amplify/data/resource.ts`): added
  `CompanionProfile` (owner-authorized, same pattern as `ChildProfile`), plus
  a `hasOne`/`belongsTo` relationship between `ChildProfile` and
  `CompanionProfile`. `cosmeticState` from `docs/DATA_MODEL.md` was
  intentionally left off the model — it's marked optional there and nothing
  in Phase 2 reads or writes it yet.
- **Phase 2 — Island shell** (`src/features/island/`, new): `locations.ts`
  (static content for the three MVP locations — Pirate Builder Bay,
  Wonderwild Forest, Storykeeper Castle — since `docs/DATA_MODEL.md`'s
  `IslandLocation` is "content-managed reference data" for an admin role that
  doesn't exist yet); `events.ts` (a small curated, date-deterministic "today
  on the island" message, no AI/backend); `api.ts`
  (`getOrCreateCompanionProfile`/`getCompanionProfile`, same shape as the
  Phase 1 child-profile API); `IslandLayout.tsx` (shared header/nav +
  parent-gated exit for every child-mode screen, reusing the existing
  `ParentGate` component rather than duplicating it); `CompanionIntro.tsx`
  (first-visit "Meet Chatty the Parrot" companion-selection card).
- **Phase 2 — Routes**: replaced the Phase 1 `ChildModePlaceholder` with
  `WelcomeHarbor` (`/island/:childId` — companion intro on first visit, then
  the map, today's event, and a log link, matching
  `docs/PRODUCT_VISION.md`'s description of Welcome Harbor as the map/event/
  companion/log hub), `IslandLocationPage`
  (`/island/:childId/locations/:locationSlug` — static, described, not yet
  playable), and `AdventureLog` (`/island/:childId/log` — empty-state shell;
  real entries arrive with Phase 3's adventure sessions).
- Unit/component tests added for the new island module (`events.test.ts`,
  `CompanionIntro.test.tsx`).
- **Phase 3 — Engine** (`src/features/adventures/engine/`): concrete TypeScript
  types for the `docs/ADVENTURE_ENGINE.md` step contract (`types.ts`); a pure
  `validateStepAnswer` covering all 8 answerable/non-answerable step types
  (`validators.ts`); a pure `getNextStepId` that reads a step's authored
  `TransitionRule`s and throws on an unauthored path rather than silently
  guessing (`transitions.ts`); and the 5-level hint ladder (`hints.ts`,
  `nextHintLevel`/`isGuidedCompletion`/`getHintText`). No AI is involved
  anywhere in this layer — every decision is a plain comparison against
  authored content, per `CLAUDE.md` section 7.
- **Phase 3 — Adventure content** (`src/features/adventures/content/`): a
  small static `LEARNING_OBJECTIVES` list, and the full "Repair the Moonlight
  Bridge" `AdventureDefinition` (`repairTheMoonlightBridge.ts`) specified in
  `docs/ADVENTURE_ENGINE.md` — inspect the bridge, count missing planks,
  choose the plank bundle that sums to the total, order planks shortest to
  longest, three repair instructions, place the final plank, persist a
  `BRIDGE_REPAIRED` world change, then complete. Kept as source-controlled
  content rather than a DB model, per `DATA_MODEL.md`'s note for
  `AdventureStepDefinition` (same approach Phase 2 used for `IslandLocation`).
  **Scoped to `ageBands: ['PATHFINDER']` only** — see "Known risks/TODOs".
- **Phase 3 — Data backend** (`amplify/data/resource.ts`): five new
  owner-authorized models — `AdventureSession`, `AdventureAction`,
  `SkillEvidence`, `SkillProgress`, `WorldChange` — plus `SessionStatus` and
  `Correctness` enums, wired to `ChildProfile` with the same
  `hasMany`/`belongsTo` pattern already used for `CompanionProfile`.
  `difficultyState` from `DATA_MODEL.md`'s `AdventureSession` shape was
  intentionally dropped (see "Known risks/TODOs").
- **Phase 3 — API layer** (`src/features/adventures/api.ts`): session
  start/resume/advance/complete, action + skill-evidence recording,
  `upsertSkillProgress` (accumulates exposure/independent/supported counts
  per child+objective rather than overwriting), and `recordWorldChangeOnce`
  (idempotent by `changeKey`, so replaying an adventure never duplicates a
  world change). Same list-then-filter, throw-on-missing-data style as
  `child-profile/api.ts`/`island/api.ts`.
- **Phase 3 — Orchestration** (`src/features/adventures/useAdventureSession.ts`):
  a hook that loads or creates the session, validates each answer, escalates
  the hint ladder, auto-persists the `WORLD_CHANGE` step and auto-completes
  the session on reaching `COMPLETE`, and keeps every bit of this logic out
  of components per `CLAUDE.md` section 13.
- **Phase 3 — UI** (`src/features/adventures/steps/`, `AdventureRunner.tsx`,
  `HintPanel.tsx`, `src/routes/AdventurePage.tsx`): renderer components for
  the step types this adventure actually uses (`NarrativeStep`, `ChoiceStep`,
  `NumberInputStep`, `OrderingStep` — up/down buttons, not drag-and-drop, so
  it stays keyboard/tablet accessible with no new dependency); a new route
  `/island/:childId/locations/:locationSlug/adventures/:templateSlug`.
  `MATCHING`/`SHORT_RESPONSE`/`CREATIVE_CHOICE`/`REFLECTION` have engine-level
  validators but no renderer yet — no authored content needs them until a
  later adventure.
- **Phase 4 — AI generation route** (`amplify/data/resource.ts`): a
  `generateCompanionTurn` Amplify AI Kit `a.generation()` route backed by
  Bedrock (`Claude Haiku 4.5`), matching CLAUDE.md section 7's pipeline —
  structured generation, never a free-form chat route. Its `.arguments()`
  are the only per-call input (`ageBand`, `intent`, `stepSummary`,
  `maxLength`, and optional `learningObjectiveCode`/`hintLevel`/
  `authoredBaseText`/`allowedChoiceIds`); the system prompt is fixed, so
  prompt-context minimization (docs/AI_AND_CHILD_SAFETY.md) is enforced by
  the schema itself — there is no field for parent email, legal name,
  exact birthdate, or raw free text. Returns a `CompanionTurn` custom type
  matching `AI_AND_CHILD_SAFETY.md`'s structured-response example
  (`spokenText`, `emotion`, `intent`, `choices?`, `safetyDisposition`).
  Authorized via `allow.authenticated()` (custom operations have no owner
  field to scope by). Also added: `AIInteractionAudit` and `SafetyEvent`
  models (DATA_MODEL.md shapes, owner-authorized like every other Phase
  1-3 model) and a `ValidationStatus` enum.
- **Phase 4 — Chatty persona** (`amplify/data/chattyPersona.ts`): the
  fixed system prompt for `generateCompanionTurn`, encoding CLAUDE.md
  section 6 (warm/curious/playful/concise, AI-powered island magic, never
  claims to be human/conscious) and every boundary in
  `AI_AND_CHILD_SAFETY.md` "Companion boundaries" (no requests for contact
  info, no secrecy, no dependency pressure, no unsafe topics, redirect to
  a trusted adult when something is off). Exports
  `CHATTY_PERSONA_VERSION`, written to every audit row as
  `promptTemplateVersion` so a safety review can tell which prompt
  produced a given interaction. Per CLAUDE.md section 7 ("No single model
  instruction is considered sufficient"), this prompt is one layer among
  several — it is never trusted on its own.
- **Phase 4 — Validation and fallback pipeline**
  (`src/features/companion/`): `schema.ts` defines the `CompanionTurn`
  types independently of the generated Amplify `Schema` (the AI response
  is treated as `unknown` until validated — CLAUDE.md section 13) and
  `validateCompanionTurn` checks structure, that `intent` matches what was
  requested (or has escalated to `REDIRECT`, which is always allowed),
  spoken-text length against the caller's age-banded limit, and that any
  offered `choices` are a subset of the caller-supplied
  `allowedChoiceIds` — the model can never invent an action ID.
  `src/lib/ai/contentSafety.ts` holds the reusable, heuristic URL and
  personal-information-request detectors used by that validator.
  `limits.ts` holds `MAX_SPOKEN_LENGTH_BY_AGE_BAND` (age-banded output
  limits, CLAUDE.md section 3). `fallback.ts` holds one authored,
  non-AI `CompanionTurn` per intent (CLAUDE.md section 7: "Every response
  must have a safe fallback authored in code"); a HINT fallback prefers
  the adventure's own authored hint text over the generic line when one
  is available. `api.ts`'s `requestCompanionTurn` ties it together: calls
  the route, validates the response, falls back to authored content on
  any error/invalid output/non-`ALLOW` safety disposition, and always
  resolves (never throws) so a companion turn is always safe to render.
  It also writes one `AIInteractionAudit` row per call (metadata only —
  route, prompt version, model ID, validation status, safety disposition,
  fallback flag, latency; never raw child or AI text) and, whenever the
  safety disposition is not `ALLOW`, one `SafetyEvent` row. Both writes
  are best-effort (swallowed on failure) so a logging problem can never
  block or hide a companion turn from the child.
- **Phase 4 — Companion UI** (`useCompanionTurn.ts`,
  `CompanionBubble.tsx`): a small state-machine hook
  (`idle`/`loading`/`ready`/`error`) around `requestCompanionTurn`, and a
  presentation component covering the loading, response, and fallback
  states from `docs/TESTING_STRATEGY.md` — a validation failure or a
  non-`ALLOW` disposition already becomes authored fallback content
  upstream, so it renders exactly like any other companion turn rather
  than as a distinct "invalid" state.
- **Phase 4 — Adventure wiring** (`useAdventureSession.ts`,
  `AdventureRunner.tsx`, `AdventurePage.tsx`): `useAdventureSession` now
  takes the child's `ageBand` and fires a `CELEBRATE` companion turn after
  any answer that resolves to `correct`, and a `HINT` companion turn
  (grounded in the authored hint text via `authoredBaseText`) whenever
  `requestHint` escalates the hint ladder. Both calls are fire-and-forget
  local UI state — they never gate or influence `submitAnswer`'s call
  into `getNextStepId`, so AI unavailability cannot block gameplay.
  `AdventureRunner` renders a `CompanionBubble` for the current companion
  turn. `AdventurePage` now fetches the child's profile (for `ageBand`),
  matching the pattern already used by `IslandLocationPage`.
- Unit tests for `contentSafety.ts`, `schema.ts`'s `validateCompanionTurn`
  (12 cases: valid turn, non-object, empty text, unknown emotion,
  intent/escalation rules, length limit, URL, personal-info request,
  disallowed/allowed choices), and `fallback.ts` (every fallback turn
  passes its own validator at the strictest age-band limit); component
  tests for `CompanionBubble` (idle/loading/error/AI/fallback/choices) and
  `useCompanionTurn` (idle -> loading -> ready, fallback surfaced as
  `ready`, unexpected throw surfaced as `error`).
- **Phase 3 — Location/log wiring**: `IslandLocationPage` now fetches the
  child's age band and this location's world changes, and shows "Start"/
  "Play again" when a template exists and the age band is supported, "not
  available for your age yet" otherwise, and swaps the decoration text once
  `BRIDGE_REPAIRED` exists. `AdventureLog` now lists real sessions
  (title/status/date) instead of only the Phase 2 empty state.
- Unit tests for the engine (`validators.test.ts`, `transitions.test.ts`,
  `hints.test.ts`) and content (`repairTheMoonlightBridge.test.ts` — a
  structural guard that every transition target exists and `COMPLETE` is
  reachable); component tests for `NumberInputStep`, `ChoiceStep`,
  `OrderingStep`, `HintPanel`. No new route-level tests, consistent with
  every existing route (`WelcomeHarbor`, etc.) having none — they need a live
  backend to exercise meaningfully.
- **Phase 5 — Data backend** (`amplify/data/resource.ts`): a `StoryArtifact`
  model (`childProfileId`, `sessionId`, `templateSlug`, `title`, `scenes`
  as `a.json()`, `createdAt`), owner-authorized like every other model, plus
  a `hasMany`/`belongsTo` link to `ChildProfile`. No new AI generation
  route: per the recommended, user-confirmed approach, scene narration
  reuses the existing Phase 4 `generateCompanionTurn` route with
  `intent: 'NARRATE'` rather than standing up a second Bedrock route and
  repeating Phase 4's IAM/enum-safety wiring.
- **Phase 5 — Companion layer** (`src/features/companion/useCompanionTurn.ts`):
  `request` now returns the resolved `CompanionTurnResult` (previously
  `Promise<void>`) so a caller can capture *which* scene text came back
  for a specific step, not just observe the hook's single shared `state`.
  Purely additive — every existing caller already discarded the return
  value (`void requestCompanion(...)`).
- **Phase 5 — Adventure content**
  (`src/features/adventures/content/theStorykeepersTale.ts`): "The
  Storykeeper's Tale", scoped to `ageBands: ['PATHFINDER']` (same
  first-adventure-per-location precedent as Phase 3's Bridge adventure) —
  meet Keeper Quill, pick a hero and a setting (`CREATIVE_CHOICE`, curated
  options only, no free text per `docs/AI_AND_CHILD_SAFETY.md`'s child
  input policy), a comprehension check and a sequencing/`ORDERING` step
  both anchored to a **fixed, authored** narrative line rather than to any
  AI-generated scene text (keeps correctness deterministic per CLAUDE.md
  section 7 no matter what Chatty narrates), a `REFLECTION` beat, a
  `WORLD_CHANGE` (`STORY_CREATED`/`FIRST_STORY_TOLD`), then `COMPLETE`.
  Needed zero changes to the engine itself — every step type it uses
  (`CREATIVE_CHOICE`, `REFLECTION` included) was already fully specified
  and validated by the Phase 3 engine. Three new learning objectives added
  to `learningObjectives.ts` (`creative-storytelling`,
  `reading-comprehension`, `sequencing`); registered in `content/index.ts`.
  `src/features/island/locations.ts` and `IslandLocationPage.tsx` needed
  **no changes** — they already generically pick up any adventure whose
  `locationSlug` matches and swap decoration text on a matching
  `WorldChange`; same for `AdventureLog.tsx`.
- **Phase 5 — Scene capture and story persistence**
  (`src/features/adventures/useAdventureSession.ts`,
  `src/features/adventures/api.ts`): on a `CREATIVE_CHOICE` answer, fires
  a fire-and-forget `NARRATE` companion request (same "never gates
  `getNextStepId`/`advance`" invariant as the existing HINT/CELEBRATE
  calls) and, on resolution, appends `{ stepId, text, source }` to a new
  `storyScenes` state array. When the adventure's `WORLD_CHANGE` step
  auto-advances, if `storyScenes` is non-empty it's saved as one
  `StoryArtifact` via the new `saveStoryArtifact` (not deduplicated like
  `recordWorldChangeOnce` — each play-through is a distinct new story, not
  a repeatable world state). `storyScenes` is returned from the hook.
  **Known timing gap**: if the narration request for the *last*
  `CREATIVE_CHOICE` step is still in flight when the child reaches
  `WORLD_CHANGE`, that scene can be missed from the saved artifact — same
  category of limitation as the existing in-memory hint-ladder note below,
  accepted for MVP given the several intervening steps' worth of natural
  delay in this adventure's authored flow.
- **Phase 5 — UI** (`src/features/adventures/AdventureRunner.tsx`,
  `src/features/adventures/steps/ReflectionStep.tsx`): `CREATIVE_CHOICE`
  reuses the existing `ChoiceStep` component as-is (it never referenced
  correctness); one new small `ReflectionStep` component (prompt +
  Continue, no speaker line, since a reflection beat is the child's own
  pause rather than a character's dialogue). The adventure's `complete`
  card now shows a "Your story" recap of every captured scene when
  `storyScenes` is non-empty.
- **Phase 5 — Parent-facing story keepsakes** (`src/routes/StoryKeepsakes.tsx`,
  new route `/parent/children/:childId/stories`): lists every saved
  `StoryArtifact` for a child (title, date, scene count and text) with a
  "Delete" button that reveals an inline "Are you sure? Delete / Cancel"
  confirmation before calling the new `deleteStoryArtifact` — this is the
  parent-controlled retention `docs/ROADMAP.md` calls for. Deliberately
  view-and-delete only, per the user-confirmed scope: no auto-expiry/
  retention-schedule setting, since that policy is still an open
  "Decisions pending" item and building one now would pull that decision
  forward. Linked from a new "Story keepsakes" entry per child card in
  `ChildProfileList.tsx`.
- Unit tests: `theStorykeepersTale.test.ts` (structural guard, same shape
  as `repairTheMoonlightBridge.test.ts`, plus checks that creative-choice
  steps offer curated options and that the comprehension check is anchored
  to authored content); `ReflectionStep.test.tsx`; `useCompanionTurn.test.ts`
  updated for the new `request` return type. No new tests for the thin
  `api.ts` wrapper functions (`saveStoryArtifact`/`listStoryArtifacts`/
  `deleteStoryArtifact`) or for `StoryKeepsakes.tsx` — consistent with the
  existing, already-documented precedent that every other `api.ts` module
  and every other route has none, since they need a live backend to
  exercise meaningfully.

- **Phase 6 — Content source-review workflow** (`docs/CONTENT_SOURCES.md`,
  new): a short process document for Wonderwild Forest content
  specifically, since it is the first location to make real factual
  claims about the world rather than pure game logic or open fiction.
  Requires every `wonderwild-forest` `AdventureDefinition` to carry a
  "Sources" doc comment citing the claim, a checkable source, and a
  last-checked date, and defines the MVP review step (a second person
  verifies the citation during code review) until the Administrator/
  content-designer role from `CLAUDE.md` section 2 exists.
- **Phase 6 — Curated Wonder Wall content**
  (`src/features/adventures/content/wonderWallQuestions.ts`, new): a
  fixed catalog of curated curiosity questions across nature/science
  categories (`WONDER_WALL_QUESTIONS`), plus
  `WONDER_WALL_ANSWERED_QUESTION_ID` marking which one has a built
  adventure so far. Kept as source-controlled content, same precedent as
  `LEARNING_OBJECTIVES`/`ISLAND_LOCATIONS` — this is the "curated Wonder
  Wall question categories" deliverable as its own reviewable content
  artifact, decoupled from any one adventure's step file. Four new
  science-domain learning objectives added to `learningObjectives.ts`
  (`curious-questioning`, `cause-and-effect`, `observation`,
  `science-comprehension`).
- **Phase 6 — Engine: bounded AI narration for narrative steps**
  (`src/features/adventures/engine/types.ts`,
  `src/features/adventures/useAdventureSession.ts`): the one small,
  deliberate engine extension this phase needed. `PresentationSpec`'s
  `narrative` variant gained an optional `aiNarrated` flag; when a
  `NARRATIVE` step sets it, `useAdventureSession` fires a fire-and-forget
  `generateCompanionTurn` `NARRATE` call grounded with
  `authoredBaseText: presentation.text` — the same "rephrase but never
  contradict" grounding already used for `HINT` calls, just applied to a
  full scene instead of a hint. This is "bounded curiosity-to-adventure
  generation": the AI varies presentation, the authored text (always
  rendered by `NarrativeStep` regardless of what Chatty says) remains the
  deterministic source of truth, and the call never gates `advance`/
  `getNextStepId`, matching every other AI trigger in this file. No
  changes were needed to `validateCompanionTurn`, the persona prompt, or
  the AI route itself — `authoredBaseText` grounding was already
  intent-agnostic.
- **Phase 6 — Adventure content**
  (`src/features/adventures/content/buzzAndTheWaggleDance.ts`): "Buzz and
  the Waggle Dance", Wonderwild Forest's first adventure, scoped to
  `ageBands: ['PATHFINDER']` only (same first-adventure-per-location
  precedent as Phases 3 and 5). Flow: a `wonder-wall` `CHOICE` step
  presenting every `WONDER_WALL_QUESTIONS` option with no `hintPolicy` (a
  deliberate, tested exception to "every answerable step gets a 5-level
  ladder" — this step is a router, not a quiz to retry) — picking the
  bees question (`correct`) goes straight to the adventure, picking any
  other question (`incorrect`) goes to `wonder-wall-fallback`, a calm
  authored `NARRATIVE` redirect that then always continues into the same
  adventure. This is `docs/ROADMAP.md`'s "safe fallback when a question is
  out of scope" — implemented as a plain, deterministic engine transition
  rather than an AI safety check, since the boundary is "not authored
  yet," not "unsafe content." From there: an `aiNarrated` shrinking scene,
  an authored introduction to Buzz, a cause-and-effect `CHOICE` (what a
  long waggle means) and a `NUMBER_INPUT` observation (count the waggles)
  both with full 5-level hint ladders and self-referencing `incorrect`
  transitions (retry in place, same pattern as existing content), a
  comprehension `CHOICE` anchored to the authored fact, a `REFLECTION`,
  a `WORLD_CHANGE` (`WONDER_DISCOVERED`/`WAGGLE_DANCE_DISCOVERED`), then
  `COMPLETE`. Needed zero further engine changes beyond the `aiNarrated`
  flag above — every step type used was already fully specified and
  validated. Registered in `content/index.ts`.
- **Phase 6 — Location copy**: `locations.ts`'s Wonderwild Forest
  `decoration` text updated from "the first curiosity adventure is coming
  soon" (now false) to "the Wonder Wall's questions are still waiting for
  their first answer" (still accurate pre-any-completion world-state
  copy, matching the existing Pirate Builder Bay/Storykeeper Castle
  phrasing style). `IslandLocationPage.tsx` needed no changes — same
  generic template-lookup-by-location-slug precedent as Phase 5.
- Unit tests: `buzzAndTheWaggleDance.test.ts` (structural guard, same
  shape as `repairTheMoonlightBridge.test.ts`/`theStorykeepersTale.test.ts`,
  plus checks that the Wonder Wall step offers every curated question with
  the bees question marked correct, that an out-of-scope pick routes
  through the fallback step rather than a dead end, that exactly one step
  is `aiNarrated`, and that the comprehension check is anchored to the
  authored fact). No new tests for `useAdventureSession.ts`'s `aiNarrated`
  trigger itself, consistent with the existing, already-documented
  precedent that this hook has no direct unit tests (needs a live backend
  to exercise meaningfully) — same as its Phase 4/5 HINT/CELEBRATE/NARRATE
  triggers.

## Next task

Begin Phase 7 (Parent Dashboard) per `docs/ROADMAP.md`: recent adventures,
skills practiced, support and hint patterns, creations and world changes,
controls for AI, voice, session time, and retention, and a plain-language
weekly summary.

## Verification (Phase 6 session)

- `npm run typecheck` — passed (`tsc -b` and `amplify/tsconfig.json`).
- `npm run lint` — passed (same 2 pre-existing-style warnings as every
  prior phase, not errors).
- `npm run format:check` — passed.
- `npm run test` — passed (27 files, 150 tests, up from 26 files/138
  tests).
- `npm run build` — passed (same informational chunk-size warning as every
  prior phase).
- `npm run test:e2e` — passed (3 tests, Chromium; unchanged — they still
  only cover unauthenticated routes).
- **Not done this session**: no `ampx sandbox` deploy or live Bedrock call
  exercising the new `aiNarrated`/`NARRATE` path on `shrink-into-hive` (no
  AWS credentials in this environment, same constraint noted in every
  prior phase). This phase made no backend schema changes at all — no new
  models, fields, or AI routes — so the risk surface is smaller than
  Phase 5's; the only new runtime behavior is a different call site into
  the already-live-verified `generateCompanionTurn` route with an
  `authoredBaseText` argument it already supported. Still needs a real
  play-through to confirm end to end before wider use.

## Verification (Phase 5 session)

- `npm run typecheck` — passed (`tsc -b` and `amplify/tsconfig.json`).
- `npm run lint` — passed (same 2 pre-existing-style warnings as every prior
  phase, not errors — see below).
- `npm run format:check` — passed.
- `npm run test` — passed (26 files, 138 tests, up from 23 files/120 tests).
- `npm run build` — passed (same informational chunk-size warning as every
  prior phase).
- `npm run test:e2e` — passed (3 tests, Chromium; unchanged — they still
  only cover unauthenticated routes).
- **Not done this session**: no `ampx sandbox` deploy or live Bedrock call
  against the new `StoryArtifact` model or the `NARRATE`-intent reuse of
  `generateCompanionTurn` (no AWS credentials in this environment, same
  constraint noted in every prior phase's automated portion). The schema
  change is additive (one new model, one new relationship field) and the
  AI route itself is unchanged from Phase 4's already-live-verified
  `generateCompanionTurn`, so the risk surface is materially smaller than
  Phase 4's — but this still needs a real `ampx sandbox` deploy and at
  least one real Storykeeper Castle play-through to confirm end to end
  before wider use.

## Verification (Phase 4 session)

- `npm run typecheck` — passed (`tsc -b` and `amplify/tsconfig.json`).
- `npm run lint` — passed (same 2 pre-existing-style warnings as every prior
  phase, not errors: `AuthContext.tsx` exports both a component and a hook
  from one file, and `ParentGate.tsx` uses `role="dialog"` on a `div` rather
  than a native `<dialog>`; both deliberate, kept as warnings).
- `npm run format:check` — passed.
- `npm run test` — passed (23 files, 120 tests).
- `npm run build` — passed (same informational chunk-size warning for the
  `aws-amplify` SDK bundle as every prior phase; still a premature
  optimization for an MVP with no traffic yet).
- `npm run test:e2e` — passed (3 tests, Chromium; unchanged from Phase 1-3 —
  they still only cover unauthenticated routes).
- `npx ampx sandbox` **was run** against a real AWS account (region
  `us-west-1`) by the user and deployed successfully after one fix (see
  below). With `amplify_outputs.json` now present, the full local suite
  was re-run end to end and all still passed, and the dev server boots and
  serves `200` against the live backend config.
- **Deployed-schema verification**: read back the live
  `amplify_outputs.json` and the synthesized CDK templates in
  `.amplify/artifacts/cdk.out/` and confirmed, byte-for-byte, that they
  match what `amplify/data/resource.ts` declares:
  - `model_introspection.generations.generateCompanionTurn` exists with
    exactly the 8 arguments declared in `resource.ts`, returning
    `CompanionTurn`.
  - `model_introspection.models` includes `AIInteractionAudit` and
    `SafetyEvent`; `nonModels` includes `CompanionTurn`/`CompanionChoice`;
    all 6 new enums are present.
  - The generated `model-schema.graphql` shows the AppSync `@generation`
    directive with `aiModel: "global.anthropic.claude-haiku-4-5-..."`, our
    persona text verbatim (correctly escaped as a normal double-quoted
    GraphQL string, `\n`-joined), and `@auth(rules: [{allow: private}])` —
    confirming `allow.authenticated()` compiled as intended.
  - The nested stack for the Bedrock HTTP data source grants its IAM role
    exactly one statement: `bedrock:InvokeModel` scoped to
    `arn:aws:bedrock:us-west-1::foundation-model/global.anthropic.claude-haiku-4-5-20251001-v1:0`
    — least-privilege, no wildcard resource, auto-wired by Amplify AI Kit
    with no `backend.ts` changes needed, as expected.
- **One deploy-time bug found and fixed this session**: the persona prompt
  in `amplify/data/chattyPersona.ts` used straight double quotes around
  field names (`"intent"`, `"authoredBaseText"`, etc.). AI Kit embeds
  `systemPrompt` as a plain double-quoted GraphQL string (not a `"""`
  block string), so those inner quotes terminated the string literal
  early and broke the generated SDL — surfaced as `ampx sandbox` failing
  with `[InvalidSchemaError] ... Expected ":", found String`. Fixed by
  switching to single quotes throughout the prompt; redeployed clean.
  Lesson for any future AI Kit `systemPrompt` text: never use `"` inside
  it.
- **`generateCompanionTurn` was called against live Amazon Bedrock and
  confirmed working, end to end.** The user signed up and confirmed a real
  parent account; from there a throwaway "AI Live Check" child profile and
  a direct `HINT`-intent call reached Bedrock for real (~1.4s latency),
  returned a well-formed `CompanionTurn`, passed `validateCompanionTurn`,
  and wrote an `AIInteractionAudit` row with `validationStatus: VALID` and
  `fallbackUsed: false`. Getting there surfaced two real upstream Amplify
  AI Kit gaps, both fixed this session and documented below and at their
  fix sites: a cross-Region inference IAM permissions gap
  (`amplify/backend.ts`) and a GraphQL enum serialization fragility
  (`amplify/data/resource.ts`'s `CompanionTurn` type). The model's actual
  behavior: for a `HINT` turn grounded with `authoredBaseText`, it
  reused the authored text close to verbatim rather than rephrasing it —
  safe (matches the "never contradict the authored text" instruction) but
  not yet demonstrating creative rephrasing; worth another look once the
  AI evaluation suite (below) exists to check this systematically rather
  than from one sample.

## Known risks / TODOs

- **Amplify AI Kit does not correctly grant IAM permissions for
  cross-Region ("Global") Bedrock inference profiles** — confirmed via a
  live `AccessDeniedException` that persisted through Bedrock model access
  and an active AWS Marketplace subscription, then root-caused by reading
  `@aws-amplify/graphql-generation-transformer`'s source directly: its
  `createBedrockDataSourceRole` only ever grants `bedrock:InvokeModel` on
  a single `foundation-model/<modelId>` ARN, with no handling for
  `global.`-prefixed model IDs, which are actually a different IAM
  resource type (`inference-profile`) requiring three separate ARNs (the
  inference-profile ARN, a region-scoped foundation-model ARN, and an
  unscoped global foundation-model ARN — all three are needed because a
  Global profile can route to any commercial Region). `Claude Haiku 4.5`
  has no direct in-Region option at all in `us-west-1` — only Geo/Global
  routing — so this isn't avoidable by picking a different model while
  staying in this Region. Matches an open upstream issue,
  [aws-amplify/docs#8121](https://github.com/aws-amplify/docs/issues/8121)
  ("AI kit does not support Cross-region inference"). **Fixed** with a CDK
  escape-hatch in `amplify/backend.ts` that reaches
  `backend.data.resources.nestedStacks['GenerationBedrockDataSource...Stack']`
  and adds the missing policy statement directly to the auto-generated
  role. This is inherently a bit fragile — it depends on Amplify's
  internal (but deterministic, field-name-derived) construct naming not
  changing — revisit if a future `@aws-amplify/backend`/`data-construct`
  upgrade changes generation-route internals, or once upstream fixes
  #8121 (at which point this patch likely becomes unnecessary).
- **Amplify AI Kit's generated GraphQL schema declared `CompanionTurn`'s
  `emotion`/`intent`/`safetyDisposition` as strict GraphQL enums, which
  is unsafe for AI output.** Real Bedrock output was observed returning
  correct values in unexpected case (`"curious"` instead of `"CURIOUS"`),
  which AppSync's enum serialization rejects outright — and critically,
  AppSync nulls out the *entire* response object when any nested field
  fails to serialize, destroying an otherwise-fine `spokenText` along with
  it, with no visibility into the raw value (no query logging configured).
  **Fixed** by declaring those three fields as plain `a.string()` in
  `amplify/data/resource.ts` and relying entirely on
  `validateCompanionTurn`'s existing application-level check (which now
  also normalizes case before comparing, in `schema.ts`'s
  `normalizeEnumValue`). This is the correct end state, not just a
  workaround: CLAUDE.md section 7 already says correctness/safety
  validation belongs in application code, not a single upstream layer, and
  in practice the GraphQL-level enum constraint was strictly less safe
  than not having it, since a harmless casing difference triggered total
  data loss on the whole payload rather than a targeted, recoverable
  fallback.
- Both fixes above still leave one open question for later: whether
  `bedrock:InvokeModelWithResponseStream` is ever needed (the generation
  transformer's resolver currently only issues a non-streaming
  `InvokeModel` call, so it wasn't added) — revisit if Amplify AI Kit adds
  streaming support for generation routes.
- **`docs/TESTING_STRATEGY.md`'s "AI evaluation suite" (fixed test cases by
  age band covering output length, vocabulary, PII requests, secrecy/
  dependency language, unsafe topics, prompt injection, invalid action
  IDs, misleading content, excessive praise/shame, hint-level correctness,
  graceful uncertainty) has not been built.** What shipped instead is
  `validateCompanionTurn`'s unit tests, which exercise the *validator*
  against synthetic payloads, not a real model's actual behavior under
  those conditions. Building the real eval suite needs a deployed
  backend and is meaningfully separate work — track as a Phase 4 follow-up
  before wider release, not blocking for this MVP milestone.
- **Child free-text input is out of scope for this wiring.** The `intent`
  values this phase sends to the model (`HINT`, `CELEBRATE`) never
  include child-authored free text — hint requests and celebrations are
  triggered by structured game state, not typed input, and no step
  renderer for `SHORT_RESPONSE` exists yet (Phase 3 note, still true).
  `docs/AI_AND_CHILD_SAFETY.md`'s "Child input policy" (reject/redirect
  rules for contact details, sexual content, etc., applied to what a
  *child* says) is therefore not yet exercised end-to-end; it becomes
  relevant once a free-text or open-ended-choice step exists (expected in
  Phase 5's collaborative storytelling).
- `COMPANION_MODEL_ID` in `src/features/companion/api.ts` (written to
  `AIInteractionAudit.modelId`) is a human-readable label
  (`'anthropic.claude-haiku-4-5'`), not necessarily the exact Bedrock
  `resourcePath` Amplify resolves `a.ai.model('Claude Haiku 4.5')` to
  (`global.anthropic.claude-haiku-4-5-...`, per
  `@aws-amplify/data-schema`'s internal model lookup table). Fine for
  observability today; revisit if audit rows need to exactly match a
  billing/model-selection record.
- `AIInteractionAudit` and `SafetyEvent` are owner-authorized like every
  other Phase 1-3 model, so a parent's authenticated session can read
  their own child's rows directly — there is still no admin/reviewer
  group (same gap already tracked for Phase 3's models). `CLAUDE.md`
  section 2's "Administrator/content designer" reviewing flagged
  interactions "without exposing unnecessary child data" is not yet
  buildable until that role exists.
- Bedrock model choice (`Claude Haiku 4.5`, chosen for low latency/cost on
  short structured turns) is a placeholder, consistent with "Bedrock model
  selection by region, capability, latency, and cost" already being listed
  under "Decisions pending" before this phase.
- `npm ci` fails with a false-positive `EUSAGE`/"Missing: X from lock file" error
  (`@opentelemetry/core@2.0.0`, `yaml@1.10.3`) even against a freshly generated
  `package-lock.json`. Root cause: `@aws-amplify/data-construct` and
  `@aws-amplify/graphql-api-construct` (pulled in transitively via
  `@aws-amplify/backend-cli` → `aws-cdk-lib`) ship `bundledDependencies` with exact
  pinned versions that npm's lockfile-integrity check for `npm ci` cannot reconcile.
  `npm install` resolves and installs the same tree without error. Both
  `.github/workflows/ci.yml` and the new `amplify.yml` were changed from `npm ci` to
  `npm install` to work around this; revisit and switch back to `npm ci` once upstream
  (`npm` or `@aws-amplify/*`) fixes the bundled-dependency/lockfile interaction.
- `npm audit` reports vulnerabilities in dev-only transitive dependencies of the
  official `@aws-amplify/backend-cli` toolchain (GraphQL codegen and Relay-compiler
  packages: `lodash`, `immutable`, `brace-expansion`, etc.). These run only when
  invoking `ampx` commands locally/in CI and are not part of the shipped browser
  bundle. No upstream fix is available yet without downgrading Amplify tooling;
  revisit when AWS publishes updated releases.
- `react-router-dom@7.18.2` carries a high-severity advisory (RSC Mode CSRF Bypass,
  GHSA-qwww-vcr4-c8h2). This app uses React Router only as a client-side SPA router
  (no RSC/SSR/single-fetch server actions), so the advisory's attack surface does not
  apply here. Confirmed the alternative (pinning to the last unaffected 7.11.0) trades
  this for several other unpatched high-severity issues, so staying on latest is the
  safer choice. Revisit when a patched release is available.
- Amplify sandbox has not been deployed against a live AWS account; first real deploy
  and credential setup remain for whoever provisions the AWS environment.
- No visual design system, Bedrock model selection, or TTS provider yet (unchanged
  from before this phase).
- Found and fixed three `node_modules` packages this session that were installed
  with most of their `dist` output missing (`@aws-amplify/data-schema`,
  `@testing-library/user-event`, and the `graphql@15.8.0` nested under
  `@aws-amplify/api-graphql`) — each had its CJS build intact but was missing
  its type declarations and/or ESM build, which broke `tsc`/`vite build`
  respectively. A plain `npm install` did not restore them; a targeted
  `npm install <pkg>@<version> --no-save --force` (run inside the nested
  package's own directory for the `graphql` case) did. Root cause looks like
  the same class of bundled-dependency install instability already documented
  above for `npm ci`. If a fresh `npm install` on another machine hits similar
  missing-file errors from `tsc` or `vite build`, this is the fix; consider a
  postinstall integrity check if it recurs.
- **Owner-authorization backend tests are not runnable in this environment.**
  `docs/TESTING_STRATEGY.md` calls for testing "owner isolation between parent
  accounts" and "child profile CRUD authorization," but that requires a
  deployed `ampx sandbox` (real Cognito + AppSync) — unavailable here (no AWS
  credentials, `.claude/settings.json` denies `aws:*`). What shipped instead:
  `amplify/data/resource.ts` declares `allow.owner()` on every model,
  including the five new Phase 3 models, and the feature `api.ts` modules
  rely on that (no manual owner filtering client-side). A real test, once
  someone runs `ampx sandbox` with credentials, would: sign up two parent
  users, have each create a child profile and play through an adventure, and
  assert that parent A's authenticated client cannot `get`/`list`/`update`
  parent B's records for any model (expect an authorization error or empty
  result, not the data) — plus `docs/TESTING_STRATEGY.md`'s "adventure
  start/action/complete invariants" and "prevention of direct progress or
  world-change forgery," which also need a live backend to verify a client
  can't, say, `AdventureAction.create` a `CORRECT` result for a step it never
  reached.
- **"Repair the Moonlight Bridge" is authored for `ageBands: ['PATHFINDER']`
  only.** Sprout/Explorer children see "not available for your age yet" on
  Pirate Builder Bay (`IslandLocationPage.tsx`) instead of the adventure.
  `CLAUDE.md` section 3 forbids showing content merely because it exists, and
  hand-authoring true per-band difficulty variants for the very first
  adventure was judged out of scope for "author one complete adventure" —
  revisit once there's a second adventure to validate the pattern against.
- `AdventureSession.difficultyState` from `DATA_MODEL.md` was dropped from
  the schema: Phase 3 has no adaptive-difficulty state beyond the hint
  ladder (which lives in-memory per play-through in
  `useAdventureSession.ts`, not persisted). Add it back if/when adaptation
  needs to survive a page reload or vary future content difficulty.
- Hint-ladder level and attempt count for the *current* step are in-memory
  only (`useAdventureSession.ts`'s `progressByStep`) and reset on a hard page
  reload; `AdventureAction` rows persist the history, but resuming a session
  after a reload restarts hint escalation from level 0 for whatever step the
  child is on. Low severity (session `currentStepId` — the part required by
  "session persistence and resume" — does persist correctly); revisit if
  losing in-progress hint state proves disruptive in testing.
- `MAX_CHILD_PROFILES` (3) is enforced only in `ChildProfileList.tsx`
  (client-side UI). There is no server-side guard, so a direct API call could
  create a fourth profile. Low severity (no cross-user exposure), but worth a
  custom mutation if this ever needs to be a real limit rather than a UI nudge.
- **`StoryArtifact` deliberately stores full scene text, not metadata-only,
  unlike `AIInteractionAudit`.** This is intentional (the whole point is a
  parent-readable "generated story artifact" per `docs/ROADMAP.md`), but
  every scene's text already passed `validateCompanionTurn`'s content-safety
  checks before it was captured, so this does not reopen the "no raw child/AI
  text" principle CLAUDE.md section 13 applies to logs/audits — it's a
  different, explicitly-approved kind of record. Worth calling out
  explicitly since it's the first model in the schema that stores validated
  AI prose rather than only metadata about it.
- **`StoryArtifact` has no admin/reviewer group access**, same gap already
  tracked above for `AIInteractionAudit`/`SafetyEvent` and the Phase 3
  models — there is still no admin role for CLAUDE.md section 2's
  "Administrator/content designer" to review anything, including saved
  stories, without going through a parent's own authenticated session.
- **"The Storykeeper's Tale" is authored for `ageBands: ['PATHFINDER']`
  only**, same scope note as "Repair the Moonlight Bridge" and for the same
  reason: hand-authoring true per-band variants for a location's first
  adventure was judged out of scope until there's a broader pattern to
  validate against.
- The late-narration race noted above under "Phase 5 — Scene capture and
  story persistence" (a scene from the last `CREATIVE_CHOICE` step can be
  missed from the saved artifact if its AI request is still in flight when
  `WORLD_CHANGE` is reached) has not been reproduced or load-tested; it's a
  theoretical race based on reading the code's async ordering, not an
  observed failure.

- **"Buzz and the Waggle Dance" is authored for `ageBands: ['PATHFINDER']`
  only**, and only one of the four curated `WONDER_WALL_QUESTIONS` has a
  built adventure — same scope note as the other two locations' first
  adventures, and for the same reason: hand-authoring true per-band
  variants, or three more full adventures, for a location's first pass
  was judged out of scope until there's a broader pattern to validate
  against. The other three Wonder Wall questions are real, curated, and
  visibly present to the child today; they just all currently redirect to
  the bee adventure rather than their own content.
- **The source-review workflow in `docs/CONTENT_SOURCES.md` is a
  code-review convention (a doc comment plus a human check on the pull
  request), not a structured, queryable, or enforced one.** There is no
  admin/content-designer role yet (same gap tracked below for every other
  model), so nothing currently stops a future `wonderwild-forest` adventure
  from shipping without a "Sources" comment, or with one nobody actually
  checked. Revisit once that role exists.
- **`WonderWallQuestion` has no admin/reviewer group access or backing
  model** — it is source-controlled content like `IslandLocation` and
  `LearningObjective`, so this is the same already-tracked gap, not a new
  one specific to Wonder Wall.

## Decisions pending

- Final visual design direction and art pipeline.
- Bedrock model selection by region, capability, latency, and cost.
- Text-to-speech provider and voice consent model.
- Formal curriculum framework mapping.
- Legal/privacy review and retention schedule.

