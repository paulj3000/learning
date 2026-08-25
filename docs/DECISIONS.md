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

## ADR-012: `submitAdventureAnswer` is the first server-authoritative gameplay mutation; the pilot's scope is explicit, not exhaustive

Status: Accepted

`docs/ROADMAP.md` "Phase 37 — Learning State, Adventures/Quests, and
Server-Authoritative Actions" is the single largest item in the Android
backlog: docs/platform/CURRENT_PLATFORM_AUDIT.md's Phase 35 audit found
that six gameplay engines (adventure correctness/completion, skill
mastery, rewards, quests, NPC relationships, discovery) each decide an
outcome client-side and write it straight to an owner-authorized Amplify
Data model, with no server re-check anywhere except `claimCoopSlot`
(Phase 17). Attempting all six at once was judged too large and too risky
to the existing 1,400+-test suite for one pass. This ADR records what was
built instead: a real, deployed-shaped pilot of exactly one path, chosen
because every other engine's grading ultimately depends on it.

**Decision.** `submitAdventureAnswer` (`amplify/data/resource.ts`,
`amplify/functions/submit-adventure-answer/handler.ts`) is now the sole
path by which a graded adventure step's correctness is decided and its
session transition is written, for every legitimate client. The Lambda
imports the exact same `validateStepAnswer`/`getNextStepId`/hint-ladder
logic and adventure content (`src/features/adventures/engine`,
`src/features/adventures/content`) the web client already shipped — the
answer key does not need to move to a database for this to be
authoritative, it only needs to run somewhere the caller cannot edit,
which a Lambda already is. `useAdventureSession.submitAnswer`
(`src/features/adventures/useAdventureSession.ts`) now calls this mutation
instead of running that logic itself and writing `AdventureSession`
directly.

**Ownership re-verification: `ChildProfile.ownerSub`, not a second
`ownerDefinedIn` rule.** `claimCoopSlot` (Phase 17) already established the
pattern for a Lambda that bypasses AppSync's own owner-authorization
resolvers: give it a field it can compare against the caller's raw Cognito
`sub` directly. `CoopSession` did that by replacing its owner rule
entirely with `allow.ownerDefinedIn('hostParentProfileId').identityClaim('sub')`.
`AdventureSession` is a much older, more heavily used, `allow.owner()`
model; changing its own authorization rule — or layering a second,
independent `ownerDefinedIn` rule beside the default one — was not a risk
worth taking with no way to deploy-verify the combination in this sandbox.
Instead, `ChildProfile` gets one new **plain** field, `ownerSub`, with no
authorization rule of its own: it inherits `ChildProfile`'s existing
`allow.owner()`, so only the legitimate owner can ever write to that row
(and therefore that field) in the first place, which is what makes a
stored value trustworthy. `createChildProfile` sets it going forward;
`ensureChildProfileOwnerSub` self-heals it for rows that predate the
field, called from `useAdventureSession`'s load effect the same way
`resumeOrStartSession` already is. See docs/AUTHORIZATION_REVIEW.md
section 1b for the full comparison to `claimCoopSlot`'s approach.

**Explicit residual scope boundary, documented rather than hidden.** This
pilot does *not*:

- Touch the `WORLD_CHANGE` auto-advance or terminal `COMPLETE` transition
  (`docs/ADVENTURE_ENGINE.md`), which still call the plain, owner-authorized
  `AdventureSession.update()` client-side. `AdventureSession.update()`
  therefore remains reachable by a sufficiently sophisticated caller
  crafting a raw GraphQL request directly, bypassing
  `submitAdventureAnswer` entirely for those two transition kinds — a real
  gap, not a false sense of security, and one that requires migrating
  those two paths and then removing `update` from `AdventureSession`'s
  owner grant to close, which is more than "pilot one path" was scoped to
  mean.
