# Architecture Decision Log

## ADR-001: Parent-owned accounts

Status: Accepted

Children use parent-managed profiles rather than independent email accounts.

## ADR-002: Deterministic engine before AI

Status: Accepted

Adventure progression and correctness are controlled by application code. AI enhances dialogue, hints, and bounded variation.

## ADR-003: Structured AI output

Status: Accepted

AI responses must conform to runtime-validated schemas and authorized action IDs.

## ADR-004: No open-ended child chat in MVP

Status: Accepted

All child AI interactions occur inside a defined adventure or curated question flow.

## ADR-005: Persistent world consequences

Status: Accepted

Adventure completion creates visible, durable world changes to connect learning with meaningful outcomes.

## ADR-006: Household co-presence adventures, no communication channel

Status: Proposed

Two `ChildProfile`s under the same `ParentProfile` may share a single adventure
instance and see each other's avatar, position, and discrete in-game actions
in real time (for example, "child B placed a plank in slot 3"). No field,
transport, or UI surface carries free-form input — text, voice, image, or
drawing — from one child to another. The only signal that ever crosses
between children is validated game state, the same shape of event the
deterministic engine already authors and validates today (CLAUDE.md
section 7).

This is explicitly distinct from, and does not change, CLAUDE.md section 12's
exclusion of child-to-child messaging and social networking. Those remain out
of scope. This ADR covers presence with zero communication surface only —
there is nothing here to moderate because there is nothing expressive to
carry.

**Scope for v1:** participants must belong to the same `ParentProfile`
(siblings/household). Cross-family pairing is deliberately excluded.

**Why household-only is an architectural constraint, not just a safety
preference:** every model in the current schema (`amplify/data/resource.ts`)
uses `allow.owner()` authorization scoped to a single Cognito identity. Two
`ChildProfile`s under one `ParentProfile` already share that identity, so a
shared session record stays readable and writable under the existing owner
rule with no new authorization primitive. Cross-family pairing would require
a new sharing/authorization model (per-session grants across owners) — a
separate, larger decision, not an incremental extension of this one.

**Deferred, not part of this decision:**
- cross-family pairing or matchmaking of any kind;
- any communication surface, including closed-vocabulary/canned-phrase
  exchange;
- continuous cursor/telemetry-level presence — v1 ships discrete action
  events plus join/leave presence only;
- shared or merged island world state across children — each child's own
  island still receives its own `WorldChange` record.

See `docs/DATA_MODEL.md` (`CoopSession`) and `docs/ADVENTURE_ENGINE.md`
("Co-op sessions") for the corresponding spec. Sequencing note: this ADR's
feature now ships as Phase 17 in `docs/ROADMAP.md`, after the world engine
(Phase 9) and Story Engine (Phase 12) are stable, since presence UI has
nothing to render without an avatar/world to show it in.

## ADR-007: Phaser as the world-engine rendering library

Status: Accepted

Learning Adventure Island adopts an explorable, avatar-controlled world
(`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md`), replacing
the earlier, narrower "Motion and Embodiment" plan for `docs/ROADMAP.md`
Phase 9. That plan assumed the existing hand-rolled Canvas 2D +
`requestAnimationFrame` approach from `ChattyAvatar.tsx` would scale up to
tilemaps, camera follow, collision, sprite animation, and NPC interaction.
It does not: those are exactly the concerns a 2D game engine exists to
solve, and hand-rolling them risks becoming an unmaintained, undertested
game engine embedded inside a learning app.

Learning Adventure Island adds **Phaser** (`phaser` on npm) as the renderer
for the explorable world, per the source roadmap's section 7
recommendation. This is a deliberate exception to CLAUDE.md section 13's
"do not silently introduce a new dependency" — it is introduced here
explicitly, with the parent's approval, specifically because Phase 9's
scope (tilemaps, collision, camera, sprite animation) is what it is built
for.

**What does not change:**
- `ChattyAvatar.tsx`'s Canvas 2D approach remains the pattern for small,
  self-contained portraits and icons (companion portrait, plank-count
  icons) — it is not retrofitted into or replaced by Phaser.
