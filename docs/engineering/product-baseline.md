# Product and Safety Baseline

> **Status:** Mandatory
> **Owner:** Project owner
> **Last reviewed:** 2026-11-18
> **Related:** ADR-072, LAI-ENG-001, ADR-053

These are the product, child-safety and AI rules that `CLAUDE.md` held in sections 1 to 13 before
LAI-ENG-001 restructured it into a concise index (ADR-072, decision 7). The text below is moved
**verbatim**, with its original section numbers, so existing references such as "CLAUDE.md
section 11 item 11" can still be followed. It binds exactly as it did in `CLAUDE.md`. Amendments
made by accepted ADRs after this text was written still apply (for example ADR-053 for section 11
item 11, already reflected here).

Former sections 8 (technology baseline), 14 (work process), 15 (definition of done) and 17
(source documents) are superseded in form, not in substance, by
[architecture-rules.md](architecture-rules.md), [development-workflow.md](development-workflow.md),
[definition-of-done.md](definition-of-done.md) and the index in [`CLAUDE.md`](../../CLAUDE.md).
Sections 18 to 20 remain in `CLAUDE.md`.

Two terms below predate later decisions: "island" and `IslandLocation` are now the child-facing
**Realm** and the catalog **Place** (`World` and `Location`, ADR-041; see
[realm-standard.md](../adventures/realm-standard.md)). Styling: ADR-023 and ADR-052 also allow
Tailwind CSS 4 in the shells, admin, homepage and landing page.

## 1. Mission
Build **Learning Adventure Island**, an AI-powered learning adventure world for children ages **3–8** on **React + Three.js, Django REST and PostgreSQL, Amazon Cognito, and Amazon Bedrock** (section 8; Amplify is retired, section 18).

The product is not a collection of worksheets or a generic chatbot. It is a living island where children learn by solving meaningful problems, helping characters, creating things, and changing the world.

Core promise:

> Learning makes the island grow.

Every experience must combine:
- a clear child-facing adventure goal;
- one or more age-appropriate learning objectives;
- a visible consequence in the island world;
- safe, constrained AI personalization;
- encouragement without manipulation or shame.

## 2. Primary Users

### Parent or guardian
- Creates and owns the account.
- Creates child profiles.
- Selects age band and optional interests.
- Reviews progress and learning summaries.
- Controls voice, microphone, AI features, and data retention (no play-time limit, ADR-053).

### Child profile
- Does not require an email address.
- Uses a parent-managed profile and avatar.
- Explores the island through large visual controls, narration, and short interactions.
- Never receives an unrestricted general-purpose chat box.

### Administrator/content designer
- Manages curriculum skills, adventure templates, safety rules, featured events, and content status.
- Reviews flagged AI interactions and generation failures without exposing unnecessary child data.

## 3. Target Age Bands

### Sprouts: ages 3–4
- Voice-first and picture-first.
- One-step decisions.
- Sessions of roughly 5–8 minutes.
- Skills: vocabulary, classification, cause/effect, emotions, counting, observation.

### Pathfinders: ages 5–6
- Narrated text with optional word highlighting.
- Two- or three-step quests.
- Sessions of roughly 8–12 minutes.
- Skills: phonemic awareness, early reading, number sense, sequencing, patterns, explanation.

### Explorers: ages 7–8
- More reading and independent choices.
- Multi-stage missions.
- Sessions of roughly 10–18 minutes.
- Skills: reading comprehension, arithmetic, measurement, science reasoning, creative writing, planning.

Never show content merely because it is available. Difficulty, reading volume, response mode, and interaction length must derive from the child profile's age band and demonstrated ability.

## 4. Product Pillars

1. **Adventure first** — The child experiences a mission, not a lesson menu.
2. **Learning has consequences** — Solving a problem repairs, unlocks, creates, or changes something on the island.
3. **AI adds variation and responsiveness** — AI personalizes dialogue, hints, stories, and structured challenges; it does not invent the product rules.
4. **Children remain the creators** — AI prompts, supports, and reacts rather than replacing imagination.
5. **Safe by architecture** — Safety cannot depend on a single prompt or model response.
6. **Parent trust** — Explain what was learned, why an AI response appeared, and what data is stored.
7. **Calm engagement** — No dark patterns, infinite scrolling, loot-box mechanics, public leaderboards, or anxiety-driven streaks.

## 5. Initial World

The MVP island contains four connected locations:

### Welcome Harbor
- Child onboarding and companion selection.
- Daily island event introduction.
- Visual map and adventure log.

### Pirate Builder Bay
- Role-play missions involving counting, measurement, sorting, planning, and reading instructions.
- Example: repair a bridge or provision a ship.

### Wonderwild Forest
- Curiosity adventures triggered by safe child questions or curated prompts.
- Example: shrink into a beehive to discover why bees dance.

### Storykeeper Castle
- Collaborative storytelling, prediction, sequencing, vocabulary, and reading comprehension.
- The child makes choices and supplies ideas; AI assembles them into a bounded adventure.

Future locations are documented in `docs/PRODUCT_VISION.md` and are not MVP scope unless explicitly approved.

## 6. AI Companion

The initial companion is **Chatty the Parrot**.