- Move `AdventureAction`/`SkillEvidence`/`SkillProgress` writes into the
  Lambda. They remain plain client-side, owner-authorized writes, now
  populated from this mutation's server-verified `correctness`/
  `supportLevel` rather than from client-computed values — raising the bar
  against casual tampering (the previous, trivial "just flip one field in
  the request payload" exploit) without closing every path a raw GraphQL
  call could still reach.
- Touch mastery, rewards, quests, NPC relationships, or discovery at all —
  the other five engines the Phase 35 audit flagged remain exactly as
  they were, unaffected by this change, and are still Phase 37's own
  remaining backlog.

**Why ship a narrower, explicitly-scoped win rather than wait for a
complete migration.** Every legitimate client — the web client today, any
future Android client — now gets a genuinely tamper-resistant answer to
"was this correct," which is both the single highest-value exploit the
Phase 35 audit surfaced (self-reporting *any* answer as correct, on *any*
graded step, was previously a one-field change to a normal request) and
the foundation every other engine's grading already depends on. Waiting
for a single pass that closes every model at once would mean shipping
none of this progress now, for a backlog item ADR-010 already says carries
no fixed timeline.

**What this ADR does not claim.** It does not claim `AdventureSession` (or
any other model touched by the remaining five engines) is now fully
tamper-proof against a determined attacker with raw GraphQL access — only
that the specific, highest-value client-side decision this pilot targeted
no longer is. The residual gaps above are the concrete backlog for
whichever future phase continues Phase 37, not oversights this ADR is
unaware of.

## ADR-013: Item/world/NPC/asset canonical models are designed, not migrated, in Phase 38; drop-rate and currency item fields are rejected

Status: Accepted

`docs/ROADMAP.md` "Phase 38 — Inventory, World Schema, and Asset Catalog"
covers `docs/android/android.md` Phases 7-9. This ADR applies the same
"design the target schema now, migrate only when a real second client
needs it" treatment ADR-011 already established for Phase 36's curriculum
content model, extended here to items, world/zone/NPC content, and the 3D
asset catalog, and records one additional product-design rejection in the
same spirit as ADR-011's XP/coins/level decision.

**Decision, part A — no drop-rate rarity, no stackable/tradable items.**
`docs/android/android.md` Phase 7 suggests `ItemDefinition` fields for
`rarity` (implying scarcity/drop weighting), `stackable`, and `tradable`.
This product's own `ItemDefinition` (`src/features/rewards/types.ts`)
already has a `rarity` field, but its own doc comment already rules out
the android.md reading: "emphatically NOT a drop chance, a power tier, or
a status rank," asserted by `rewardTable.test.ts`. `stackable` and
`tradable` do not exist and are not proposed: this product's inventory has
no quantity (an item is owned or not) and no trading feature, per the same
"no currency, no sink" design `rewardTable.ts` documents and the
explorable-world roadmap's "avoid systems designed around envy, rarity
pressure, or leaderboards." As with ADR-011's XP rejection, this is an
existing, deliberate product decision the generic template does not
know about, not a gap Phase 38 exists to fill.

**Decision, part B — item/world/asset canonical models are designed, not
migrated.** `docs/platform/WORLD_ITEM_AND_ASSET_MODEL.md` records target
Amplify Data schemas for `ItemDefinition`, `WorldDefinition`/
`WorldContentPack`, and an asset catalog entry, grounded in this product's
actual existing TypeScript types rather than android.md's generic ones.
No model is added to `amplify/data/resource.ts`, no content moves out of
TypeScript, and no asset moves to S3 this phase — same reasoning as
ADR-011: ADR-009 already decided content is a pack, not a database row,
and there is still no admin/content-designer write path for whoever would
maintain these rows if they existed today.

**Decision, part C — inventory server-authority stays Phase 37's tracked
item, not duplicated under Phase 38.** `docs/android/android.md` Phase 7's
own acceptance criteria include "inventory changes are server-authoritative,"
which is `grantRewards` (`src/features/rewards/api.ts`) — one of the five
remaining `NEEDS_MIGRATION` write paths ADR-012 already catalogued and
explicitly deferred. It is not resolved here: unlike `submitAdventureAnswer`,
a reward grant's legitimacy depends on quest/discovery/NPC state that is
itself not yet server-verified, so it is not a well-isolated next pilot in
the way the adventure-answer path was, and folding it into Phase 38 under
a different name would duplicate an already-tracked backlog item rather
than close it.

**Decision, part D — NPC placement is not unified, and this document says
so rather than guessing.** Investigating this product's actual NPC content
surfaced three separate, un-unified representations (a dialogue/schedule
"domain" NPC, a 2D Phaser placement NPC, and a 3D Three.js placement,
joined only by shared string ids) across only two of ten island locations
that have a Three.js region at all. `docs/android/android.md` Phase 8's
own acceptance criterion — "the same zone definition can be interpreted by
both clients" — is not yet true between this product's *own two existing
web renderers*, before an Android renderer is even considered. This ADR
does not resolve that design question; `docs/platform/WORLD_ITEM_AND_ASSET_MODEL.md`
section 5 records it as the concrete first question whichever future phase
attempts this migration needs to answer.

**What this ADR does not claim.** It does not migrate any content or
asset, does not resolve the NPC-unification question, and does not close
Phase 37's inventory-server-authority follow-up — all three are explicit,
tracked gaps for future work, not oversights.

## ADR-014: Authorization is classified now; content manifest and API versioning are designed, not built, until they have something to protect

Status: Accepted

`docs/ROADMAP.md` "Phase 39 — Manifest, Versioning, and Authorization"
covers `docs/android/android.md` Phases 10-12. The three sub-phases split
cleanly on one question: does the work have a real subject to act on
today? Authorization does — every model in `amplify/data/resource.ts`
already exists and already has a rule. Content manifests and API
versioning do not — they exist to protect content and clients that do not
exist in this backend yet.

**Decision, part A — authorization classification, done for real.**
`docs/AUTHORIZATION_REVIEW.md` section 0 classifies every model and
custom operation against android.md Phase 12's
`PUBLIC | AUTHENTICATED | OWNER | PARENT | CHILD | ADMIN | SYSTEM`
taxonomy. This is real, complete audit work, not deferred: the schema
already exists, so there was no migration to wait for. It confirms both of
Phase 12's acceptance criteria already hold — no privileged mutation
depends merely on being authenticated (`claimCoopSlot` and
`submitAdventureAnswer` both re-derive real authorization inside their
handlers; the two AI generation routes touch no persisted resource, so
`AUTHENTICATED` alone is correct for them, not a gap), and parent-child
ownership is enforced server-side by AppSync's own owner-authorization
resolvers for every model. It also records one taxonomy mismatch worth
keeping: android.md's `CHILD` classification assumes a child has an
independent authenticated session, which ADR-001 rules out for this
product — every `CHILD`-shaped grant in the generic taxonomy collapses
into `OWNER` here.

**One thing this classification pass deliberately does not claim.**
"Parent-child ownership is enforced server-side" answers *who* may write a
row, not *whether the value they write is true* — that is
`docs/DECISIONS.md` ADR-012's separate, already-tracked Phase 37 backlog
(mastery, rewards, quests, NPC relationships, discovery still accept a
self-computed value from their rightful owner). Section 0 states this
distinction explicitly so the classification table cannot be read as
having closed ADR-012's gap.

**Decision, part B — content manifest and API versioning are designed,
not built.** `docs/platform/MANIFEST_AND_API_VERSIONING.md` records target
shapes for both, and builds neither. A content manifest's entire purpose
is letting a client skip re-downloading content that has not changed — it
has nothing real to version until Phase 36/38's designed-but-not-migrated
content models actually exist as rows. API versioning exists to protect
an *installed* client sitting on a device for months from a silent
backend change; no such installed client exists, and the web client's
"always redeploy latest" model has no equivalent problem to protect
against. Building either now would be real, ongoing-maintenance
infrastructure with zero consumers — the same category of premature cost
ADR-011/ADR-013 already declined to pay for content and asset migration,
applied here to the systems that would sit on top of that content once it
exists.

**What this ADR does not claim.** It does not claim every authorization
rule in this schema is deploy-verified (docs/AUTHORIZATION_REVIEW.md
section 5's live-backend checklist is unchanged by this pass), and it does
not commit to when content manifests or API versioning will actually be
built — only that building them now, with nothing to version and no
installed client to protect, would be premature.

## ADR-015: Cross-device sync and write idempotency are audited as they exist today; device registration and a requestId model are designed, not built

Status: Accepted

`docs/ROADMAP.md` "Phase 40 — Device, Sync, and Offline Support" covers
`docs/android/android.md` Phases 13-15. As with Phase 39, the three
sub-phases split on whether this product already has a real subject to
examine.

**Decision, part A — device registration is designed, not built.** No
model is added for `DeviceRegistration`. Every one of android.md's stated
uses (app-version tracking, telemetry, sync debugging, push notifications,
security review, stale-device cleanup) presumes either a second platform
or a push-notification feature, and this product has neither today.
`docs/platform/DEVICE_SYNC_AND_OFFLINE_SAFETY.md` section 1 records a
target shape.

**Decision, part B — cross-device sync is audited, precisely, as it exists
today.** Unlike device registration, this product already has real,
inspectable sync behavior: every model android.md's Phase 14 lists as
needing to synchronize (minus `XP`/`levels`/`coins`, already rejected by
ADR-011) is already an Amplify Data model read fresh on every load, with
no client-side cache anywhere in `src/` (confirmed by the Phase 35 audit).
The finding is precise rather than a blanket "yes" or "no": *sequential*
cross-device consistency (open on device B after finishing on device A)
already holds by construction, because nothing is cached to go stale.
*Concurrent* live push between two simultaneously-open sessions does not
— a full-tree search found exactly one GraphQL subscription anywhere in
this codebase (`CoopSession.onUpdate`, Phase 17's co-op feature, the one
case actually designed around two devices needing to see each other's
state in real time). This is recorded as a known, low-priority gap rather
than fixed: this product's calm-engagement design (CLAUDE.md pillar 7)
does not encourage simultaneous multi-device play by one child in the
first place.

**Decision, part C — write idempotency is audited engine by engine, and
found to already hold almost everywhere.** `docs/android/android.md`
Phase 15 asks for retry-safe mutations so a queued, retried Android action
cannot double-award rewards or duplicate quest completion.
`docs/platform/DEVICE_SYNC_AND_OFFLINE_SAFETY.md` section 3 checks every
write path against this and finds the content-level idempotency this
phase asks for was already independently built into this codebase's
reward/world-change/quest/discovery/NPC engines, well before Android was
under consideration (`grantedRuleIds`, `changeKey`, membership checks
before array appends, and quest state that is recomputed rather than
logged) — `docs/ARCHITECTURE.md` and `docs/DATA_MODEL.md` already use the
word "idempotent" to describe several of these independently. The
precise, narrow exception: three append-only audit/evidence writes
(`AdventureAction`, `SkillEvidence`, `StoryArtifact` creates) have no
natural collision key and would duplicate under a raw retry — but none of
the three are aggregated reward/progress state, so a duplicate is a minor
data-quality issue (an inflated attempt count on one parent-dashboard
report), not a duplicate-reward exploit. A `requestId`-based
`ProcessedCommand` design is recorded for these three specifically
(section 4), not built, since there is no offline queue in this codebase
today that could actually produce a duplicate retry to guard against.

**Why this is a stronger finding than "audit passed."** This is not a case
of discovering nothing was wrong because nothing was checked closely
enough — `docs/DATA_MODEL.md` and `docs/ARCHITECTURE.md` already documented
several of these idempotency guarantees independently, for reasons that
had nothing to do with a future Android client (mainly: a child re-playing
an adventure, or a page reload mid-session, must never re-grant a reward
or re-count a discovery). Phase 40's contribution is confirming those
guarantees generalize to the offline-retry framing android.md asks for,
and precisely naming the three writes that do not.

**What this ADR does not claim.** It does not claim any of this is
deploy-verified against real concurrent devices or a real retried request
(no AWS credentials in this sandbox, the same recurring constraint), does
not build `DeviceRegistration` or `ProcessedCommand`, and does not resolve
`upsertSkillProgress`'s accumulator-style sensitivity to genuine duplicate
calls — a pre-existing property of the Mastery Engine unrelated to offline
retries specifically, out of scope for this ADR.

## ADR-016: Adaptive learning becomes a real shared query; events stay typed models, not a new generic log; parent APIs are audited, not yet promoted

Status: Accepted

`docs/ROADMAP.md` "Phase 41 — Events, Adaptive Learning, and Parent APIs"
covers `docs/android/android.md` Phases 16-18. The three split on a
different axis than Phase 39/40's "is there a real subject yet": here, all
three have a real subject (event-worthy facts, a working recommendation
engine, a working dashboard), but only one is worth building as a new
shared Lambda-backed query right now.

**Decision, part A — no generic event system.** `docs/android/android.md`
Phase 16's event vocabulary (`LESSON_COMPLETED`, `QUESTION_ANSWERED`, ...)
maps cleanly onto models this schema already has —
`docs/platform/EVENTS_ADAPTIVE_LEARNING_AND_PARENT_APIS.md` section 1
checks every example event type against this codebase and finds all but
two (`ACHIEVEMENT_EARNED`, which has no real equivalent since there is no
achievement system, and `SESSION_STARTED`/`SESSION_ENDED`, an app-usage
concept this product does not track) already recorded, more strongly
typed than a generic `payload: AWSJSON` would be, by exactly the models
already built for them. Building a parallel `Event` model would duplicate
data already recorded for no new capability; the one genuine gap
(`deviceId`/`source` tagging) is ADR-015's already-deferred
`DeviceRegistration`, not a reason to build a second system.

**Decision, part B — the Adaptive Adventure Director becomes a real,
shared, Lambda-backed query.** Unlike device registration or a content
manifest, `docs/android/android.md` Phase 17's
`getNextLearningActivity(childProfileId)` already had a complete answer in
this codebase: the Director (`src/features/director/`, Phase 28) — pure,
deterministic, already tested, just running only in the browser bundle.
`getNextLearningActivity` (`amplify/functions/get-next-learning-activity/`)
now runs that same unchanged logic server-side, reusing ADR-012's
`ChildProfile.ownerSub` ownership check. This is meaningfully lower-risk
than `submitAdventureAnswer`: read-only, no session-state write to guard,
and a wrong ranking has no security consequence — the value is purely
avoiding two clients silently reimplementing, and diverging on, the same
recommendation algorithm. `src/routes/ChildDashboard.tsx` now calls it in
place of the old client-side `suggestNextAdventure`, which is deleted
along with `buildDirectorContext`/`listReachableAdventures`; the reachable-worlds
filter they used is extracted to a new, independently useful pure module,
`src/features/director/reachability.ts`.

**One real architectural fix fell out of this work, not just a Lambda.**
`src/features/mastery/summary.ts`'s `indexProgressBySkill` took its input
type from the impure `src/features/mastery/api.ts` (which imports the
browser Amplify Data client and, transitively, `import.meta.glob`). A
Lambda's TypeScript program reaching that type — even only through a
type-only import — fails to typecheck, since `amplify/tsconfig.json` has
no Vite ambient types. Rather than widen that tsconfig for every future
Lambda, `summary.ts` now declares its own minimal `SkillProgressLike`
structural type, fully decoupling this pure engine module from the impure
client module even at the type level — a small win independent of this
phase's Android motivation, and non-breaking for every existing caller.

**Decision, part C — parent APIs are audited, not promoted to a new
Lambda this phase.** `docs/platform/EVENTS_ADAPTIVE_LEARNING_AND_PARENT_APIS.md`
section 3 confirms the parent-dashboard assembly functions
(`weeklySummary.ts`, `masteryOverview.ts`, `adventureSupport.ts`,
`educatorReport.ts`) are already pure and already read only
owner-authorized models — both of Phase 18's acceptance criteria's
underlying requirements already hold. They are not promoted to a shared
query this phase: a dashboard query would need to read a meaningfully
larger set of tables than the Director's four, and this phase already
shipped one complete, tested, production-shaped example of the pattern.
Doing the one well was judged higher value than spreading the same effort
across a second, larger Lambda in the same pass — the same "pilot one
path" reasoning ADR-012 already applied to Phase 37's six write paths.

**What this ADR does not claim.** It does not claim `getNextLearningActivity`
is deploy-verified (the same recurring sandbox constraint, plus the
specific `Scan`-vs-`Query`/GSI-name uncertainty its own handler comment
documents), does not build a parent-dashboard query or a `DeviceRegistration`-backed
event system, and does not change any of the Director's actual ranking
rules — only where they run.

## ADR-017: Environment/config/contract-test infrastructure is documented, not created; provisioning a real environment is an explicit human decision

Status: Accepted

`docs/ROADMAP.md` "Phase 42 — Environments, Config, and Cross-Platform
Testing" covers `docs/android/android.md` Phases 19-21. Unlike every prior
phase in this backlog, this one is not a code-vs-design split — it is a
"do not take this action unilaterally" boundary. Creating a real
`staging`/`production` Amplify branch environment provisions real AWS
infrastructure (a second Cognito pool, AppSync API, set of DynamoDB
tables, S3 bucket) with real cost and access-control consequences. That is
an infrastructure action reserved for an explicit, human-authorized
decision under this project's own operating rules, not something a
documentation pass should do on a roadmap phase's authority alone.

**Decision, part A — the environment-separation mechanism already
exists; recorded, not built.** `amplify.yml`'s existing
`ampx pipeline-deploy --branch $AWS_BRANCH` already gives this repo
Amplify Hosting's standard branch-per-environment model: any new Git
branch connected to Amplify Hosting already provisions its own fully
isolated backend, using infrastructure already committed. What is
missing is not a mechanism but branches — only `main` exists today.
`docs/platform/ENVIRONMENTS_CONFIG_AND_CONTRACT_TESTS.md` records this
finding and maps android.md's development/staging/production vocabulary
onto it, without creating any branch or deciding branch-naming
conventions, which are deployment-topology decisions for whoever operates
the real AWS account.

**Decision, part B — generated client configuration needs nothing new.**
`docs/android/android.md` Phase 20's `npx ampx generate outputs` is
already how the web client obtains its own configuration
(`src/lib/amplify-config.ts`'s `amplify_outputs.json`, generated and
gitignored, never hand-maintained) — an Android project would run the
same Amplify Gen 2 tooling against the same backend. Nothing in this
repository needs to change for this acceptance criterion to hold once an
Android project exists.

**Decision, part C — cross-platform contract tests are listed, not
written, and their underlying claim is largely already audited.** No
contract test can run without a second client to run it against. The
target test list recorded in
`docs/platform/ENVIRONMENTS_CONFIG_AND_CONTRACT_TESTS.md` section 3 is the
concrete backlog for whenever one exists. Its underlying structural claim
— a write through Amplify Data is visible to any other authenticated
caller reading the same owner-scoped data — is not a new question:
`docs/platform/DEVICE_SYNC_AND_OFFLINE_SAFETY.md` (Phase 40, ADR-015)
already audited exactly this for cross-device sync and found it already
true by construction (no client-side caching anywhere). A future
Android/web contract-test suite exercises that same already-true property
against a genuinely different client for the first time; it does not
discover a new one.

**Why this phase looks different from Phases 36-41.** Every prior phase
in this backlog either designed a schema with nothing built, or built one
well-scoped, low-risk, reversible piece of application code (a Lambda, a
query). Phase 42's subject matter — cloud environments and billed
infrastructure — is not reversible the same way a Lambda deploy is, and
is explicitly out of this ADR's authority to create. Recording what
already exists and what a human would need to decide is the whole,
correctly-scoped deliverable here.

**What this ADR does not claim.** It does not create any AWS resource,
Git branch, or CI change, does not decide environment-to-branch naming
conventions, and does not write any contract test — all three require
either a second client or an explicit, separate human decision to
provision real infrastructure.