- The deterministic Adventure Engine (ADR-002), structured AI output
  (ADR-003), and server-side correctness remain unchanged. Phaser is a
  presentation-layer addition only; it never decides correctness,
  progression, or safety disposition.
- No foundation-model or network code runs inside a Phaser scene.

**Layering constraint (roadmap section 40), now an architectural rule:**

```text
World Engine (Phaser: movement, maps, animation, collision)
     -> Story Engine (chapters, scenes, narrative state, bounded choices)
     -> Adventure Engine (deterministic challenge progression, validation, hints)
     -> Learning Rules / AI Companion (evaluation / narration, never both)
     -> World State (permanent consequences, unlocks, discoveries)
```

No layer takes over responsibilities belonging to another layer. In
particular, Phaser scenes may fire `WorldInteraction` events but must never
themselves validate an answer, award progress, or call an AI route
directly — those cross a React/world-event-bus boundary into existing,
already-audited code paths.

**Testing implication:** Phaser requires a real Canvas/WebGL rendering
context that jsdom does not provide, so scene code is kept thin and
Phaser-specific (uncovered by unit tests beyond smoke-level
mount/unmount checks with `phaser` mocked); all game *logic* — the world
event bus, the world object/interaction registry, requirement checks — is
written as plain, Phaser-free TypeScript so it stays unit-testable.

## ADR-008: Three.js first-person world supersedes Phaser as the next-generation renderer

Status: Accepted, pending Sprouts (ages 3-4) accessibility validation before
child-facing rollout

This supersedes ADR-007's renderer choice, not the layering rule it
established. Learning Adventure Island adopts **Three.js**
(`three` on npm) as the rendering library for the next generation of the
explorable world, moving from the currently shipped top-down/isometric
Phaser view to a first-person 3D perspective: `PerspectiveCamera`,
`Raycaster`-based interaction targeting, GLTF/GLB assets, and
`AnimationMixer`-driven character/object animation.