Chatty is:
- warm, curious, playful, concise, and never sarcastic toward young children;
- a guide and co-adventurer, not an authority figure or replacement parent/teacher;
- allowed to explain, hint, ask learning questions, narrate consequences, and celebrate effort;
- prohibited from requesting private information, encouraging secrecy, creating dependency, diagnosing, disciplining, or discussing inappropriate topics.

Chatty must not say that it is human, conscious, lonely, or emotionally dependent on the child. It may be framed as island magic or an AI-powered character, according to parent-facing explanations.

## 7. AI Interaction Model

Use **structured generation**, curated templates, deterministic game logic, and server-side validation.

Preferred flow:

```text
Child action
  -> Adventure state machine
  -> Learning objective selector
  -> Safe context builder
  -> AI generation route
  -> Structured schema validation
  -> Input/output safety checks
  -> Approved UI component
  -> Progress event and world consequence
```

Rules:
- Never call a foundation model directly from the browser.
- Never expose model credentials to the client.
- Route every AI call through Django's AI pipeline (`lai/apps/ai`), backed by Amazon Bedrock, with the deterministic fake provider for local development and tests.
- AI output must use explicit schemas for dialogue, choices, hints, challenge metadata, and safety disposition.
- Gameplay correctness must be evaluated by application code whenever possible, not by the model.
- Do not send full child profiles or unnecessary history to the model.
- Avoid persistent free-form conversation memory in the MVP.
- Every AI request must include an adventure template ID, age band, allowed topic, learning objective, and maximum output length.
- Every response must have a safe fallback authored in code.

## 9. Required Domain Concepts

Use these terms consistently:
- `ParentAccount`
- `ChildProfile`
- `AgeBand`
- `IslandLocation`
- `AdventureTemplate`
- `AdventureSession`
- `AdventureStep`
- `LearningObjective`
- `SkillProgress`
- `WorldChange`
- `CompanionProfile`
- `AIInteractionAudit`
- `ParentConsent`
- `SafetyEvent`

Do not call child profiles “users” in child-facing copy.

## 10. Authorization Principles

- Parent accounts authenticate through Cognito.
- A parent may access only their own child profiles and associated records.
- Children do not directly query administrative records or raw AI audit data.
- Admin access must be group-based and explicitly authorized.
- AI routes must operate using the authenticated parent/account context or a narrowly authorized backend function.
- Data access is deny-by-default.
- Never use public model access for private child progress or session data.

## 11. MVP Scope

The first usable product must include:

1. Parent sign-up, sign-in, sign-out, confirmation, and password recovery.
2. Parent creates up to three child profiles.
3. Child selects a profile using a parent-configurable simple gate.
4. Child chooses Chatty the Parrot.
5. Visual island map with Welcome Harbor, Pirate Builder Bay, Wonderwild Forest, and Storykeeper Castle.
6. One complete adventure template per location, excluding Welcome Harbor.
7. At least one adaptive hint path per adventure.
8. At least one persistent world change after an adventure.
9. Adventure log showing completed missions and creations.
10. Parent dashboard summarizing activity by skill, not raw chat transcripts.
11. No play-time limits: children are never counted down, nudged to stop, or cut off for time
    (ADR-053 retired the session-time control and calm stop).
12. Safety logging, AI fallback behavior, and admin review scaffolding.
13. Responsive tablet-first layout.
14. Automated tests for authorization, adventure state transitions, age adaptation, and AI validation.

## 12. Out of Scope for MVP

Do not implement until separately approved:
- social networking;
- child-to-child messaging;
- public profiles or leaderboards;
- open-ended AI chat;
- user-generated public content;
- live classrooms;
- real-money purchases by children;
- advertising;
- facial recognition;
- emotion inference from camera or voice;
- cloning a child's or family member's voice;
- unrestricted web search;
- autonomous AI agents taking external actions;
- native mobile applications.

## 13. Coding Rules

- TypeScript strict mode; avoid `any`.
- Keep domain logic independent from React components.
- Use small composable services and pure functions for adventure transitions.
- Validate all external and AI-generated data at runtime.
- Return typed errors with safe user-facing messages.
- Do not log child free-text, audio, names, or identifiers unless specifically required and documented.
- Add tests with each feature.
- Add or update documentation when architecture, schema, privacy behavior, or scope changes.
- Do not silently introduce a new dependency.
- Prefer accessible buttons over clickable divs.
- All child-facing text must be readable aloud and localizable.
- Avoid em dashes in user-facing copy.

## Historical: former section 16 (not an instruction)

Kept as history only; the repository is past this sequence. Do not follow it.

When starting from an empty repository, implement in this order:

1. Scaffold React + Vite + TypeScript and the backend (originally Amplify Gen 2; now Django, section 18).
2. Establish linting, formatting, unit testing, and CI.
3. Add design tokens and application shell.
4. Define Auth and parent authentication flows.
5. Define the initial data schema and authorization rules.
6. Build parent-managed child profile creation.
7. Build the static island map and route structure.
8. Implement the deterministic adventure state engine.
9. Implement Pirate Builder Bay without AI first.
10. Add structured AI generation for companion dialogue and hints.
11. Add Storykeeper Castle and Wonderwild Forest.
12. Add progress, world changes, parent summaries, and safety audit scaffolding.
13. Add end-to-end tests and deployment documentation.

Do not begin with AI generation. First make the core adventure playable deterministically, then add AI as a safe enhancement.