**Why this reverses the earlier 2D recommendation:** the source roadmap
that produced ADR-007
(`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 7)
deliberately chose 2D/2.5D over full 3D for tablet performance, accessibility,
touch interaction, camera simplicity, and asset cost, for a product whose
youngest band is ages 3-4. A later planning pack makes first-person 3D an
explicit product decision instead, reasoning that a first-person view
strengthens the "I am exploring my island" feeling (section 2) more than a
top-down map does. That tradeoff is accepted here, but the risk it
reintroduces is not waved away: this ADR's status is deliberately marked
pending on accessibility validation rather than fully closed.

**What does not change:**
- ADR-007's layering rule stands unchanged, with Three.js taking Phaser's
  slot at the top:

```text
World Engine (Three.js: camera, scene graph, GLB assets, animation,
              collision presentation, interaction targeting)
     -> Story Engine (chapters, scenes, narrative state, bounded choices)
     -> Adventure Engine (deterministic challenge progression, validation, hints)
     -> Learning Rules / AI Companion (evaluation / narration, never both)
     -> World State (permanent consequences, unlocks, discoveries)
```

- Three.js never decides correctness, mastery, quest completion, rewards,
  or AI safety disposition. A Three.js scene may emit `WorldInteraction`-style
  events (`PlayerEnteredZone`, `ObjectInteracted`, `NpcApproached`) but must
  never itself validate an answer, award progress, or call an AI route
  directly, matching ADR-007's existing constraint.
- Durable domain state is keyed by stable semantic identifiers
  (`regionId`, `zoneId`, `entityId`, `interactionId`, `worldStateKey`), never
  by a Three.js object UUID, mesh reference, or raw camera transform.
- `ChattyAvatar.tsx`'s Canvas 2D approach remains untouched for small,
  self-contained portraits/icons, as under ADR-007.
- The deterministic Adventure Engine (ADR-002), structured AI output
  (ADR-003), and server-side correctness remain unchanged.

**Migration, not rewrite:** Phaser is not retroactively erased from project
history. The already-shipped Phaser world (Phases 9-11 in
`docs/ROADMAP.md`) is the current production state and stays live until a
Three.js vertical slice reaches feature parity on the same golden path
(walk to the broken bridge, repair it, walk across it) and is play-tested.
Phaser is retired from child-facing exploration only after that slice is
verified, not on this ADR alone. See `docs/ROADMAP.md` Phases 31-34 for the
migration sequence.

**Open risk this ADR does not resolve:** first-person camera/look controls
introduce accessibility and comfort concerns (fine motor control for
look-around, motion sensitivity, disorientation) that a top-down/isometric
view does not have, and that are more acute for the Sprouts band (ages 3-4,
"voice-first and picture-first," "one-step decisions," CLAUDE.md section 3)
than for Pathfinders or Explorers. The non-graphical alternate navigator
already required by Phase 9 (roadmap section 42 — "walking the world must
never be the only way to reach a location or adventure") carries forward as
a hard requirement here, not an optional accessibility nicety, and Phase 31
must include an explicit Sprouts playtest before any Three.js region ships
as the primary path for that age band. If that validation fails for
Sprouts, the fallback is not to abandon Three.js for Pathfinders/Explorers,
but to keep (or restore) a non-first-person path — map navigator, fixed
camera, or the existing Phaser view — as Sprouts' primary route through the
world.

**Status update (Phase 32):** the playtest still has not run — it needs
real 3-4-year-old testers, which no build environment can substitute
(runbook in `docs/PILOT_READINESS.md` section 5). Phase 32 shipped Welcome
Harbor's first-person region as a real, reachable option for every band
regardless, while treating the *absence* of a playtest the same as a
*failure* for the purpose of what counts as a band's primary route:
Sprouts' primary path through the world remains the card-based hub and the
Phaser view. This ADR's status stays "pending" until that playtest
actually runs.


## ADR-009: A world is a content pack, not a code path or a second identity

Status: Accepted

`docs/ROADMAP.md` Phase 29 asks for "multiple islands and worlds", with a
world/region registry, a travel system, shared player identity and inventory
across worlds, and content packaging. Two designs were available for the
persistence question, and this ADR records the one taken.

**Decision.** A world is authored content plus a manifest. Phase 29 adds no
Amplify model, no per-world profile, no per-world inventory, and no
cross-world synchronisation step.

- **Identity** is `ChildProfile`, unchanged. One child, one profile, every
  island.
- **Inventory** is `ChildInventory`, unchanged. One backpack, every island.
  Which world a treasure came from is read from that world's content pack at
  display time (`summarizeTravelPack`), never written onto the row.
- **Having been somewhere** is an ordinary `WorldChange`
  (`changeType: 'TRAVEL'`, `changeKey: 'ARRIVED_AT_<WORLD>'`), written
  through the Adventure Engine's existing `recordWorldChangeOnce`, with
  `sourceSessionId: 'travel:<world-slug>'` following the `discovery:<id>` and
  `quest:<id>` provenance conventions already in use.

**Why not per-world persistence.** The rejected alternative was a
`ChildWorldProfile`-style row per (child, world), with its own inventory and
progress. It fails on three counts, in order of seriousness:

1. **It is wrong for the child.** A five year old who finds a shell at home
   and sails to the cove has one bag, not two. Per-world inventory forces the
   product to answer "which of my selves earned this?", and there is no
   answer to that question a child in this age range should ever have to
   think about. CLAUDE.md pillar 7's calm engagement and section 6's rule
   against dependency both point the same way: travel should cost a child
   nothing they already have.
2. **It buys nothing today.** Every engine that could care about a world
   already keys off content ids, not places: a reward rule fires on what was
   done, a collectible set is finished wherever its last piece turns up, and
   mastery is a fact about a child rather than about an island. There is no
   behaviour a per-world row would enable that a content pack plus a
   `WorldChange` does not.
3. **It would be a migration.** Adding a per-child, per-world row after
   children have progress is a backfill; adding it later, if a genuine need
   appears, is the same backfill. Deferring costs nothing and keeps the
   schema honest about what the product actually models.

**What this ADR does not claim.** It does not claim worlds will never need
persistence. If a future world needs state that is genuinely about the place
rather than about the child (a shared seasonal state, a world-local
construction), that is a new model with a new reason, and this decision
should be revisited rather than stretched.

**Consequence for content.** Because a world is content, adding one has to
stay checkable by content rules rather than by review. Each world declares a
`WorldContentPack` listing every id it owns, and `packs.test.ts` asserts the
union of all packs covers every authored location, adventure, quest, item,
set, NPC, discovery, and story exactly once. Content belonging to no world
would have quietly opted out of every rule a world imposes, starting with
which children can reach it; that is now a failing test rather than a silent
gap.

## ADR-010: Android is a second client of one Amplify Gen 2 platform, not a second backend

Status: Accepted (platform-preparation scope only; native Android app
development stays out of scope per CLAUDE.md section 12 until separately
approved)

A detailed platform roadmap for Android integration was authored at
`docs/android/android.md` and needed a place in `docs/ROADMAP.md`. This ADR
records the architectural rule that roadmap section runs on, so it does not
have to be re-derived from a 28-phase document each time it is cited.

**Decision.** Amplify Gen 2 remains the single source of truth for
authentication, application data, learning content, gameplay state, and
business logic. A future Android client is a renderer and input surface on
top of that platform, exactly as the existing React web client is, per
`docs/android/android.md` section 2:

- **One backend, multiple clients.** Cognito identities, child profiles,
  learning records, progress, inventory, rewards, quests, stories, world
  definitions, and assets are shared. There is no separate Android database
  and no Android-only backend.
- **Clients render, backend decides.** Presentation, animation, input, and
  device-specific rendering stay client-side. Learning progression, XP
  awards, quest completion, inventory changes, unlock conditions, mastery
  calculations, and world progression stay server-authoritative — the same
  rule ADR-002 and ADR-003 already apply to the web client and the AI
  companion.
- **Content is data**, not React components, so a second client can read it
  without duplicating it.
- **The web client is no longer architecturally special.** Backend logic
  must not assume requests originate from a browser (no dependence on
  `localStorage`, cookies, or DOM APIs in shared business logic).

**Why this doesn't reopen CLAUDE.md section 12.** Section 12 lists "native
mobile applications" as out of scope until separately approved. That
restriction is about shipping a child-facing Android app, not about whether
the Amplify backend is written in a client-neutral way. The phases this ADR
covers (`docs/ROADMAP.md` "Phases 35+ — Android Platform Integration") are
backend audit, boundary-drawing, and API work that also benefits the
existing web client (Phase 44 in particular refactors the web client onto
the same platform-neutral APIs). No phase in that range ships an Android
application; Phase 45 (Android Readiness Gate) is the checkpoint after which
building the actual app would require the separate approval section 12
requires.

**Relationship to prior ADRs.** This does not change the rendering-layer
decisions in ADR-007/ADR-008 (Phaser, then Three.js) or the content-model
decision in ADR-009. Those govern how the *web* client's explorable world is
built. A first-person Three.js world is a browser/WebGL concern; if an
Android client is ever built, its own rendering stack (for example a native
engine, or a WebView embedding the same web client) is a separate decision
this ADR does not make.

**What this ADR does not claim.** It does not commit the product to
building an Android app on any particular timeline, and it does not claim
the current backend already satisfies the "one backend, multiple clients"
rule — Phase 35 (Platform Audit) exists precisely to find out where it
doesn't yet.

## ADR-011: No XP/coins/level economy; canonical content model is designed, not migrated, in Phase 36

Status: Accepted

`docs/ROADMAP.md` "Phase 36 — Canonical Identity and Content Models" covers
`docs/android/android.md` Phase 2 (Canonical Identity Model) and Phase 3
(Canonical Learning Content Model). Both are generic templates written
without reference to this product's actual domain model or design
philosophy, and two of their suggestions do not fit as written. This ADR
records what was built instead and why.

**Decision, part A — no `PlayerProfile` with level/XP/coins.**
`docs/android/android.md` Phase 2 suggests a `ParentAccount -> ChildProfile
-> PlayerProfile` chain, with `PlayerProfile` holding `level`, `xp`,
`coins`, `currentWorldId`, `currentZoneId`. This is a generic mobile-game
identity template, not a description of this product. CLAUDE.md pillar 7
explicitly rules out "loot-box mechanics" as a dark pattern, and
`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 27,
"World Progression Instead of XP", is exactly this decision already made:
"Avoid making numeric experience points the emotional center of the
product... the world itself is the record of achievement." Phase 24's
`ChildInventory` design already independently arrived at "there is no
currency, no sink" for the same reason. Adding a numeric level/XP/coins
model now, unused by any gameplay engine, would contradict a settled
product decision for the sole benefit of matching a generic template
literally.

No `PlayerProfile` model was added. Cognito already stores zero gameplay
attributes (`amplify/auth/resource.ts` declares only `loginWith`/`groups`),
and `ParentProfile -> ChildProfile` is already the canonical identity
chain, with every per-child gameplay fact already living in its own
owner-scoped Amplify Data model (`SkillProgress`, `WorldChange`,
`ChildInventory`, `ChildQuestState`, `ChildNpcState`, `ChildStoryProgress`,
`ChildWorldState` — the last of which already carries
`lastCheckpointId`, Phase 32's answer to "current world/zone position").
Phase 2's actual acceptance criteria — a Cognito user may own multiple
child profiles, each child has independent learning/gameplay state, and
both web and Android would resolve the same child identity — are already
met by the existing schema. This is the same kind of finding Phase 35 made
about API naming: nothing needed to change, so nothing was added just to
have added something.

**Decision, part B — the canonical content model is designed, not
migrated, and scoped to curriculum vocabulary only.**
`docs/android/android.md` Phase 3 suggests moving a generic `Subject ->
Course -> Unit -> Lesson -> Activity -> Question` hierarchy into shared
backend models. This product's actual content spans roughly fifteen
TypeScript-authored areas (catalogued in full in
`docs/platform/CURRENT_PLATFORM_AUDIT.md` section 4): adventures, stories,
quests, items, discoveries, NPCs, world/zone layouts, and the curriculum
graph. Migrating all of it in one phase would be large (hundreds of files),
risky (1,400+ existing tests exercise content that assumes it is
synchronous, in-process TypeScript), and premature — `docs/ROADMAP.md`
Phase 37 ("Learning State, Adventures/Quests, and Server-Authoritative
Actions") and Phase 38 ("Inventory, World Schema, and Asset Catalog")
already own the adventure/quest/item/discovery/NPC/world portions of that
list as their own deliverables, so migrating them here would preempt and
duplicate that work rather than prepare for it.

`docs/platform/CANONICAL_CONTENT_MODEL.md` scopes Phase 36 to exactly the
two content types CLAUDE.md section 9's "Required Domain Concepts" already
names and that every other model already references only by an opaque
`code`/`id` string: `LearningObjective` and the Phase 19 curriculum `Skill`
graph. It records a target Amplify Data schema (`Subject`, `Grade`,
`Domain`, `Skill`, with `LearningObjective` absorbed into `Skill` rather
than kept as a second, driftable vocabulary) but adds no model to
`amplify/data/resource.ts` and moves no content out of TypeScript this
phase.

**Why design now but migrate later, rather than either extreme.**
ADR-009 already decided "a world is a content pack, not a code path or a
second identity" and `docs/DATA_MODEL.md` already states a general
preference for source-controlled content over database rows for MVP —
content-in-code is a repeated, deliberate choice in this codebase, not an
oversight Phase 36 exists to correct. Migrating the curriculum graph into
live Amplify Data models today would add runtime read latency where there
is none, and would need a real write path for content designers to use
safely — but no admin/content-designer role exists yet
(`docs/AUTHORIZATION_REVIEW.md` section 4.3, and every phase's "Known
risks" section since Phase 3 has flagged this same gap). Paying that cost
today buys nothing: no Android client exists to read the shared model, and
ADR-010 already states this backlog "does not commit the product to
building an Android app on any particular timeline." Recording the target
shape now means a future migration — whenever one is actually motivated by
a real second client — has a concrete schema to build against without the
product paying for it before that day arrives.

**What this ADR does not claim.** It does not migrate any content, and it
does not preclude Phase 37 or Phase 38 from designing their own models
differently once they are reached — the curriculum-only boundary drawn
here is deliberately conservative and may be revisited once there is a
concrete reason to widen it.
