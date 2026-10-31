# Architecture Decision Log

## ADR registry and governance

This file is the single authoritative ADR log. The registry below lists every identifier in use or reserved. `npm run adr:check` (also run by `make js-check` and CI) fails on a duplicate or malformed heading, a heading without a registry row, a registry row without a heading (unless `Reserved`), a registry title that differs from its heading, and any `ADR-nnn` reference that is malformed or names an unknown identifier.

**Syntax.** A decision is a heading `## ADR-NNN: Title` with exactly three digits, followed by a `Status:` line. Reference it everywhere as `ADR-NNN` (three digits). `ADR-NNN` itself is a placeholder and is ignored by the check.

**Rules.**

1. Every ADR identifier is unique across the integrated repository. Two different decisions never share one.
2. Before assigning a number, read this registry on the integration branch (and `git show origin/main:docs/DECISIONS.md` if main may have moved). Take the next free number after every row here, including `Reserved` rows.
3. An identifier is stable once a decision is integrated. Renumber only to remove a real collision, and record the old and new number in the registry notes and in a renumbering map.
4. A merge is not complete until `npm run adr:check` passes. Before merging a branch, compare its `## ADR-` headings against this registry.
5. When two branches have independently used a number, determine from content which decision each reference means. Never search and replace across files.
6. Superseding a decision leaves its section in place. Change its `Status:` line and add the superseding ADR; the registry row keeps the number.
7. Do not delete a decision. Reserve a number for a decision known to exist elsewhere but not yet merged (`Reserved` status).

**Format recommendation.** Keep this single file plus the registry table. Individually named ADR files would force moving about 4,500 lines and rewriting links for no collision benefit the check does not already give. Revisit only if the log passes roughly 50 decisions.

**Next free identifier number: 040.**

| ID | Title | Status | Origin | Notes |
|---|---|---|---|---|
| ADR-001 | Parent-owned accounts | Accepted | Base (shared by all branches) |  |
| ADR-002 | Deterministic engine before AI | Accepted | Base (shared by all branches) |  |
| ADR-003 | Structured AI output | Accepted | Base (shared by all branches) |  |
| ADR-004 | No open-ended child chat in MVP | Accepted | Base (shared by all branches) |  |
| ADR-005 | Persistent world consequences | Accepted | Base (shared by all branches) |  |
| ADR-006 | Household co-presence adventures, no communication channel | Proposed | Base (shared by all branches) |  |
| ADR-007 | Phaser as the world-engine rendering library | Accepted | Base (shared by all branches) | Retirement mandated by ADR-020 |
| ADR-008 | Three.js first-person world supersedes Phaser as the next-generation renderer | Accepted | Base (shared by all branches) |  |
| ADR-009 | A world is a content pack, not a code path or a second identity | Accepted | Base (shared by all branches) |  |
| ADR-010 | Android is a second client of one Amplify Gen 2 platform, not a second backend | Accepted | Base (shared by all branches) |  |
| ADR-011 | No XP/coins/level economy; canonical content model is designed, not migrated, in Phase 36 | Accepted | Base (shared by all branches) |  |
| ADR-012 | `submitAdventureAnswer` is the first server-authoritative gameplay mutation; the pilot's scope is explicit, not exhaustive | Accepted | Base (shared by all branches) |  |
| ADR-013 | Item/world/NPC/asset canonical models are designed, not migrated, in Phase 38; drop-rate and currency item fields are rejected | Accepted | Base (shared by all branches) |  |
| ADR-014 | Authorization is classified now; content manifest and API versioning are designed, not built, until they have something to protect | Accepted | Base (shared by all branches) |  |
| ADR-015 | Cross-device sync and write idempotency are audited as they exist today; device registration and a requestId model are designed, not built | Accepted | Base (shared by all branches) |  |
| ADR-016 | Adaptive learning becomes a real shared query; events stay typed models, not a new generic log; parent APIs are audited, not yet promoted | Accepted | Base (shared by all branches) |  |
| ADR-017 | Environment/config/contract-test infrastructure is documented, not created; provisioning a real environment is an explicit human decision | Accepted | Base (shared by all branches) |  |
| ADR-018 | Structured request logging ships for real; performance and the remaining server-authoritative write paths are audited, not built | Accepted | Base (shared by all branches) |  |
| ADR-019 | Migrate the backend from Amplify Gen 2 to Django + DRF incrementally | Accepted in part | Django migration line | Sub-decision 8 accepted and gate G4 resolved 2026-10-24 (Python rules, Django content authority, versioned JSON) |
| ADR-020 | Three.js is the exclusive gameplay renderer; Phaser is retired; `game/` is a first-class package | Accepted | Django migration line |  |
| ADR-021 | Django 6.1, DRF 3.18, and psycopg 3 for the backend skeleton | Accepted | Django migration line |  |
| ADR-022 | `ParentAccount` is the Django user model; `ChildProfile` is a managed profile, not a login | Accepted | Django migration line |  |
| ADR-023 | The admin section is styled with Tailwind CSS and shadcn/ui; the rest of the app stays on CSS Modules | Accepted | Main line (Storykeeper Castle / engine) | Integrated from `origin/main`; number unchanged |
| ADR-024 | Cognito remains the authentication authority; Django validates bearer access tokens | Accepted in part | Django migration line | Items 1 and 2 amended by ADR-038 for local development only (`AUTH_PROVIDER=django`) |
| ADR-025 | Exceptions are logged as type and location, never as message | Accepted | Django migration line |  |
| ADR-026 | Multiplayer runs on a separate authoritative room server over WebSocket; the engine only renders it | Accepted | Main line (Storykeeper Castle / engine) | Integrated from `origin/main`; number unchanged |
| ADR-027 | A story chapter may be played inside a 3D region; the Story Engine keeps sole ownership of progress | Accepted | Storykeeper Castle line | Renumbered from ADR-019 |
| ADR-028 | Where the castle's art comes from | Proposed | Storykeeper Castle line | Renumbered from ADR-020 |
| ADR-029 | Phaser 2D views are phased out; new regions are authored in Three.js only | Accepted | Storykeeper Castle line | Renumbered from ADR-021. Related to ADR-020, not a duplicate |
| ADR-030 | Uploaded models live in S3 behind Admins-only Asset records; the bundled manifest stays the runtime fallback | Accepted | Storykeeper Castle line | Renumbered from ADR-022 |
| ADR-031 | Islands and Adventures are an admin catalog overlaid on source-controlled content; Superusers are Admins with one extra group | Accepted | Main line (Storykeeper Castle / engine) | Renumbered from ADR-024 on `origin/main`. To be superseded when LAI-0801/0802 move catalog editing to Django (ADR-019 sub-decision 8). Treasure Rush's TR-D3 (admin-authored content as authoritative, which would have changed it) was not adopted (ADR-033) |
| ADR-032 | Three.js locations are described by a serializable manifest that reuses the existing interaction and checkpoint vocabularies | Accepted | Main line (Storykeeper Castle / engine) | Renumbered from ADR-025 on `origin/main` |
| ADR-033 | One Django backbone: Treasure Rush runs on the canonical catalog and progress models; play-region layouts are seed-authored until LAI-0805 | Accepted | Integration (POST-MERGE-03) |  |
| ADR-034 | Django Admin is enabled with local staff sign-in, separate from Cognito; it ships as a gunicorn and WhiteNoise container | Accepted | Main line (LAI-0404) | Amends ADR-024 A4 for Django Admin only; resolves TR-D5 |
| ADR-035 | The shared asset manager versions binaries on the canonical ContentAsset identity, with private storage and signed delivery | Accepted | Feature branch (LAI-2200) | Accepted 2026-10-25. Amends ADR-034 item 3 (Django permissions and groups); builds on ADR-030 and ADR-033. Amended by AM-10 (staff-only admin preview route) |
| ADR-036 | Native Android uses the Django API with Cognito bearer tokens; the game-only WebView uses a ticket-redeemed, child- and region-scoped game session cookie | Proposed | Feature branch (LAI-ANDROID-API-001) | Implemented 2026-10-25 at the Django API boundary; owner acceptance pending. Builds on ADR-024 and ADR-033; does not change ADR-034 |
| ADR-037 | The Django backend is released to one EC2 instance per environment from GitHub Actions through ECR and SSM, with GitHub OIDC and no stored AWS keys | Accepted | Feature branch (feature/aws-ec2-auto-deployment) | Owner-directed 2026-10-30 (LAI-1003, LAI-1004, LAI-1006). Repository side only: provisioning and every deploy stay owner-approved (ADR-019 G1, G7). Prod on EC2 is the initial step; ECS Fargate (LAI-1007) stays the production candidate |
| ADR-038 | Environment-selectable API authentication: Cognito in AWS, local Django sign-in for development, one Django user and authorization model | Accepted | Main line (merged 2026-10-31, `beebb6a`) | Owner-directed 2026-10-30 (LAI-AUTH-DUAL). Amends ADR-024 Accepted items 1 and 2 for `AUTH_PROVIDER=django` only; builds on ADR-034 (the admin session stays separate). AWS environments are unchanged |
| ADR-039 | Django is the authority for parent and child profiles in every build with the Django API; Amplify profiles only until the controlled import and cutover; read-only audited Django Admin inspection | Accepted | Feature branch (feature/lai-child-django) | Owner-directed 2026-10-31 (LAI-CHILD-001). Amends ADR-034 and ADR-024 A4 for read-only, permission-gated, audited profile inspection in Django Admin only. Hard deletion stays blocked by LAI-0209. No production data is moved |

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

Status: Accepted. **Retirement mandated by ADR-020**: no new Phaser gameplay; Phaser is
removed once every Phaser world is converted and verified.

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
child-facing rollout. **Amended by ADR-020**: Phaser may no longer serve as the permanent
Sprouts fallback; the fallback is a guided camera profile inside the Three.js engine. The
Sprouts playtest requirement itself is unchanged.

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

## ADR-018: Structured request logging ships for real; performance and the remaining server-authoritative write paths are audited, not built

Status: Accepted

`docs/ROADMAP.md` "Phase 43 — Observability, Performance, and Security
Hardening" covers `docs/android/android.md` Phases 22-24. Unlike Phase 42
(a single "do not act unilaterally" boundary) and unlike Phases 36-41
(each one build-vs-design split along a single axis), this phase's three
source phases are not the same kind of question, so they get three
different treatments rather than one blanket decision.

**Part A — observability ships as real code.** None of this backend's
three synchronous custom Lambda resolvers (`claimCoopSlot`,
`submitAdventureAnswer`, `getNextLearningActivity`) logged anything about
their own invocations before this phase — a slow or failed call left no
trace. `amplify/functions/shared/requestLog.ts` is new, small,
unit-tested, framework-free application code, the same size and risk
class as `claim-coop-slot`'s own `decideClaim` — a genuinely buildable
piece with no billed-infrastructure or second-client dependency, unlike
Phase 42's subject matter. It ships this phase. Full detail in
`docs/platform/OBSERVABILITY_PERFORMANCE_AND_SECURITY.md` section 1,
including which android.md-requested log fields (`deviceId`, `eventId`,
API version) have no real subject yet and are deliberately not stubbed
into the log shape until `DeviceRegistration`/`ContentManifest` (ADR-014,
ADR-015) exist to give them one.

**Part B — performance and cost review is an audit that changes
nothing.** Every `.list()` call in this codebase already returns only one
family's own rows under owner authorization, at a data volume (tens of
rows per child) where pagination has no real benefit yet — except the
admin directory's cross-family `.list()`, an already-tracked gap from
Phase 39, not a new finding. Every 3D asset in `public/models/` is a 4-16
KB hand-built placeholder Phase 34 will replace outright; sizing a
mobile-appropriate budget against placeholder geometry would produce a
number with no bearing on the real asset pipeline. Adding pagination or
query narrowing with no second client and no measured cost problem would
be designing for a hypothetical this product does not have yet (CLAUDE.md
section 13). Full detail in
`docs/platform/OBSERVABILITY_PERFORMANCE_AND_SECURITY.md` section 2.

**Part C — the remaining five server-authoritative write paths are
re-audited with exact citations, not migrated.** ADR-012 (Phase 37)
already scoped its own work down to one pilot (`submitAdventureAnswer`)
out of six flagged client-authoritative write paths, deliberately. This
phase confirms — with file:line citations for each write function and
client call site, not by assumption — that skill mastery
(`SkillProgress`), rewards (`ChildInventory`), quests
(`ChildQuestState`), NPC relationships (`ChildNpcState`), and discovery
(`ChildWorldState`) are still exactly as client-authoritative as ADR-012
described: server-enforced ownership, client-computed correctness. Table
in `docs/platform/OBSERVABILITY_PERFORMANCE_AND_SECURITY.md` section 3.
Migrating all five is real production code comparable in scope to Phase
37's own pilot — a multi-resolver undertaking this phase does not
attempt, both because ADR-012's original scoping decision stands
unchanged and because none of it could be verified against a live
DynamoDB table in this sandbox (no AWS credentials, the same recurring
constraint as every prior phase). The audit table itself is the concrete
spec for that follow-up.

**Why this phase looks different from every prior one in this range.**
Phases 36-41 each split cleanly into "build the small reversible piece,
design the rest." Phase 42 was a single infrastructure-authority
boundary. Phase 43 needed three separate treatments because its three
source phases differ in kind: observability had a genuinely small,
real, buildable gap; performance had no real gap at all at current scale;
security hardening had a real, already-known, already-scoped gap too
large to close in one more phase without reopening ADR-012's own scoping
decision.

**What this ADR does not claim.** It does not migrate any of the five
remaining write paths to a Lambda resolver, does not add pagination or
change any query, does not build a CloudWatch dashboard over the new
request-log lines, and does not add rate limiting anywhere in this
backend.

## ADR-019: Migrate the backend from Amplify Gen 2 to Django + DRF incrementally

Status: **Accepted in part** (project owner, 2026-10-17). The architectural direction below
is approved. Operational, data, and security decisions are **not** accepted and stay gated
(see "Open gates"). Approval authorizes planning and the non-deploying implementation tasks
in `docs/DJANGO_MIGRATION_ROADMAP.md`. It does **not** authorize deleting or changing
deployed Amplify resources, migrating production data, deploying, or retiring Phaser.

The "one Amplify Gen 2 platform" rule in ADR-010 and the Amplify baseline in `CLAUDE.md`
section 8 remain the **deployed and operating baseline until cutover** (Phases 12 and 13).
ADR-010 is superseded only when LAI-1303 completes.

**Amended by ADR-020 (Accepted).** Sub-decisions 6 and 7 below are superseded; the target
shape in `docs/DJANGO_TARGET_ARCHITECTURE.md` now includes a first-class `game/` package.
Sub-decisions 1 to 5 and 8 to 12 are unchanged and remain Proposed. Accepting ADR-020 does not
accept any of them. (Status as of 2026-10-24: the table below is current; sub-decisions 1 to 5
are accepted as direction, and sub-decision 8 is accepted by the amendment that follows the
open gates.)

Evidence and analysis: `docs/DJANGO_MIGRATION_ASSESSMENT.md`,
`docs/CURRENT_AWS_RESOURCE_INVENTORY.md`, `docs/IAM_ROLE_AUDIT.md`. Target:
`docs/DJANGO_TARGET_ARCHITECTURE.md`. Sequence: `docs/DJANGO_MIGRATION_ROADMAP.md`.

**Context.** The product is growing into a platform (islands, quests, rewards, inventory,
progression, co-op, admin). Five of six gameplay write paths are client-authoritative
(`docs/platform/CURRENT_PLATFORM_AUDIT.md`). Each persisted model adds a DynamoDB table and an
IAM role (40 roles per environment in the local synth, 17 of them one-per-model). The IAM
quota is raisable, so it is not the reason. The reason is that a relational, service-layer
backend fits the platform direction better than adding more AppSync resolvers, and that new
content should be data rows, not infrastructure.

| # | Sub-decision | Status | Note |
|---|---|---|---|
| 1 | Django + Django REST Framework backend (`lai/`) | **Accepted** (direction) | Incremental strangler; Amplify untouched until cutover |
| 2 | PostgreSQL as the relational store | **Accepted** (direction) | Replaces 17 DynamoDB tables. Schema and data migration remain gated |
| 3 | Retain Cognito for authentication | **Accepted** (initially) | Django validates JWTs. Pool ownership and detach plan remain gated (gate G2) |
| 4 | Retain S3 for binaries; metadata in PostgreSQL | **Accepted** (direction) | Child photos via presigned URLs; object migration remains gated |
| 5 | Retain React (React 19 + TypeScript) | **Accepted** | Moves to `react/` (LAI-0201) |
| 6 | ~~Retain Three.js and Phaser engines unchanged~~ | **Superseded by ADR-020** (Accepted) | Three.js is the only gameplay renderer; Phaser is retired after conversion |
| 7 | ~~Separate engine from platform concerns; `game/` extraction deferred~~ | **Superseded by ADR-020** (Accepted) | `game/` is a first-class package; the engine boundary is a requirement, not a deferral |
| 8 | Authoritative rules reimplemented in Python with shared golden vectors; content exported to versioned JSON | **Accepted** (owner, 2026-10-24) | Gate G4 resolved: Python is authoritative, no Node rules service; Django becomes the content authority with versioned JSON as the interchange. See "Amendment: sub-decision 8 and gate G4" below |
| 9 | Bedrock called from Django (boto3), replacing Amplify AI Kit routes | Proposed | Personas, limits, validation, fallbacks, audit preserved |
| 10 | EC2 + Docker for development; ECS Fargate as production candidate | Proposed | No Kubernetes, microservices, queues |
| 11 | Django Channels + Redis only if a measured need appears | Proposed | Co-op needs only slot claims and low-rate state |
| 12 | Incremental Amplify retirement, with Cognito detached first | Proposed | Phases 12-13 in the roadmap |

**Repository conventions.** FinWin-style layout (approved): `react/`, `lai/`, `game/`,
`infra/`, `ci/`, `deploy/`, `docs/`, `tasks/`, `tests/`. Directories are created only when a
task needs a file in them.

**Preserved by the migration.** Existing gameplay, educational rules, progression, and assets.
Existing content definitions stay where they are until migration into Django models is
separately authorized and verified.

**Authoritative hierarchy.** Island (themed world), then Adventure (playable experience), then
Quests, Challenges, Objectives, Rewards. New islands and adventures are data or configuration,
not new AWS infrastructure.

**Open gates (not accepted by this approval).**

| Gate | Unresolved item | Blocks |
|---|---|---|
| G1 | Does a production Amplify app with real family data exist, and in which account and region? (assessment Q1, Q2) | Phase 10 deploys, Phase 11 data migration, Phase 12 cutover |
| G2 | Cognito ownership and detach plan (LAI-0401 recorded in ADR-024; LAI-0405 remains) | LAI-0402 onward for production, LAI-1302 |
| G3 | Android direction (assessment Q3) | API shape decisions that serve Android |
| G4 | ~~Rules in Python with golden vectors versus a Node rules service (assessment Q4, sub-decision 8)~~ **Resolved 2026-10-24: Python, with golden vectors** (see the amendment below) | Nothing; formerly LAI-0302 and Phase 6 |
| G5 | Whether data loss on pre-pilot sandbox data is acceptable (assessment Q5) | Phase 11 scope |
| G6 | Security gates: tenant isolation harness passing, deny-by-default authorization reproduced in Django | Any Django endpoint serving child data |
| G7 | Every AWS-touching task (Phase 10 onward) | Explicit per-task approval, as marked APPROVAL |
| G9 | `ParentConsent` privacy design (LAI-0308). Consent is a legal and privacy matter, not a player-profile attribute; it must be designed and approved before the migrated platform handles live children's data (owner, 2026-10-17) | Phase 11 data migration, any production traffic with real family data |
| G8 | Privacy review of server-side logging, including exception messages and tracebacks, which can carry child or family data even though API clients never see them (owner, 2026-10-17). **Application-layer part done in LAI-0208 (ADR-025); the deployed part is open as G10** | Any production deployment |
| G10 | Deployed logging verification: web server and proxy access logs (a default access log records the full URL including the query string), load balancer and CDN logs, CloudWatch retention and access, the PostgreSQL server log (can record statements and the values in error DETAIL lines), any future monitoring vendor, and container stdout capture. Child ids appear in URL paths, so infrastructure logs are not free of identifiers by default (LAI-0210) | Any production deployment |

**Amendment: sub-decision 8 and gate G4 (project owner, 2026-10-24).** Accepted.

- *Rules.* Django/Python owns server-authoritative gameplay rules: answer validation, step
  transitions, hint levels, progression and mastery counters, reward resolution, quest
  progress, and the director's ranking. No Node rules service. The Three.js client and the
  React app may run the same deterministic logic for presentation, instant feedback, and
  local previews, but nothing they compute awards rewards or advances protected progression
  once the server path for that rule exists (Phase 6). Wherever one rule exists in both
  TypeScript and Python, shared golden vectors (`tests/golden/*.json`, LAI-0303) prove the
  two agree; a divergence fails CI.
- *Content.* Django is the authoritative content source. JSON is the versioned interchange
  contract the frontend and the engine consume, with an explicit schema version
  (`content/schema/content.schema.json`, `schemaVersion`), additive changes within a
  version, and a documented migration for a breaking one. React gains no independently
  editable content source.
- *Transition, so this does not contradict decisions still in force.* Until the Django
  catalog exists and a cutover task makes its admin the editing surface, the TypeScript
  content modules remain the authoring input: `npm run content:export` produces the JSON,
  and LAI-0304's `load_content` loads it. After that cutover the direction reverses
  (Django data is the source, JSON is exported from it). ADR-009 and ADR-013 still hold for
  what a content pack is; only where it lives moves. ADR-031's Amplify catalog overlay is the
  existing React-editable overlay; it gains no new content fields and is superseded when
  LAI-0801/LAI-0802 move catalog editing to Django. ADR-032's spatial manifests stay in
  source until a separate decision covers spatial content (recorded as LAI-0805).
- *Not decided here.* How a breaking schema version is migrated in stored data, and whether
  the client keeps a bundled content copy for offline play, are left to LAI-0304 and
  LAI-0503.

**Alternatives considered.** Stay on Amplify and raise the IAM quota (lowest effort; leaves
the client-authoritative write paths to be fixed with more Lambdas). Amplify Gen 2 with a
single generic content table (fewer roles, loses relational integrity).

**Consequences if accepted.** Python enters the stack; a second implementation of the game
rules must be kept in lockstep by tests; fixed monthly infrastructure cost rises; Android
plans (ADR-010, `docs/android/android.md`) change from "Amplify client libraries" to "REST
API".

**Open questions.** See `docs/DJANGO_MIGRATION_ASSESSMENT.md` section 16.


## ADR-020: Three.js is the exclusive gameplay renderer; Phaser is retired; `game/` is a first-class package

Status: **Accepted** (project owner, 2026-10-17). Independent of ADR-019: it is in effect
whether or not the Django migration is accepted.

Detail: `docs/THREEJS_ENGINE_CONVERSION.md` (inventory, conversion matrix, engine
architecture). Tasks: `docs/DJANGO_MIGRATION_ROADMAP.md` Phases 20 to 23.

**Context.** The repository runs two gameplay renderers: Phaser 4 for eight 2D worlds
(`LocationScene` and eight subclasses) and Three.js for Welcome Harbor, Pirate Builder Bay, a
sandbox, and Storykeeper Castle region data. ADR-008 already named Three.js the
next-generation renderer but left Phaser live and as the Sprouts fallback. The Phase 0
assessment then recommended preserving both and deferring `game/`. Maintaining two engines
duplicates interaction, input, and accessibility work and blocks one reusable adventure
platform.

**Decision.**

1. Every playable island and adventure runs on one Three.js engine. No other gameplay
   renderer is supported in the final architecture.
2. Phaser and all 2D gameplay rendering are retired after each world's replacement passes
   parity tests and visual validation, and the Sprouts gate. Existing 2D gameplay rules,
   educational objectives, progression, rewards, and content are reused; the renderer is
   replaced, not the game.
3. Scope of "gameplay": playable environments only. React menus, HUD overlays, dashboards,
   the card-based hub, the Canvas 2D companion portrait, and admin pages stay conventional
   2D UI.
4. The engine is extracted to a top-level `game/` package (reverses the Phase 0 deferral). It
   imports nothing from React, Django clients, Amplify, or AWS SDKs. React consumes it through
   a defined interface and receives typed, semantic-ID events from it.
5. Islands and adventures are data (`WorldDefinition` plus catalog content). A new one needs no
   new renderer, route, or AWS infrastructure.
6. The engine continues to follow ADR-007 and ADR-008's layering: it never validates answers,
   awards progress, decides mastery, or calls AI.
7. Sprouts get a guided Three.js camera and control profile (conditionally approved by the
   owner); the ADR-008 playtest requirement stands. Until the Sprouts usability and gameplay
   parity gates pass, the card hub and the existing Phaser view remain Sprouts' primary route
   and block LAI-2304. Control profiles are configurations of one engine, never separate
   renderers: Sprouts (ages 3 to 4) tap-to-move with assisted camera, large targets, minimal
   reading; younger elementary simplified third-person or first-person; older children more
   conventional third-person or first-person movement and camera control.
8. Effective immediately: **no new Phaser features.** Bug fixes to existing Phaser worlds are
   allowed until they are deleted.

**Deferred.** Shared 3D multiplayer presence (owner: defer). Co-op today is shared adventure
state; shared presence conflicts with CLAUDE.md section 12 unless separately approved.

**Provisional performance targets (owner, 2026-10-17).** Desktop or laptop 60 FPS with
keyboard and mouse; modern tablet 30+ FPS with touch; modern smartphone 30+ FPS with touch.
These are planning targets, not measured figures and not release requirements until
representative devices, test scenes, and a measurement method are established (LAI-2002,
LAI-2105, LAI-2302).

**Castle Writing Room versus SC-9: decided.** Consolidated; see
`docs/THREEJS_ENGINE_CONVERSION.md` section 6.

**Alternatives considered.** Keep both engines (Phase 0 recommendation; rejected by the
owner). Render 2D worlds as textures inside Three.js (rejected: not genuine 3D play).
Convert everything in one step (rejected: each world must stay playable until verified).

**Consequences.** Large art and engineering effort for five worlds with no 3D counterpart;
Sprouts accessibility becomes a Three.js problem; `phaser` leaves `package.json`; ADR-008's
Phaser fallback clause and `docs/ROADMAP.md` Phase 33 wording (Phaser retired after the Bay
slice only) are widened; CLAUDE.md gains section 19.

## ADR-021: Django 6.1, DRF 3.18, and psycopg 3 for the backend skeleton

Status: **Accepted** (project owner, 2026-10-17). Implements sub-decisions 1 and 2 of ADR-019
(Accepted in part); it does not settle any ADR-019 open gate.

**Decision.** Exact pins, installed with `pip` into a venv (no other package manager):

| Package | Version | Why |
|---|---|---|
| Django | 6.1.2 | Latest stable release per djangoproject.com/download on 2026-10-17. Requires Python 3.12 or newer (classifiers 3.12 to 3.14), matching `.python-version` |
| djangorestframework | 3.18.3 | Latest; its metadata lists Django 5.2, 6.0, and 6.1 |
| psycopg[binary] | 3.3.6 | PostgreSQL driver (psycopg 3). Used by Django's `postgresql` backend |
| asgiref, sqlparse, psycopg-binary, typing_extensions | 3.12.1, 0.6.0, 3.3.6, 4.16.0 | Transitive pins for reproducible installs |

pytest-django 4.14.0 was added as a dev dependency. Ruff 0.17.0 and pytest 9.1.1 are unchanged.
Settings use the standard library only (no django-environ). No CORS, gunicorn, or JWT library
is added yet.

**Why 6.1 and not the 5.2 LTS.** The owner chose the latest stable release for a new
application. The ecosystem fits: DRF and psycopg already support it, so there was no
incompatibility to report. **Trade-off accepted knowingly:** per the Django download page,
5.2 LTS has extended support until April 2028, while 6.1 has mainstream support until April
2027 and extended support until December 2027. The project therefore commits to moving to a
newer supported Django release before December 2027, and to reading each release's notes
rather than skipping versions. This is an upgrade obligation, tracked as a risk, not a
blocker.

**Verified.** `pip check` clean; a fresh venv from `requirements-dev.txt` reproduces the same
`pip freeze`; `manage.py check`, `makemigrations --check`, and `migrate` run; 29 pytest tests
pass including a PostgreSQL 16 test.

**Deferred on purpose.** `django.contrib.auth`, contenttypes, sessions, and admin are not
installed, so no default user table exists before the users task (LAI-0301) chooses the user
model. `check --deploy` reports W003 (no CSRF middleware; the API is stateless and will use
bearer tokens, revisit in LAI-0402, see below) and W021 (HSTS preload not enabled; it commits a domain
permanently, decide when a domain exists).

**CSRF and W003, stated precisely (not resolved).** Stateless does not by itself mean CSRF-safe.
CSRF works because browsers attach cookies automatically to cross-site requests. A bearer token
that JavaScript reads from memory and sends in an `Authorization` header is not attached
automatically, so classic CSRF does not apply to it. The same API becomes CSRF-exposed if the
credential travels in a cookie (a session cookie, or a JWT stored in a cookie), because the
browser then sends it without the page's consent. W003 is therefore **acknowledged, not
resolved**. The condition under which omitting `CsrfViewMiddleware` is acceptable is: no
authentication credential is ever carried in a cookie. LAI-0402 (Cognito JWT authentication) must
state how the token is stored and sent, and if any cookie is used, enable CSRF protection
before merging. Until LAI-0402, no endpoint accepts a credential, so nothing is exposed. A
separate concern, token storage in the browser (XSS exposure), is also LAI-0402's to decide.

## ADR-022: `ParentAccount` is the Django user model; `ChildProfile` is a managed profile, not a login

Status: **Accepted** (project owner, 2026-10-17; implemented in LAI-0301). Implements ADR-019
sub-decisions 1 to 3 for identity. Settled before any migration was applied, because swapping
`AUTH_USER_MODEL` afterwards is hard.

**Three identities, kept apart.**
1. *Cognito identity*: proves who is signed in. Only the immutable `sub` claim is stored.
2. *Parent application identity*: `users.ParentAccount`, keyed by a UUID, with `cognito_sub`
   unique, non-blank, and immutable (enforced in `save()` and by a check constraint).
3. *Child player identity*: `users.ChildProfile`, owned by exactly one parent. A child has no
   email, password, Cognito identity, or Django login. Children never authenticate.

**Option chosen: A, one model.** `ParentAccount` (an `AbstractBaseUser`) is the user model. Option B
(a user model plus a separate `ParentAccount` one-to-one) was rejected: it adds a table and a join
for no current benefit, and the Amplify side is also a single `ParentProfile`. Trade-off: an
administrator who is not a parent is still a `ParentAccount` row (with `is_staff`), so the name
reflects the main role. If administrators later need a separate model, that is a data migration,
not a user-model swap.

**What the model deliberately omits.** No email (mutable, personal, never an identity key); no
`PermissionsMixin`, so no `is_superuser` flag and no Django Group/Permission tables; no usable
password (the inherited column holds an unusable value; `create_user` and `create_superuser` raise).
`django.contrib.auth`, contenttypes, sessions and admin are not installed; there is no Django
`createsuperuser` path around Cognito. Administrative access will be mapped from the Cognito
`Admins` group in LAI-0404, which will install what it needs.

**Django admin: not enabled.** Enabling it now would give staff an unscoped view of child records.
*Amended 2026-10-25 (ADR-034):* Django Admin is enabled for staff with local passwords;
`ParentAccount` gains `is_superuser` and `admin_username`, and child records stay unregistered.
The React admin remains the customer-facing admin surface.

**Households: not introduced.** One parent account owns its children. A multi-adult household
(as in FinWin) is a different concept and is not required by the current schema or roadmap.

**Ownership model.** Every read of child data goes through a parent: `ChildProfile.objects.owned_by`
and `apps/users/services.py`. A missing id and another parent's id raise the same error
(`ChildProfileNotFound`), so ids cannot be probed. Model `__str__`/`__repr__` use ids only so logs
and exception messages built from a model carry no nickname. These guarantees are model and
service level; authenticated API authorization tests are recorded for LAI-0402 and the endpoint
tasks (LAI-0502 onward) and must be written there.

**Deletion.** Current behaviour (read from `react/src/features/child-profile/deletion.ts`) is a hard
delete, orchestrated by the client: every child-scoped row, the profile photo in S3, the child, then
for account deletion the parent row and the Cognito user. There is no soft delete, retention window,
or async deletion. Django mirrors this with `ChildProfile.parent` as `PROTECT`: a parent cannot be
deleted while children exist, so a photo in S3 or child data can never be orphaned by an accidental
cascade. The deletion service (LAI-0602) deletes children explicitly; rows that belong to a child
will `CASCADE` from the child. The `active` flag is a deactivation, not deletion.

**Three-profile cap.** Enforced in `create_child_profile` under a row lock on the parent, counting
every profile, active or not, as the current app does. The roadmap text said "active"; the code
counts all, and the code was preserved. No database constraint can express the cap.

**Not in this task (deviation from the roadmap text).** `CompanionProfile` (exists in Amplify) and
`ParentConsent` (documented in `docs/DATA_MODEL.md` but never implemented in Amplify) were left out:
neither is identity, and consent needs a privacy design rather than a copy. Tracked as LAI-0307
and LAI-0308.

**Known risks.** Existing Amplify rows may violate constraints that the new database enforces
(session minutes outside the band's range, nicknames over 30 characters, a `displayName` over 80
characters, which is often the parent's email, i.e. personal data). The import (LAI-1102) must
report and resolve these, not silently truncate. The assumption that Amplify ids are UUID strings
is unverified until LAI-1101.

## ADR-024: Cognito remains the authentication authority; Django validates bearer access tokens

Status: **Accepted in part** (project owner, 2026-10-17; gates A2 to A5 decided 2026-10-18).
Gates A1 and A6 remain open and must not be treated as approved. Accepted items 1 and 2 are amended
by ADR-038 for local development only: with `AUTH_PROVIDER=django` the API accepts a Django session.
Every AWS environment still runs exactly this decision. Section "Owner decisions of
2026-10-18" below supersedes the matching *Recommended* text and the A2 to A5 rows.

### Evidence: how authentication works today

| Question | Finding | Source |
|---|---|---|
| Provider and sign-in | Cognito user pool, email as username, SRP password flow, public SPA app client (no client secret), OAuth code flow enabled | `amplify/auth/resource.ts`; synthesized template (a local sandbox, not a deployed pool) |
| Where tokens live | `localStorage` (access, ID, and refresh tokens plus clock drift), with an in-memory fallback if storage is unavailable. The app never calls `setKeyValueStorage`, so the library default applies. No cookies, no `sessionStorage` | `@aws-amplify/core` `DefaultStorage`, `@aws-amplify/auth` token provider, v6.20.0; no override in `react/src` |
| JavaScript-readable | Yes, all three tokens, persistently | same |
| Reload / browser restart | Session survives both. Tokens are refreshed by the SDK automatically | library behaviour |
| Refresh token lifetime | Not set in repo configuration, so the Cognito default applies (30 days). Access and ID tokens default to 60 minutes. **Deployed values unverified** (gate G1) | synthesized template has no validity settings |
| Sign-out | `signOut()` without `global`: revokes this device's refresh token at Cognito when revocable, then clears local tokens. Other devices keep working. No global sign-out is used | `signOut.ts` in the SDK; `AuthContext.tsx` |
| Which token reaches AppSync | The **access token** (not the ID token) | `@aws-amplify/api-graphql` `graphqlAuth.ts` |
| Admin check | Server side: AppSync `allow.group('Admins')` on read-only rules. Client side: `AuthContext` reads `cognito:groups` from the **ID token** and `RequireAdmin` hides routes. That client check is a UI convenience only | `amplify/data/resource.ts`, `AuthContext.tsx`, `RequireAdmin.tsx` |
| Who can sign up | Open email sign-up (there is a sign-up form) | `SignUpForm.tsx` |

Compatibility: Django can use exactly what Amplify already sends. `fetchAuthSession()` returns the
access token; React attaches it as `Authorization: Bearer`. Nothing in the current login or refresh
flow has to change for the header transport.

### Accepted

1. Cognito stays the authentication authority; no second password system, no Django sessions, no
   Django password authentication.
2. API credential: the Cognito **access token** in `Authorization: Bearer <token>`. Never from a
   query string. Never an ID token. No cookie-based API credential. Any proposal to use cookies
   needs a new security decision covering CSRF, cookie scope, SameSite, HttpOnly, Secure, session
   lifecycle, and deployment topology.
3. Verification of every token (LAI-0402): signature against the pool's JWKS using only the
   expected algorithm (RS256; never `none` or an HMAC algorithm); `iss` equals the configured
   pool; `exp` and, when present, `nbf`; `token_use == "access"`; `client_id` in the configured
   allow-list (access tokens carry `client_id`, not `aud`; ID tokens carry `aud`); a known `kid`.
   A token from another pool or app client, or malformed, expired, wrongly signed, or unsigned,
   is rejected. JWKS caching is bounded, supports key rotation, and never trusts an unknown key.
   No network call to AWS in unit tests (locally generated RSA keys).
4. Identity: the immutable Cognito `sub` maps to `ParentAccount.cognito_sub`. Never email or
   display name.
5. Child access: always through the authenticated parent (ADR-022). A client-supplied child UUID
   is never sufficient. Another parent's id is indistinguishable from a missing one.
6. Administrative authority is decided on the server from verified claims, never from frontend
   route visibility. A `ParentAccount` is not an administrator by default.
7. Error semantics, inside the LAI-0205 envelope: missing, invalid, or expired credentials are 401
   with `WWW-Authenticate: Bearer`; valid credentials without permission are 403. No token,
   claim, or account detail in a response or a log.
8. `localStorage`/`sessionStorage` token exposure is a known XSS risk (OWASP); see gate A1.
   Existing login and refresh behaviour must not be broken without an approved migration plan.
9. Cognito resources (pool, app client, groups, users) must survive the migration (gate G2).

### Recommended (superseded by the 2026-10-18 decisions below where they overlap)

- **JWT library:** PyJWT with the `crypto` extra (`PyJWT[crypto]`, latest 2.15.1 on 2026-10-17),
  the same library FinWin uses. Exact pins for it and `cryptography` would be added in LAI-0402
  with a note here. **A dependency approval is required** (LAI-0401's roadmap criterion).
- **Parameters:** clock-skew leeway 30 s; JWKS cached for 3,600 s; on an unknown `kid` refetch at
  most once per 60 s, and otherwise reject (so a forged `kid` cannot trigger a fetch per request);
  allow-list of client ids in a setting (initially the existing web client). **No new
  "Django-facing" app client**: the browser client already issues the tokens, and creating a client
  changes the Amplify-managed pool (needs approval and belongs to a deployment task).
- **Scopes:** tokens from SRP sign-in carry only `aws.cognito.signin.user.admin`; no custom
  resource server or scopes exist. Do not require OAuth scopes until a resource server is
  designed.

### Open gates (decisions the evidence does not settle)

| Gate | Question | Recommendation | Blocks |
|---|---|---|---|
| A1 | **Browser token persistence.** The current store is persistent and JS-readable, including a 30-day refresh token. Options: (a) keep as is; (b) keep, plus strict CSP, no inline script, dependency review, and a shorter refresh-token lifetime (an Amplify-managed pool change); (c) memory-only tokens (loses the session on every reload, which breaks tablet use); (d) backend-for-frontend with the refresh token in an HttpOnly cookie held by Django (needs the cookie decision in item 2) | (a) until cutover so nothing breaks, with (b) as the minimum hardening before real family data reaches Django, and (d) evaluated against the children's-data risk before LAI-1203. Do not copy tokens into app state or any other storage of our own | Production cutover (LAI-1203), not LAI-0402 |
| A2 | **Onboarding.** A valid Cognito user with no `ParentAccount`: auto-provision, or require explicit onboarding? | Explicit but cheap: reads never write. An idempotent `POST /api/v1/me/` provisions (the unique `cognito_sub` plus `get_or_create` handle retries and races); until then protected endpoints return 403 `account_not_provisioned`. Display name is not in the access token, so it starts blank | LAI-0402 |
| A3 | **Revocation latency.** A verified JWT stays valid until `exp` even after sign-out or refresh-token revocation, because local verification cannot see revocation | Accept up to the access-token lifetime (default 60 min, unverified) for ordinary reads. For high-risk actions (child or account deletion, consent changes, any admin action) re-check with Cognito `GetUser` on the presented token and require recent `auth_time`. Consider a shorter access-token lifetime (pool change, needs approval) | LAI-0402 design, LAI-0602 |
| A4 | **Admin design** | Admin is derived per request from the `cognito:groups` claim of the verified access token (contains `Admins`); no stored flag, so removing the group takes effect at the next token (at most the token lifetime). Read-only first. A separate admin code path (not the parent-scoped one) with an audit record for every access to a child's data: admin sub, action, target id, request id, never child content. `ParentAccount.is_staff` stays unused; Django admin stays off until LAI-0404 | LAI-0404 |
| A5 | **Dependency and parameter approval** for the Recommended list above | Approve or amend | LAI-0402 |
| A6 | **Cognito ownership and deployed settings** (existing gate G1/G2): token validities, `EnableTokenRevocation`, deletion protection, whether a production pool with real users exists | Read-only evidence (LAI-0103), then the runbook (LAI-0405) | Any production use |

Consequence of the user model (ADR-022): there is no Django superuser or permission table, so
Django's built-in permission checks and admin cannot be used as they are. Authorization is
application-level: ownership scoping for parents, claim-based checks for administrators.

### Privacy and logging requirements (feed LAI-0208, gate G8)

Never log an access, ID, or refresh token, or a full or partial JWT. Never log arbitrary claims
(`sub` only when an audit need is documented; otherwise the local UUID). Authentication failures
return the same 401 body for every cause (malformed, expired, wrong pool, wrong client, bad
signature), with a coarse internal reason code in logs, so a caller cannot probe which part failed
or whether an account exists. Child personal data must not appear in exception messages or
tracebacks. JWKS fetch failures fail closed (reject the token, 401 or 503 per policy), log without
the token, and never fall back to unverified decoding. Administrative actions need an audit log
(A4). The LAI-0205 request-id and access-log policy already excludes headers, so `Authorization`
is not logged today.

### Cognito resource ownership

The pool belongs to the Amplify-managed stack. Before any Amplify stack is deleted, the pool, its
app client, the `Admins` group, and all users must be detached or retained so that user ids (`sub`
values, which are what `ParentAccount` is keyed on), the pool id, and client ids stay unchanged;
otherwise every parent mapping breaks. No stack deletion is authorized by this ADR. The procedure
is LAI-0405 (human-reviewed) and the detach in LAI-1302; production existence is gate G1.

### Owner decisions of 2026-10-18 (gates A2 to A5)

**A2, onboarding: approved.** `POST /api/v1/me/` provisions a `ParentAccount` explicitly, using only
the verified Cognito `sub`. It is idempotent (an existing account is returned, never changed),
safe under concurrent requests (the unique `cognito_sub`), and the only place an account is created.
GET requests never create accounts. Until provisioned, account-dependent endpoints return
`403 account_not_provisioned`. Provisioning creates no child profiles and grants no privileges.

**A3, revocation: conditionally approved.** For ordinary operations a locally verified access token
is valid until it expires. Local verification (signature, `exp`, `auth_time`) does **not** show that
a session or token has not been revoked, and `auth_time` alone is never treated as proof of
non-revocation. Account deletion, consent changes, and privileged administrative mutations require
recent authentication plus a revocation-aware check, must fail closed if that check cannot run,
and **must not be exposed** until that mechanism is separately specified, implemented, and tested
(tracked as LAI-0209). LAI-0402 therefore ships a permission class, `SensitiveActionBlocked`, that
denies every request; any such endpoint must declare it until LAI-0209 replaces it.

**A4, administration: approved.** Administrative authority is derived on every relevant request
from the `cognito:groups` claim of a cryptographically verified access token. No Django superuser
or unrestricted permission is granted. Implementation is LAI-0404; LAI-0402 only carries the
verified groups on the request.
*Amended 2026-10-25 (ADR-034), for Django Admin only:* Django Admin uses local staff and superuser
accounts signed in with a Django password, not the `Admins` claim. API authorization is unchanged.

**A5, JWT verification: approved.** PyJWT 2.15.1 with the `crypto` extra; RS256 only; 30 s leeway;
JWKS cached for 3,600 s; at most one refresh attempt per 60 s **including after failures**; 5 s
network timeout; explicit issuer and client-id allow-list; `token_use == "access"`, `sub`, `exp`,
and `nbf` (when present) validated; ID tokens rejected; unverified claims never trusted; no new
Cognito app client. PyJWT's `PyJWKClient` refetches the key set on every unknown `kid` with no
cooldown, so it does not meet the refresh policy; LAI-0402 uses a small bounded wrapper
(`apps/users/jwks.py`) with tests. Choices made by LAI-0402 inside this approval: a JWKS outage
returns `503` `authentication_unavailable` (not 401, so clients do not sign users out during an
outage); an expired cache that cannot be refreshed fails closed; responses larger than 64 KiB or
key sets over 20 keys are rejected.

**Still open.** A1 (browser session persistence): `localStorage` behaviour stays during development,
LAI-0402 does not touch token storage, and production cutover is blocked until a browser-session
security decision is made. A6 (deployed Cognito settings) requires read-only AWS inspection; no
Cognito resource may be deleted, replaced, or reconfigured.

## ADR-025: Exceptions are logged as type and location, never as message

Status: **Accepted** (implemented in LAI-0208; the owner required a privacy review of server-side logging
before more APIs handle children's data).

**Finding.** The API already returned fixed error messages, but the server wrote the opposite: an
unexpected exception was logged by Django with a full traceback, including the exception message, and
with the raw request path. Reproduced before the fix: a synthetic nickname, parent email, and interest
interpolated into an exception message all appeared in the log. Database errors are worse, because
PostgreSQL quotes the offending values (`Key (cognito_sub)=(...) already exists`). Django's default
`django` logger also carries a handler that emails full request reports to `ADMINS`.

**Decision.**
1. Exceptions are rendered as the exception type and `file:line in function` for the whole cause and
   context chain. No message, no source line, no local variables (`apps/core/privacy.py`). This applies to
   every logger, including application code calling `logger.exception()`.
2. Django's request-failure line uses the matched route pattern, never the raw path; the request object is
   removed from every record; `django.security.*` details are withheld (they echo header values).
3. The `django` logger has no handlers of its own, `ADMINS` and `MANAGERS` are empty, the SQL logger cannot
   run at DEBUG, `django.server` is discarded, and the root level cannot be set below INFO.
4. Django debug pages and error reports hide all local variables and all cookie values; the token
   verification functions are also marked `@sensitive_variables`.
5. Raw tracebacks are possible only with `LAI_LOG_RAW_EXCEPTIONS=1` under **local** settings. Production and
   test settings force it off regardless of the environment.
6. Logged HTTP methods outside the standard set appear as `OTHER`.

**Trade-off.** Diagnosis is harder: a developer sees where and what kind, not why. That is deliberate. When a
message is needed, reproduce locally with synthetic data and the raw opt-in.

**What this does not cover** is listed under "Logging and privacy" in `docs/ARCHITECTURE.md` and in gate G10.


## Renumbering map (post-merge reconciliation, 2026-10-24)

Two lines of work both used ADR-019 to ADR-022. The Django migration decisions keep their numbers. The Storykeeper Castle, Wonderwild and Clockwork decisions were renumbered. They are different decisions, so none was consolidated.

**Integration of `origin/main` (done locally, merge of `eab0817`).** `origin/main` already contained the Storykeeper Castle line under its original ADR-019 to ADR-022 with identical text and added ADR-023 to ADR-026. It had none of the Django ADRs. The table below is the mapping applied when it was merged. References that arrived from main's side were remapped line by line (a line counted as main's only if it is absent from the Django branch and present on main), never by global replacement. Main's ADR-019 to ADR-022 blocks were already present here as ADR-027 to ADR-030, so they were not added twice.

| `origin/main` id | Meaning | Integrated id |
|---|---|---|
| ADR-019 | Story chapter in a 3D region | ADR-027 |
| ADR-020 | Where the castle's art comes from | ADR-028 |
| ADR-021 | Phaser 2D views phased out | ADR-029 |
| ADR-022 | Uploaded models in S3 | ADR-030 |
| ADR-023 | Admin section Tailwind and shadcn/ui | ADR-023 (unchanged) |
| ADR-024 | Islands and Adventures admin catalog | ADR-031 |
| ADR-025 | Serializable location manifest | ADR-032 |
| ADR-026 | Multiplayer room server | ADR-026 (unchanged) |

Any later merge from a branch that still uses the old main numbers needs the same remap. `npm run adr:check` cannot detect a number that resolves to the wrong decision.

| Old (incoming line) | New | Title |
|---|---|---|
| ADR-019 | ADR-027 | A story chapter may be played inside a 3D region |
| ADR-020 | ADR-028 | Where the castle's art comes from |
| ADR-021 | ADR-029 | Phaser 2D views are phased out; new regions are authored in Three.js only |
| ADR-022 | ADR-030 | Uploaded models live in S3 behind Admins-only Asset records |

## ADR-027: A story chapter may be played inside a 3D region; the Story Engine keeps sole ownership of progress

> Renumbered in the post-merge reconciliation (was ADR-019 on the Storykeeper Castle line; the incoming Storykeeper Castle / Wonderwild / Clockwork line collided with the Django migration ADR-019 to ADR-022). Text and status are unchanged.

Status: Accepted

`docs/STORYKEEPER_CASTLE_3D_STORYBOARD.md`'s age-band table gives Explorers
"beats 1 to 13" in the first-person castle. Beats 9 to 11 are
`THE_CASTLES_SECRET_DOOR`, an Explorer-only `StoryDefinition`. So the
storyboard assumes an arc currently played from `StoryPage` can also be
played from inside a world view - and nothing in this log has ever said so.
SC-8 built beat 9's evidence (the door, the nine carved stars, the three
clues) and stopped at that assumption; SC-9 cannot stop there, because its
beat *is* the interaction rather than a number typed on a card.

**The decision has three parts, and only the first is a product call.**

### Part A - an arc may have a second place it is played, and only one place it is recorded

A story chapter may be played from a 3D region as well as from `StoryPage`.
This is a second *entry point*, not a second copy: the child is playing the
same `ChildStoryProgress` row either way, and may leave the castle
mid-chapter and finish it from the Adventure Library, or the reverse.

Rejected alternative: running `secret-door-chapter-1-three-clues` in the
castle as a standalone adventure, the way `the-storykeepers-tale` runs
there. It is the cheap option and it is wrong - that adventure is an
`ADVENTURE` scene inside a story, so a standalone session would advance no
chapter, fire no `completionWorldChange`, and leave the child to play the
same chapter again in the library afterwards. An arc with two entry points
is a product decision; an arc with two *records* is a bug.

### Part B - the Story Engine keeps ownership; the region borrows a renderer

`useStoryProgress` continues to be the only thing that starts, advances, or
completes a `ChildStoryProgress`. A world view that hosts a chapter calls it
exactly as `StoryPage` does, and gains no new authority over story state.

This preserves the layering `docs/ARCHITECTURE.md` sets out and ADR-008
restates: World Engine code renders, World/Story State decides. A region
that could advance a chapter on its own would be the same category of
mistake as a region that wrote `ChildWorldState` directly.

### Part C - `StoryChapterRunner` gains a seam for rendering an ADVENTURE scene

`StoryChapterRunner` renders `ADVENTURE` scenes by embedding
`AdventureRunner`, which owns its `useAdventureSession` internally. That is
the whole obstacle: SC-4's method for making the castle drive a learning
step is that **the view holds the session**, so both the room and the card
submit through one `submitAnswer` and cannot drift. A component that owns
its own session privately cannot be driven by a room.

So `StoryChapterRunner` takes an optional renderer for its `ADVENTURE`
scenes, defaulting to today's `AdventureRunner`. A region supplies one that
holds the session itself and renders `AdventureStepCard` - the component
SC-4 already extracted from `AdventureRunner` for exactly this purpose. No
existing caller changes, `AdventureRunner` is untouched, and the castle gets
the same "one session, two ways in" shape it already has for the tale.

One attempt is still one `AdventureSession`: the seam changes who renders
the scene, never how many sessions exist for it.

**What this explicitly does not license.** The seam is for *rendering*. It
carries no ability to advance a chapter, skip a scene, complete a scene or
chapter, grade an answer, or create or duplicate story progress; every one
of those stays with the Story and Adventure Engines. Nor does it license a
region-specific replacement for the Story Engine - there is no
`CastleStoryRunner`, `ForestStoryRunner` or `ThreeJsStoryRunner`.
`StoryChapterRunner` remains canonical. A region that wanted any of this
would need its own ADR.

### Canonical progress identity

The rule the three parts above are all instances of:

> **Entry point is presentation metadata, never progression identity.**
> `ChildStoryProgress`, chapter state, adventure sessions, completion state
> and the resulting world changes are keyed to the underlying
> story/chapter/adventure identity, and are never duplicated or namespaced
> by the route the child entered from - `StoryPage`, a castle, an NPC, a
> quest, a discovery, or any other world interaction.

So there is never a `castle-secret-door-progress` beside a
`library-secret-door-progress`. There is progress for
`THE_CASTLES_SECRET_DOOR`, and that is all there is. A child may start in
the castle, walk out mid-chapter, open the Adventure Library and carry on
from the same row - and the reverse.

The Adventure Library is the persistent, location-independent way to find
and resume a story. The 3D world offers contextual ways to discover and play
the same one. **Stories belong to the Story Engine, not to their entry
point.**

### Age-band eligibility is the Story Engine's, not the region's

A 3D region enforces the same story eligibility `StoryPage` does, by reusing
that logic rather than restating it. Reaching a Three.js object must never
be a way around a band gate: `THE_CASTLES_SECRET_DOOR` is Explorer-only from
the Adventure Library, so it is Explorer-only from the castle.

### A 3D entry point is authored, never automatic

Accepting this does not put every story into the 3D world. An entry point
stays an authored `WorldInteraction`, and content decides where a story can
be found - `THE_CASTLES_SECRET_DOOR` in the Adventure Library and Storykeeper
Castle, plausibly from a relevant NPC, and nowhere else unless someone
authors it there.

### Consequences

- SC-9 becomes buildable, and so does SC-8's unbuilt half.
- **Cross-entry resume tests are required before SC-9 is complete.** Both
  directions - start in the library and resume in the castle, start in the
  castle and resume in the library - asserting that switching entry points
  produces no duplicate `ChildStoryProgress`, no duplicate `AdventureSession`
  for one attempt, no duplicate completion or `completionWorldChange`, no
  lost progress, and no replay of a finished scene.
- Two entry points to one arc need a resume story that holds up in both
  directions. `useStoryChapterRunner` already skips an `ADVENTURE` scene
  whose session is finished, which is the hard half; what is untested is a
  child crossing between routes mid-chapter, and that is worth a test before
  SC-9 rather than after.
- `StoryPage` and the castle will both be able to start the arc, so the
  castle needs the same Explorer-band gate `StoryPage` applies, or a
  Pathfinder walks into a chapter authored for a band above them.
- Nothing here says the castle *should* offer the arc, only that it may. The
  entry point is still an authored `WorldInteraction` and can be added or
  withheld per region.


## ADR-028: Where the castle's art comes from

> Renumbered in the post-merge reconciliation (was ADR-020; the incoming Storykeeper Castle / Wonderwild / Clockwork line collided with the Django migration ADR-019 to ADR-022). Text and status are unchanged.

Status: Proposed

`docs/regions/storykeeper_castle.md` asks for "stylized fantasy, low-poly to
moderate-poly, warm and colorful, exaggerated silhouettes, slightly magical,
Roblox / Prodigy / animated-adventure feeling." Every asset this project has
is generated from primitives by `scripts/generate-world-assets.ts`, and
**none of the 108 has a texture, a UV accessor, or an image reference**. The
pack averages 2.6 meshes per asset; Keeper Quill is five untextured boxes.
That is a legible grey-box, which is what the generator's own header says it
is, and it does not meet that art direction at any level of polish.

ADR-nothing covers this today. The nearest thing is a decision recorded in
prose in `docs/STORYKEEPER_CASTLE_3D_ROADMAP.md` on 2026-08-28
("Third-party asset kits - not yet"), which deferred the question and set
its own revisit trigger: "when to revisit: after SC-6, and for scenery
only." SC-6 through SC-10 have shipped, so the trigger has fired. This ADR
exists to settle the question that deferral left open, because it blocks
every other phase of the upgrade roadmap - a Castle Director, ambient
events and a Trophy Room rendered in untextured boxes produce a more
sophisticated grey-box.

### Three measurements that reframe the question

**1. Scenery-only import addresses about a quarter of the castle.** Of the
60 castle assets in `assets/manifest.ts`, roughly **44 are gameplay-bearing
and 16 are scenery**. Gameplay-bearing means the geometry *is* the rule: 22
assets are state-variant pairs that must share exact vertices (`hearth` /
`hearth-lit`, `carving-worn` / `carving-worn-revealed`, `secret-door` /
`secret-door-ajar`, three portraits and three window views with their lit
twins); the three rods are graded by *length*; the nine stars are counted;
six clue and story-plate assets are named directly in
`castleChoiceBindings.ts`; the six easel canvases are the cross-product of
the child's two choices.

The importable 16 are `archway`, `binding-table`, `carpet`, `ceiling-tile`,
`costume-rack`, `cushion`, `ground-tile-stone`, `lectern`, `portrait-frame`,
`reading-table`, `rod-rack`, `round-window`, `tapestry`, `wall-stone`,
`window-frame`, `writing-desk`.

So the 2026-08-28 deferral's own proposed remedy - import scenery, keep
gameplay geometry generated - **cannot solve the problem the upgrade
roadmap poses.** Swap all 16 and roughly three quarters of what a child
looks at is still untextured primitives, including every object they are
asked to interact with. This is the finding that makes the old framing
insufficient rather than merely dated.

**2. Visual swaps are already safe, by an existing decision.** Collision is
deliberately decoupled from the visual mesh: authored `RectZone` data
becomes a `Box3` collider via `sceneKit.ts`'s `toBox3`, and a kit piece's
bounding box is never read to derive collision
(`docs/THREE_WORLD_ASSET_CONVENTIONS.md`, "Collider proxy" - "a swapped-in
prettier wall mesh later does not silently change where the child can
walk"). Interaction targets resolve through the loaded scene root or a named
part, with a documented `InteractionAnchor` escape hatch for awkward
silhouettes. `manifest.ts` resolves every asset by id, so no component holds
a URL.

This is the good news, and it was earned: **the pipeline was built so the
art can be replaced without touching game logic.** Whatever this ADR
decides, it is a change to asset production, not to the engine.

**3. The texture test path is the shared prerequisite, not an
implementation detail.** `assetLoader.test.ts` runs real
`GLTFLoader.load()` calls inside jsdom against real checked-in files, via a
narrow `/models/*.gltf` fetch polyfill in `src/test/setup.ts`. That works
**only** because no asset has an image: there is no `HTMLImageElement` and
no `ImageBitmap` in that environment. The first textured file to land
silently removes the pack's only integration-level proof that its output is
loadable, and nothing replaces it.

Every option below except A needs that path built first.

### The options

**A. Change nothing.** Keep generating untextured primitives. Costs
nothing, keeps every current property, and fails the upgrade roadmap's
section 4 outright. Recorded only to be rejected: it is the status quo, and
the status quo is why the castle cannot be shown to a child.

**B. Import third-party CC0 scenery.** Kenney, Quaternius, the CC0 half of
Poly Pizza. Needs scale normalisation to 1 unit = 1 metre, re-pivoting to
ground-pivot (most packs are centre-pivoted), a licence ledger surfaced
where a parent can find it, and the texture test path. **Reaches 16 of 60
castle assets.** Cheap per asset, bounded, and by measurement 1 it is not
sufficient on its own.

**C. Give the generated pipeline a real material story.** Extend
`gltfAssembler.ts` so generated assets can carry either textures (UV
accessors plus embedded images) or, at lower risk, `COLOR_0` vertex colours
and richer per-part materials. Reaches **all 60** castle assets and every
other asset on the island, keeps identical vertices for state-variant pairs,
keeps exact geometry for graded puzzles, and keeps everything bespoke and
licence-clean. The vertex-colour variant has a real advantage worth
weighing: it adds visual richness **without** an image reference, so the
jsdom test strategy survives untouched and prerequisite 3 does not arise.

**D. Replace the art wholesale**, including gameplay geometry, from a kit or
a commissioned artist. Highest ceiling and the only option that plausibly
reaches "Roblox / Prodigy feeling" outright. Also the most expensive, and it
breaks the identical-vertex property that ten phases of state-variant swaps
depend on, so every one of the 22 pairs would need re-authoring and
re-verifying.

### Proposed decision

**C first, then B for the 16, with D deferred to a product and budget
decision that is not this ADR's to make.**

1. **Build the material story in the generator (C)**, starting with the
   vertex-colour variant because it lifts all 60 assets while leaving the
   test strategy intact. Only escalate to real textures if vertex colours
   demonstrably fall short, and if so, build the texture test path as its
   own change before the first textured file is checked in.
2. **Then import CC0 scenery for the 16 (B)** if it still looks worth it,
   and prove the manifest swap is a one-line change with no game-logic edit
   - which is the upgrade roadmap's own Phase 1 exit criterion and
   something the current registry was designed for.
3. **Re-cost the upgrade roadmap against one finished room** before
   building any of its systems.

**The honest limit of this recommendation: C is necessary but probably not
sufficient.** Textured or vertex-coloured 2.6-mesh box assemblies are better
boxes. Geometry density and actual art direction need a person, and there is
no artist in this environment - which is the generator's own stated premise.
So this ADR settles the *architecture* question (where art enters the
pipeline, and what has to be true before it can) and explicitly does not
settle the *sourcing* question (whether to commission art, buy a
higher-fidelity pack, or accept a stylised generated look as the product's
identity). That is a budget and product call. It should be made knowing
that the pipeline is now ready to receive art from any of those sources
without a game-logic change.

### What this does not license

- **No gameplay-bearing asset is imported.** The 44 stay generated. A door
  with no handle, a shelf slot empty until `FIRST_STORY_TOLD`, three rods
  whose lengths are the graded answer, and nine stars in rows of five and
  four are not purchasable, because the geometry is the puzzle. This half
  of the 2026-08-28 decision is restated, not dropped.
- **No state-variant pair is split across sources.** Both halves of a pair
  come from the same producer, or the construction-time swap visibly pops.
- **No CC-BY asset without an attribution surface a parent can reach**, and
  no marketplace asset whose terms exclude redistribution inside an app
  bundle. Prefer CC0.
- **No change to collision, interaction, or binding authoring.** If an
  import appears to need one, that is the signal to stop and write a
  separate ADR, not to relax the boundary.
- **No AI-generated imagery or textures.** Out of scope in both castle
  roadmaps and unchanged here.

### Consequences

- `docs/THREE_WORLD_ASSET_CONVENTIONS.md`'s "Texture-free, by design"
  section is superseded on acceptance and needs rewriting, along with a new
  section on whichever material path is chosen.
- An asset licence ledger becomes owed the moment any third-party file
  lands, and needs a parent-reachable attribution surface, which is a UI
  change and not only a docs one.
- `assetLoader.test.ts` and `src/test/setup.ts` are the blast radius for the
  texture variant. Under the vertex-colour variant they are untouched,
  which is most of that variant's argument.
- SC-11's profiling pass becomes more urgent, not less: richer materials on
  the Great Library, already the densest room on the island, is exactly the
  change that wants a measurement on real hardware first. It has still never
  run outside SwiftShader in a container.
- Nothing about age bands, safety, authorization, or the adventure and
  story engines is affected. This ADR is confined to asset production.

### To price before accepting

None of these numbers exist yet, and the decision is better made with them:

1. Generator work for vertex colours across 108 assets, versus the same for
   textures plus a jsdom texture-loading test path.
2. Per-asset import cost for the 16 - normalisation, re-pivoting, and
   visual check against the room they sit in.
3. Whether a CC0 kit exists whose style matches 44 generated assets it will
   stand beside. **Partly answered:** see `docs/ASSET_SOURCING.md`, which
   names The Complete KayKit (CC0, glTF native, $150) as the candidate and
   prices the audio and Polly work alongside it. A mixed-fidelity room may read worse than a consistent
   grey-box one, and the upgrade roadmap's section 4 warns about exactly
   this ("avoid mixing highly realistic assets with cartoon assets").
4. The sourcing question in the paragraph above, which is the one that
   actually determines whether the castle becomes showable.


## ADR-029: Phaser 2D views are phased out; new regions are authored in Three.js only

> Renumbered in the post-merge reconciliation (was ADR-021; the incoming Storykeeper Castle / Wonderwild / Clockwork line collided with the Django migration ADR-019 to ADR-022). Text and status are unchanged. Related, not duplicate: ADR-020 (Django line) is the owner-accepted decision to retire Phaser entirely and make `game/` a package; this ADR is the narrower, earlier rule for sequencing 2D view removal and authoring new regions. Neither supersedes the other.

Status: Accepted (direction set 2026-09-09); retirement of each existing
Phaser view is sequenced, not immediate

ADR-008 adopted Three.js as the next-generation renderer but deliberately
left the two renderers coexisting: "Phaser is not retroactively erased...
the already-shipped Phaser world is the current production state and stays
live until a Three.js vertical slice reaches feature parity." That was the
right call while the Three.js path was one unproven region. It is no longer
the state of the build: Welcome Harbor, Pirate Builder Bay, Storykeeper
Castle, Wonderwild Forest, the Wonderwild hive, and Clockwork Harbor all
have first-person regions, and the shared kit under
`src/features/island-map/three/` (`sceneKit.ts`, `firstPersonController.ts`,
`pointerControls.ts`, `sandboxTriggers.ts`, `npcApproachBridge.ts`,
`worldEngineEvents.ts`, `assets/`) is where region work actually happens.

**The decision.** Three.js is the renderer. New regions are authored
first-person and 3D only, with no 2D counterpart. The Dragon's Sanctuary is
the first region built under this rule and authors no tilemap. The existing
Phaser views are phased out rather than maintained in parallel.

**What "phased out" means, precisely.** Not a mass deletion in one change.
Per view: the 3D region reaches parity, the route is switched to it, that
is verified, and only then are the view's `*Tilemap.ts`, `*Zones.ts`,
`*Decor.ts`, and `*WorldView.tsx` removed. Until a view's turn comes it
keeps working; what stops immediately is *authoring new content into it*.
A region that exists in both today is not a region to improve in both.

**What does not change.** Everything ADR-008 kept: the layering rule, the
constraint that a Three.js scene never validates an answer or awards
progress, durable state keyed by semantic ids rather than object UUIDs, and
`ChattyAvatar.tsx`'s Canvas 2D portraits, which are not a world renderer
and are unaffected.

**The risk this accepts, stated plainly.** ADR-008's open risk was
accessibility and comfort for Sprouts (ages 3-4) under a first-person
camera, and its Phase 32 status update named "the card-based hub and the
Phaser view" as Sprouts' primary route while the playtest remained unrun.
That playtest still has not run. Removing the Phaser view removes one of
those two fallbacks.

The requirement it was protecting survives in the other: the non-graphical
alternate navigator - the card-based location hub - is a hard requirement,
not an optional nicety, and it stays. A child must always be able to reach
any location and any adventure without walking there. This ADR does not
license removing that, and a Three.js region that is the *only* way to reach
its content would violate it regardless of renderer.

Two consequences follow, and both are obligations rather than notes:

1. The Sprouts playtest becomes more load-bearing, not less, because there
   is now one fallback rather than two. `docs/PILOT_READINESS.md` section 5
   still holds the runbook.
2. Each Phaser retirement must confirm the card-based route to that
   location's content still works before the view is deleted.

**Consequences.**
- `docs/regions/dragons-sanctuary-reconciliation.md` section 2's earlier
  recommendation to follow Storykeeper Castle's dual-view pattern is
  withdrawn by this ADR.
- The Dragon's Sanctuary's existing 2D artefacts are superseded on the day
  the 3D region takes its route.
- `scripts/generate-world-assets.ts` and the GLB pipeline become the only
  art pipeline that matters, which sharpens ADR-028 rather than resolving
  it: every region is now downstream of the untextured-primitive problem.

## ADR-030: Uploaded models live in S3 behind Admins-only Asset records; the bundled manifest stays the runtime fallback

> Renumbered in the post-merge reconciliation (was ADR-022; the incoming Storykeeper Castle / Wonderwild / Clockwork line collided with the Django migration ADR-019 to ADR-022). Text and status are unchanged.

Status: Accepted (2026-09-27), covering Phases 1-2 of
`docs/android/ASSET_MANAGEMENT.md`

ADR-014 said the content manifest would be "designed, not built, until it
has something to protect". The Model Asset Manager is that something:
administrators now need to bring in GLB models from outside the
generate/import scripts (commissioned characters, AI modeling tools,
packs too large to commit), and those models need a home that is not the
Git repository.

**The decision.**

- A generic `Asset` model plus an immutable `AssetVersion` per uploaded
  file (`amplify/data/resource.ts`). Game content will refer to an asset by
  id or slug, never by file name. `Asset.slug` shares a namespace with the
  bundled `ASSET_MANIFEST` ids, as the `AssetCatalogEntry` design in
  `docs/platform/WORLD_ITEM_AND_ASSET_MODEL.md` already proposed.
- Files go to the existing Amplify Storage bucket under a new
  `assets/*` prefix, one object per version
  (`assets/models/<folder>/<assetId>/v<n>/model.glb`), so a replacement
  never overwrites bytes that may be cached.
- Both models and the storage prefix are **Admins-group only** for every
  operation. Parents, and so children, get nothing.
- Uploads land as `DRAFT`. Nothing in Phases 1-2 can publish.
- `src/features/assets/assetService.ts` is the only code that turns an
  asset reference into a URL. `resolveModelUrl(id)` prefers a published
  asset with a matching slug and otherwise returns the bundled
  `public/models/` file.

**Why the bundled manifest stays authoritative at runtime.** Today every
region loads about 3 MB of committed models and works offline. Serving
children's worlds from S3 would add a network dependency, a new failure
mode mid-session, and a cost for Android's planned offline mode, in
exchange for nothing children can see yet. So the bundled file is always
the fallback, and `assetLoader.ts` is deliberately **not** wired to
`resolveModelUrl` until Phase 5 gives parents a published-only read path.
Wiring it earlier would add a guaranteed "Unauthorized" call to every
scene load.

**Why Admins-only reads, even for published assets.** A model-level rule
cannot say "authenticated users may read rows whose status is
`PUBLISHED`". Granting `allow.authenticated().to(['read'])` would expose
drafts, source notes, and admin user ids to every parent. The published
read path will be a narrow custom query or a generated manifest (Phase 5),
not a wider model rule.

**What this does not change.** The generated and imported assets in
`public/models/` stay committed, stay under test, and stay the way scenes
load today. "Do not place GLBs in Git" from ASSET_MANAGEMENT.md applies to
admin-uploaded models, not to the existing pipeline; moving those is a
separate migration decision.

**Consequences.**

- Upload limits (`MODEL_MAX_UPLOAD_MB`, `MODEL_WARN_UPLOAD_MB`) are
  enforced in the browser only. Acceptable because only admins can write,
  so the limit guards against mistakes rather than attacks.
- Rules are verified structurally in `src/features/assets/authorization.test.ts`;
  the live check is listed in `docs/AUTHORIZATION_REVIEW.md` section 5.

## ADR-023: The admin section is styled with Tailwind CSS and shadcn/ui; the rest of the app stays on CSS Modules

Status: Accepted (2026-09-27)

CLAUDE.md section 8 sets the styling baseline as "CSS Modules or a small
token-based styling system", unless an ADR changes it. This ADR changes it
for `/admin/*` only.

**Context.** The admin section (families directory, child progress, game
assets, model list, upload wizard) is internal tooling: tables, forms,
status badges and alerts, used by adults on a desktop. It had been borrowing
the parent dashboard's CSS modules plus its own `AssetAdmin.module.css`,
and each new admin page meant restating the same table, form and button
styles. The island's look (chunky buttons with a pressable lip, display
headings) is designed for children and is the wrong register for dense
admin screens.

**The decision.**

- Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/vite`, dev dependencies)
  compiles one stylesheet, `src/features/admin/admin.css`, imported only by
  `src/features/admin/AdminLayout.tsx`.
- shadcn/ui components are **vendored**, not installed: Button, Badge,
  Alert, Card, Table, Label, Input, Textarea and Native Select live in
  `src/features/admin/ui/` as our own source. Their runtime dependencies are
  `clsx`, `tailwind-merge`, `class-variance-authority` and
  `@radix-ui/react-slot` (for `asChild`, so a router `Link` can look like a
  button and still be a link). No other Radix packages, no icon library, no
  `@/` path alias; the shadcn CLI is not used, because it needs that alias.
- Every `/admin/*` route renders inside `AdminLayout` (a nested route under
  one `RequireAdmin` gate), which owns the top bar, the section nav and the
  page's `<main id="main-content">`.
- The admin palette is shadcn/ui's semantic names (`primary`, `muted`,
  `border`, `destructive`...) mapped onto the existing tokens in
  `src/styles/tokens.css`. No new colours, so every text/background pair is
  one `tokens.test.ts` already checks.

**How it is kept away from children's pages.** Three mechanisms, each
covered by `src/features/admin/adminCss.test.ts`:

1. *No theme variables on `:root`.* tokens.css already defines
   `--color-*`, `--radius-*`, `--shadow-*` and `--font-*`, exactly the
   namespaces Tailwind's theme uses. Both `@theme` sources are imported as
   `reference inline`, so Tailwind writes resolved values into each utility
   and emits no variables. The test compiles `admin.css` and fails on any
   custom property other than Tailwind's private `--tw-*` ones.
2. *Scoped reset.* Tailwind's global Preflight is not imported. An adapted
   copy lives inside `@scope (.admin-root)`, the class only `AdminLayout`
   sets, and inside `@layer admin-reset`: some utilities (`divide-y`,
   `space-y-*`) have zero specificity, and an unlayered scoped reset would
   beat them on scope proximity. The test fails if any element selector
   appears outside that scope, or if the reset leaves its layer.
3. *global.css steps aside for buttons.* The island's button rules (the lip,
   the press, the hover brighten) have up to 0,2,1 specificity and would
   beat any single utility class. They now carry
   `:where(:not(.admin-root *))`, which adds no specificity, so the ~35 CSS
   modules that override them are unaffected. The test fails if a `button`
   rule in global.css lacks the exclusion.

Utilities are unlayered on purpose: global.css is unlayered, and an
unlayered rule beats any layered one, so layered utilities would lose to its
bare `a` and heading rules. Utility generation is limited to admin files
(`source(none)` plus explicit `@source` paths); a new admin file elsewhere
must be added to that list.

**Alternatives considered.**

- *Bootstrap.* Faster to a finished-looking page, but it ships a large
  stylesheet, its own palette (to be overridden to match the tokens), JS for
  interactive parts, and a global reset (Reboot) that is much harder to
  confine than a hand-scoped Preflight.
- *daisyUI.* Fewest dependencies (a plugin, no JS), but less accessibility
  behaviour built in and a more generic look.
- *Tailwind Plus / Catalyst.* The most polished application screens, but
  paid, and Catalyst adds Headless UI.
- *Keep CSS Modules for admin.* Viable, and what the rest of the app does.
  Rejected for admin because tables, forms and statuses were being
  re-authored per page; a small component set is cheaper to extend.

**Consequences.**

- Two styling systems in one app. The boundary is the route: `/admin/*`
  is Tailwind, everything else is CSS Modules. Child-facing and parent-facing
  code must not import from `src/features/admin/ui/`.
- `@scope` needs a 2024+ browser (Chrome 118, Safari 17.4, Firefox 146).
  Acceptable for an internal tool; in an older browser the admin pages
  render with browser-default margins and list bullets, not broken.
- shadcn/ui upstream fixes are not pulled in automatically; vendored files
  are updated by hand. The deliberate deviations (no `outline-none`, so the
  island's tested focus ring stays; no dark-mode variants; Alert without a
  hard-coded `role`) are listed in `src/features/admin/ui/variants.ts`.
- `AssetAdmin.module.css` is deleted; the admin pages no longer import
  `ParentDashboard.module.css` or `ChildDashboard.module.css`.

## ADR-031: Islands and Adventures are an admin catalog overlaid on source-controlled content; Superusers are Admins with one extra group

Status: Accepted (2026-09-27)

`docs/ISLAND_ADVENTURE_MANAGEMENT.md` asks for admin pages that list,
create, activate, and deactivate Islands and Adventures, with
Superuser-only adventure deletion. It also says to prefer the established
architecture over a parallel system, and the established architecture is
that islands (`ISLAND_LOCATIONS`) and adventures (`ADVENTURE_TEMPLATES`)
are TypeScript content packs, not database rows (ADR-009, ADR-011,
ADR-013).

**Decision, part A: a catalog overlay, not a content migration.** Three
new models, `Island`, `Adventure`, and `AdventureModel`
(amplify/data/resource.ts), hold what an administrator manages: name,
descriptions, `active`, `sortOrder`, and which existing `Asset` records an
adventure uses. `slug` is the join to the content: an `Island.slug` is an
`ISLAND_LOCATIONS` slug, an `Adventure.slug` is an `ADVENTURE_TEMPLATES`
slug. Steps, challenges, and grading stay in code. An admin-created record
whose slug has no content is a catalog entry for content not yet authored
and is never playable; the admin pages label it "No game content yet".
"Import game content" on `/admin/islands` creates a row for every
source-controlled island and adventure that has none, never overwriting an
existing row. Story-arc adventures use pseudo-location slugs, so
`STORY_ARC_ISLANDS` (`src/features/catalog/islandForTemplate.ts`) files
each arc under the island its story leads to.

**Decision, part B: absence means available.** A slug with no catalog row
is playable, so a fresh environment and every test keep working before
anyone imports. Only `active: false` takes content out of play:
`isAdventureAvailable` (`src/features/catalog/availability.ts`) is
`island.active && adventure.active`, and an adventure without its own row
follows its code island's row. Deactivating an island never rewrites its
adventures' flags. Enforcement is in `resumeOrStartSession`, the single
path every route uses to start or resume play, plus the location lists
(`WelcomeHarbor`, `WorldHubPage`) and `IslandLocationPage`. The child-side
read fails open to "everything available": the catalog is a release
control over curated content, not a safety boundary.

**Decision, part C: Superusers are Admins plus one group.** A new
`Superusers` Cognito group grants only `Adventure` delete. A Superuser is
an `Admins` member who is also in `Superusers` (`adminAccessFromGroups` in
`AuthContext.tsx`; `npm run grant-admin -- <email> --superuser` adds both).
No second role system.

**Decision, part D: deletion never touches child history, and is refused
when it would mislead.** `AdventureSession` and everything under it are
keyed by `templateSlug`, not by the catalog row's id, so deleting a row
cannot cascade into progress. `deleteBlockReason` still refuses two cases:
the slug has game content (without a row it would become available
again), or any `AdventureSession` references it (deactivate instead). In
practice only unplayed, admin-created entries can be deleted. Islands
cannot be deleted by anyone (no delete rule).

**Decision, part E: non-admins see the standard 404.** `RequireAdmin`
renders `NotFound` for a signed-in non-admin instead of "Not authorized",
so the admin section's routes are not disclosed. Signed-out visitors are
still sent to sign-in, as for every protected route.

**Consequences**

- Signed-in parents can read `Island`/`Adventure` rows, including names of
  inactive or unreleased entries; `createdBy`/`updatedBy` are Admins-only
  at the field level and the child app reads through an explicit
  selection set. Accepted: catalog names are not sensitive.
- A parent who blocks the catalog request can still play an inactive
  adventure (fail-open), and `AdventureSession.create` is owner-writable,
  so the gate is not server-enforced. Same accepted limitation class as
  `docs/AUTHORIZATION_REVIEW.md` section 5's progress-forgery row.
- Slug uniqueness is checked by the client (`listIslandBySlug` /
  `listAdventureBySlug`); DynamoDB cannot enforce it on a secondary index.
- No thumbnails yet: the asset system has no image assets. No audit
  events: there is no audit subsystem, and every write carries
  `updatedBy` so one can be added cleanly.
- The schema change needs a sandbox/pipeline deploy before any of this
  works against a real backend.

## ADR-032: Three.js locations are described by a serializable manifest that reuses the existing interaction and checkpoint vocabularies

Status: Accepted (2026-10-04). Phases 1 to 9 of `docs/engine/10_IMPLEMENTATION_PHASES.md` are built: every active 3D region - Welcome Harbor, Pirate Builder Bay, Wonderwild Forest, Clockwork Harbor, the Dragon's Sanctuary and Storykeeper Castle - runs on the generic route.

Adding a 3D region currently means a new route page, `*WorldView.tsx`,
`*Scene.ts` and `*Region.ts`. The audit
(`docs/platform/THREE_LOCATION_DUPLICATION_AUDIT.md`) found that most of
that code is the same skeleton repeated six times, and that every
`*Region.ts` is already plain numbers.

**Decision, part A: one manifest type, plain JSON.**
`ThreeLocationManifest`
(`src/features/island-map/three/runtime/locationManifest.ts`) describes
what a region contains and where: bounds, environment, checkpoints,
colliders, open-sided buildings, decorative scenery (tiled ground, flat
planes, instanced clusters, LOD placements, kit runs), NPC placements,
collectibles, trigger zones, ambient movers, interactions, extensions and
screen copy. It holds no functions, `three` objects or React components.
`validateLocationManifest` rejects anything that is not plain JSON, so a
manifest can later become an Admin draft and published snapshot without
changing meaning.

**Decision, part B: reuse, don't fork, the binding vocabulary.** A
manifest's `interactions` are `WorldInteraction`s from
`src/features/island-map/worldObjects.ts`, unchanged. An entity names an
interaction id, and the existing `WorldAction` (TALK_TO, DISCOVER,
START_ADVENTURE, START_STORY, NAVIGATE, SHOW_MESSAGE) hands off to the
engine that owns the meaning. The manifest adds no adventure, quest,
discovery or mastery semantics of its own.

**Decision, part C: checkpoints stay in the World State layer.** The
manifest lists checkpoint ids, not positions. `discovery/checkpoints.ts`
keeps owning ids, labels and coordinates (ADR-008). Validation requires
the list to equal the region's authored checkpoints in authored order,
because `resolveSpawnCheckpoint` falls back to the first. Saved
`ChildWorldState.lastCheckpointId` values stay valid.

**Decision, part D: the key is the region id, not the location slug.**
`regionId` is the same string `RegionCheckpoint.regionId` uses. Welcome
Harbor is the hub, not an `IslandLocation`, so `locationSlug` is optional
and validated against `ISLAND_LOCATIONS` (including world ownership) when
present.

**Decision, part E: validation takes registries as input.** The same
pattern as `worlds/validate.ts`. `SOURCE_MANIFEST_REGISTRIES` builds them
from source-controlled content today, and an Admin publish step can pass
the published catalog later. The extension registry is empty until the
first bespoke mechanic moves behind it, so a manifest declaring an
extension fails validation until then.

**Decision, part F: one route, `/island/:childId/explore/:regionId`.**
`LocationWorldPage` serves every manifest-driven location, and the view
reports a region with no manifest calmly. The roadmap suggested
`location/:locationSlug`, but `locations/:locationSlug` already belongs to
the 2D location card and `world/*` to the Phaser pages, so a distinct
`explore/` segment keeps the three apart instead of one letter apart. The
parameter is the region id (part D), not a location slug. A region's old
per-region URL becomes a `LegacyLocationWorldRedirect` (history replaced,
query string kept) when that region moves over; `world/welcome-harbor-3d`
is the first. Links use `locationWorldPath()` rather than building the
string.

**Decision, part G: an extension has a scene half and a React half under
one id.** The scene half (`WorldExtension`, `runtime/extensionRegistry.ts`)
is mounted by the engine with a deliberately small context: add or remove
a collider by id, find a scenery item's root by id, play an NPC gesture,
load a model, per-frame callbacks, a clock. It may return an `api`. The
React half (`LocationViewExtension`, `runtime/viewExtensionRegistry.ts`)
may claim an interaction for some children, which the view checks on every
way into an interaction, and renders an overlay on the stage, receiving
the scene half's `api`. Config is plain JSON that the extension parses and
validates itself at runtime. The shipped registries live in
`three/extensions/index.ts`, outside `runtime/`, so the runtime imports no
mechanic. The first extension is `tide-trial` (Pirate Builder Bay's "Beat
the Tide"), moved out of `pirateBuilderBayScene.ts` and
`PirateBuilderBayWorldView.tsx` with its behaviour unchanged.

Migrating a second, structurally different region added generic vocabulary
rather than special cases: `BOX` and `MODEL` scenery, per-instance cluster
scale, interactive `props` with an optional one-shot clip, and
`requirements` (the existing `WorldRequirement`) on scenery and colliders,
evaluated once when the scene is built. A broken versus mended bridge is
two scenery items and a collider with opposite requirements, not a branch.

**Decision, part H: a binding is data, and the engine it binds to is
unchanged.** Phase 8 moved the two kinds of direct binding the audit found
in region code behind declarative vocabulary:

- **Adventure step bindings.** A thing in a room standing for an option of
  an adventure step is `AdventureStepBinding`
  (`runtime/adventureStepBindings.ts`), and every lookup over a table of
  them - forward, reverse, per step, and a seated row to an `ordering`
  answer - lives there once. `castleChoiceBindings.ts` and
  `wonderWallBindings.ts` keep their authored tables and delegate, and
  `ThreeLocationManifest.adventureBindings` is where each table moves when
  its region migrates. `findAdventureBindingIssues` is the authoring check,
  run against the real adventure content: the adventure, step and option
  must exist, every option of a bound step must have exactly one entity, an
  entity may mean one thing per adventure (one set of rooms, two age bands)
  and no more, and every bound entity must be placed. The Adventure Engine
  still owns every transition, hint and judgement of correctness; a binding
  resolves to an option id and stops.
- **Pickup world changes.** A collectible may declare `worldChange`, which
  the view hands to the existing idempotent `recordWorldChangeOnce` with
  provenance `exploration:<entityId>`, plus an authored `pickUpMessage`.
  Validation requires the matching `WORLD_CHANGE_ABSENT` requirement on the
  same collectible, so a recorded pickup cannot reappear on the next visit -
  the live Clockwork Harbor bug the audit recorded, refused by the
  validator rather than re-made per region.

What Phase 8 deliberately did not add: a generic in-world *host* for an
adventure step (the castle's own session UI stays its own until Phase 9
migrates it), prop world changes (Dragon's Sanctuary's runes, which carry
a carry-and-place mechanic that wants an extension), and requirement-gated
lighting, which no migrated region needs yet.

**Decision, part I: a region's placeholder art is an extension, not
manifest vocabulary.** Phase 9 migrated three more regions, and each needed
something the manifest could not say. Two became generic vocabulary, because
they are what *any* region wants:

- `SCATTER` scenery and `TILED_GROUND` `coverage: 'COVER'` - deterministic
  placements through the part of a region a child cannot walk on, and a tiled
  grid that covers its area edge to edge. Wonderwild Forest's tree line is
  derived as the complement of its walkable set, so its trees cannot be hand
  listed; `walkableProbe` reads the same colliders the controller does, and
  the manifest test proves the scatter lands exactly where the per-region
  scene put it.
- `environment.variants`, `copy.statusLines` and `copy.thingsToDoNotes` -
  requirement-gated sky, lighting, and the one-line "the lighthouse is dark"
  status each region's view used to compute with a ternary. Also
  `ITEM_ABSENT`, the mirror of `ITEM_OWNED` (a dark cave mouth and a lit one
  are two props with opposite requirements), `elevation` on a collectible
  (a gear on a roof line) and `requirements` on a prop.

The third thing stayed bespoke, and the shape it took is the decision worth
recording. Clockwork Harbor's machinery and the Dragon's Sanctuary's hearth,
sockets, gates and dragon are `three` primitives standing in for asset
inventories neither roadmap has authored yet. Rather than grow the manifest a
geometry language for a torus a GLB will replace, **an interactive entity may
declare no `assetId` at all**: the runtime still creates its root, raycasts
it, labels it and interacts with it, and an extension fills that root in
through `WorldExtensionContext.entityRoot`. So `clockwork-machinery` and
`sanctuary-art` own nothing but appearance - every focus, label, interaction
and pickup stays generic, and when the real art lands the manifest gains
`assetId`s and the extensions shrink to the parts that actually move.

Two behaviour changes came with the migration, both deliberate:
- Picking up a Golden Gear now records `goldenGearChangeKey`, so it stays
  found. The per-region view only toasted, which is the bug the audit
  recorded against Clockwork Harbor.
- The sanctuary's three rune hints are now per rune, so a hint for a rune the
  child already has stops being shown instead of a count quietly going down.

**Decision, part J: a region whose learning runs in the room gets a
companion, not an overlay.** Storykeeper Castle was the last region to
migrate and the only one whose bespoke part was *behaviour* rather than art,
and that difference is what the extension API had to grow for.

An `Overlay` opens when a child opens an interaction and closes again. The
castle needs three things that cannot wait for that: a session left open
yesterday resumes with the child's portrait already lit, Keeper Quill's
gestures follow the rung of the hint ladder they are on, and the reticle says
the option's own words from whichever of two adventures their band plays. So
a view extension may now declare a `Companion`, mounted for the whole visit,
which receives the region's event bus, the child's world state, the AI
setting, a toast, a focus-label override, the session clock's `limitReached`,
and both the interaction it claimed and whatever panel is open. The scene
half gained `interceptInteract` (a plate going into a socket is a move inside
a puzzle, not a domain event), `npcAnimator` (a gesture that plays once and
*holds*, because wayfinding must still be there when the child looks up from
the HUD) and `setFocusable` (a thing in the child's hands leaves the
reticle's reach).

What that bought: the castle's view-level branching is gone rather than
moved. Its authored interactions already carried the requirements the view
used to switch on - the story hall before and after a story is told, the
secret door before and after the arc - so the generic walk-in path resolves
all of them, and the two that open *learning in the room* are the only ones
the extension claims. The manifest carries the rooms, every derived wall,
the light per room, the twenty zones and the castle's own binding table.

One thing this part deliberately does not do: give the companion the
construction-time options the per-region engine took. A manifest-built scene
has no equivalent, so restored session state is applied by an effect as soon
as the scene exists, which is idempotent and order-independent.

**Decision, part K: an asset id reaches a loader only through a resolver,
and an extension declares what it loads.** Engine Phase 10 (asset
integration cleanup). Three rules:

1. `AssetResolver` (`three/assets/assetResolver.ts`) is the one step between
   an id and a url. `assetLoader.ts` is now `createAssetLoader(resolver)`,
   and the module-level functions every scene calls are one loader bound to
   `BUNDLED_ASSET_RESOLVER`. `assetService.ts`'s published-slug lookup is
   the second resolver, `PUBLISHED_ASSET_RESOLVER`. It is **not** handed to
   the child's scene. `Asset` is Admins-only until the asset manager's
   publishing phase gives parents a published-only read path (ADR-030), and
   before then it would add a lookup that always fails to every scene load.
   When that path exists, switching is one line in `assetLoader.ts`.
2. A world extension declares `assetIds(config)`. The validator checks those
   ids against the catalogue like the manifest's own, and the runtime
   rejects `loadModel` for any id the binding did not declare. Enforcing it
   is what makes the declaration trustworthy enough to drive (3).
3. Per-location asset usage is derived from manifests and declarations
   (`runtime/locationAssetUsage.ts`), not kept by hand. The admin Island
   page's "Scene models" now covers every 3D location rather than Pirate
   Builder Bay alone, and the same index is what a future delete guard on
   `Asset` will read (`docs/engine/06_ASSET_SYSTEM.md` "Admin Asset Usage").

No new asset model (acceptance AS1): `Asset`/`AssetVersion` are unchanged,
and a published `Asset.slug` still shares its namespace with the bundled
catalogue's ids. Hard-coded asset paths are confined to the bundled
catalogue, and `noHardCodedAssetUrls.test.ts` keeps them there.

**Not checked for an adventure binding:** that the bound adventure is
authored for the manifest's own location. A story arc's chapters belong to
the arc rather than the room that hosts them (the castle's are authored for
`castle-secret-passage`), so a region binding them is correct rather than
suspect.

**Consequences.**
- `runtime/manifests/welcomeHarbor.ts` expresses Welcome Harbor with zero
  extensions, built from `welcomeHarborRegion.ts`'s constants so the two
  cannot drift. Nothing renders it yet, and the existing scene is
  untouched.
- Collectible `label` is authored but not yet shown: `WorldHud` renders
  every crosshair label as "<label>: press E to talk", so only NPCs get one
  (`manifestBindings.focusLabel`) until the HUD can take a verb.
- The runtime (`createLocationEngine.ts`) takes its renderer, assets, input,
  resize and frame scheduling as injected dependencies. That is what lets
  the runtime acceptance tests (W1 to W7) run in jsdom. Disposal frees only
  runtime-created geometry and materials, because loaded glTF data is shared
  through the asset loader's cache.
- Bespoke behaviour is mounted from `extensionRegistry.ts` by id. The
  runtime directory may not name any location (`noLocationBranching.test.ts`).
- Still open: world-change variants (Phase 8), and whether checkpoint
  positions move into the manifest when Admin authoring arrives. That last
  question changes ADR-008's layering and needs its own decision.

## ADR-026: Multiplayer runs on a separate authoritative room server over WebSocket; the engine only renders it

Status: Accepted (2026-10-13), with the amendments at the end of this
entry. Written for Phase 0 of `docs/MATH_MAYHEM_MULTIPLAYER_ROADMAP.md`;
findings behind it: `docs/multiplayer/PHASE_0_BASELINE.md`. Phase 1 is
built on it: `docs/multiplayer/MULTIPLAYER_SERVER.md`.

**Context.** The roadmap asks for real-time shared rooms: presence,
synchronised movement, a cooperative objective, server-decided spawns and
rewards. The only shared-session mechanism today is `CoopSession`
(ADR-006), where every change is an AppSync mutation, so every update is a
DynamoDB write. That suits discrete co-op actions. It does not suit
movement at several updates a second, which the roadmap rules out writing
to DynamoDB.

**Decision, part A: transport and hosting.** Options considered:

| Option | Authoritative in-memory state | Per-update DB write | New deps | Always-on cost |
|---|---|---|---|---|
| Extend `CoopSession` (AppSync mutations + subscriptions) | no | yes | none | none |
| API Gateway WebSocket + Lambda | no (state must live in DynamoDB) | yes | none | none |
| AppSync Events (managed pub/sub) | no (relay; logic per message in handlers) | no for relay, yes for any authoritative check | none | none |
| Plain `ws` Node server on ECS Fargate | yes | no | `ws` | Fargate task + load balancer |
| **Colyseus Node server on ECS Fargate** | yes | no | `colyseus`, `@colyseus/schema`, `colyseus.js` | Fargate task + load balancer |

Proposed: **Colyseus** (Node.js, TypeScript) over WSS. It already provides
rooms, seat reservation, capacity, heartbeats and reconnection tokens,
which are most of Phase 1. The serverless options cannot hold authoritative
room state without a database write per decision.

Room logic (presence, movement validation, the vault state machine, spawn
decisions) is written as **pure TypeScript modules with no Colyseus
import**, tested in Vitest like the adventure engine. A thin Colyseus room
wraps them. If Colyseus proves wrong, swapping to `ws` replaces the wrapper,
not the rules. The client talks to a `MultiplayerTransport` interface, so
tests use an in-memory transport and the engine never imports a network
library.

Hosting: local Node process for development (`ws://localhost`, dev origin
only). Production, later and only once Phase 1 passes locally: one ECS
Fargate task behind an Application Load Balancer with an ACM certificate
(TLS terminates there), declared as custom CDK in `amplify/backend.ts`
beside the existing custom resources, with a cost budget alarm like the
Bedrock one. One task means no cross-node presence store is needed; scaling
past one task is out of scope for the first playable milestone.

**Decision, part B: world instance ownership.** A room is one instance of
one region for one party: key `(regionId, partyId)`. The server owns its
state in memory and drops it when the last player leaves or after a grace
period. The Three.js runtime stays a renderer: a registered scene extension
draws remote players and spawns, and the view half sends inputs. No region
check enters `runtime/` (`noLocationBranching.test.ts` still applies).

**Decision, part C: player identity.** The client sends its Cognito **ID
token** and the chosen `childProfileId` when joining. The server:

1. verifies the token's signature, issuer, audience and expiry against the
   user pool's public keys (`aws-jwt-verify`, a fourth new dependency);
2. reads that `ChildProfile` from DynamoDB (read-only IAM on that one
   table) and requires `ownerSub === token.sub`, the same check
   `claimCoopSlot` and `submitAdventureAnswer` make;
3. assigns the player id itself. It never trusts a client-supplied child id,
   display name or room membership.

Other clients receive only a server-assigned player id, `avatarKey` and a
slot colour. No nickname, photo, parent data or age band crosses the wire.
Reconnects re-present a token; a seat whose token expired is released.

**Decision, part D: who may share a room.** Unchanged from ADR-006 for the
MVP: **children of the same parent account only**, possibly on two devices
signed in to that account. Cross-family parties need their own decision
(consent, a sharing model across owners, moderation and abuse response)
and are not covered here. Public matchmaking stays off.

**Decision, part E: what is persisted.** Nothing per frame. Positions,
presence and spawn state live only in room memory. Durable outcomes go
through the existing domain paths: answers through `submitAdventureAnswer`,
world changes as `WorldChange`, items into `ChildInventory`. The server
logs counts and timings (rooms, players, message rates, latency) keyed by a
room id, never child ids, names or positions.

**Decision, part F: rewards.** The room server decides that a child earned
a cooperative reward. The grant is a conditional DynamoDB write to that
child's `ChildInventory` keyed on a stable rule id (the idempotency key
`grantRewards` already uses), so a replay or reconnect cannot grant twice.
It reuses the pure `src/features/rewards/` modules, as the Lambdas reuse
adventure code. Exact wiring is a Phase 4 decision.

**Decision, part G: movement authority.** Client-predicted, server-checked.
Each client moves locally as today and sends its pose at most 10 times a
second; the server rejects poses outside the manifest bounds or faster than
the walk speed plus a tolerance, and broadcasts snapshots that clients
interpolate. Remote avatars are never colliders, trigger volumes or focus
targets, so they cannot set off another child's NPC, checkpoint or pickup.

**Decision, part H: feature flag.** Multiplayer is off unless all of these
hold: a build flag (`VITE_MULTIPLAYER_ENABLED`) and a server URL
(`VITE_MULTIPLAYER_URL`) are set, the region's manifest opts in through a
registered extension, and (from Phase 3) the parent has turned it on. Every
existing region stays single-player.

**Consequences.**
- Amends ADR-006's v1 deferral of "continuous cursor/telemetry-level
  presence" for rooms on this server. ADR-006's rule that **no free-form
  input crosses between children** is unchanged: Phase 3's signals are a
  fixed, authored set.
- Adds four runtime dependencies and one always-on service with a monthly
  cost. Both need approval before Phase 1.
- Roadmap Phase 6 (rarity tiers, rare random drops) conflicts with ADR-013
  part A and CLAUDE.md pillar 7. This ADR does not resolve that. Phase 6
  needs its own decision first.

**Amendments on acceptance (2026-10-13).**
- *Packages.* Colyseus is now 0.18 and its browser client was renamed, so
  the installed set is `@colyseus/core` and `@colyseus/ws-transport` (in
  place of the `colyseus` meta-package, which also pulls in a monitor,
  playground, Redis drivers and an auth module), `@colyseus/sdk` (the
  renamed `colyseus.js`), `aws-jwt-verify`, and `express`, a required peer
  of the WebSocket transport. All are pinned to exact versions at least two
  weeks old. `@colyseus/schema` is only a transitive dependency: rooms send
  plain, runtime-validated messages rather than schema state.
- *Part C, step 2.* The server reads the child profile from **AppSync with
  the caller's own ID token** instead of DynamoDB through its own IAM role.
  `ChildProfile`'s owner rule then does the ownership check, the `ownerSub`
  comparison still runs on top, and the server needs no AWS credentials or
  table names.
- *Part D.* Confirmed by the product owner: same-family rooms only for the
  MVP.


## ADR-033: One Django backbone: Treasure Rush runs on the canonical catalog and progress models; play-region layouts are seed-authored until LAI-0805

Status: Accepted (project owner, 2026-10-24, POST-MERGE-03)

**Context.** Two branches built Django independently from the same `main`.
`storykeeper-castle-3d-storyboard-and-roadmap` built LAI-0304 (catalog), LAI-0305 (child
progress) and LAI-0601 (Python engine, answers and hints). `feature/treasure-rush-slice` built a
parallel catalog (`islands`, `adventures`), a progress subset with the same app labels and
different models, its own content loader, and Django rows for a region's spatial layout. The
two could not both merge.

**Decision.**
1. The Storykeeper Castle branch's Django implementation is canonical: the `catalog` app
   (World, Location, Adventure, Step, Quest, assets, and now the item, collectible-set,
   reward-rule, learning-objective and NPC rows Treasure Rush needed), the progress apps, the
   Python engine and its golden parity, and the one content import (`manage.py load_content`).
2. Treasure Rush is adapted onto it rather than kept as a second backend. Its play API keeps its
   contract (`docs/PLAY_API.md`); its services run on the canonical models
   (`apps/game_sessions/play.py`); sessions gain a `kind` (ADVENTURE or REGION) and
   `ChallengeAttempt` joins `game_sessions`.
3. Treasure Rush's non-spatial content (its quest, keepsake item and reward rule) is exported
   like all content (`react/src/features/content-export/treasureRushContent.ts`, export-only,
   so the Amplify app is unchanged) and imported into the catalog.
4. Spatial layout is **not** authoritative Django administration. The Treasure Cove region,
   spawn point, chest placement and challenge slots are rows in `apps/regions` and
   `education.ChallengeSpec`, applied by `manage.py seed_treasure_rush` from the source file
   `lai/apps/regions/treasure_rush_seed.py`, which is the temporary source of truth. No admin
   site registers them. LAI-0805's ADR decides how layouts are authored. Treasure Rush's TR-D3
   (admin-authored content is authoritative) is therefore not adopted.
5. Asset references from those rows are validated against the canonical asset catalog
   (`catalog.ContentAsset`), not against a bundled file.

**Consequences.** Development databases built from either branch must be recreated (no Django
database exists outside local development, and Treasure Rush's migrations were replaced). The
inventory app's initial migration was regenerated because its item and rule references became
foreign keys. Region sessions record a content release like every session.


## ADR-034: Django Admin is enabled with local staff sign-in, separate from Cognito; it ships as a gunicorn and WhiteNoise container

Status: Accepted (project owner, 2026-10-25, LAI-0404: the owner's brief asked for Django's
built-in staff and superuser authentication for the first implementation)

**Context.** ADR-024 A4 said Django Admin stays off until LAI-0404 and that admin authority
comes from the Cognito `Admins` group, with no Django superuser. TR-D5 (Proposed) left the
admin sign-in open: (a) staff flags on `ParentAccount` with a Cognito sign-in that creates a
Django session, or (b) a separate local staff login. No Cognito-to-Django-session integration
exists or is tested. The catalog admin (LAI-0304) was built on a separate `AdminSite` with a
role nothing set. Django has no deployment yet (no `infra/`; Phase 10 needs approval).

**Decision.**
1. **One admin site.** Django's default `admin.site`, at `settings.ADMIN_URL_PATH` (default
   `admin/`, env `DJANGO_ADMIN_URL_PATH`). The catalog `ModelAdmin`s move onto it;
   `catalog_admin_site` is removed. No second admin interface.
2. **Sign-in: TR-D5 option (b), local staff passwords.** `ParentAccount` gains `is_superuser`
   and a nullable unique `admin_username`. `apps.users.backends.AdminPasswordBackend` is the
   only Django authentication backend: it matches `admin_username` plus a Django password, and
   only for active staff. `ModelBackend` is not installed. Cognito parents have no admin
   username and a password hash that never matches, so they cannot sign in. Accounts are made
   only by `manage.py create_admin_account` (password prompted or from `DJANGO_ADMIN_PASSWORD`,
   validated, never an argument). There is no default account. A staff row may be linked to a
   real parent's Cognito sub (one person, two credentials) or standalone, with a placeholder
   sub no Cognito token can carry.
3. **Roles.** Active staff are the catalog `ADMIN` role (view everything registered, edit
   `active` and `sort_order`). Active staff superusers are `SUPERUSER`, and they also manage
   admin accounts. Delete stays closed until the content authoring cutover (ADR-031). There is
   no `PermissionsMixin`: auth's Group and Permission tables exist but are unused, and the Group
   admin is unregistered.
4. **A4 is amended for Django Admin only.** API authorization is unchanged: DRF authenticates
   with Cognito bearer tokens alone, a session never authenticates the API, and no API
   permission reads `is_staff`. A Cognito group never grants Django Admin access.
5. **No child data in Django Admin.** `ChildProfile` and every `ChildOwnedModel` stay
   unregistered until an audited cross-family read path exists (A4's audit requirement). Parent
   rows are not listed: the admin-accounts page shows staff rows only. Region and
   `ChallengeSpec` rows stay unregistered (ADR-033 item 4, LAI-0805).
6. **Cookies.** Admin session and CSRF cookies are scoped to the admin path, HttpOnly,
   SameSite=Lax, and Secure in production. Sessions last at most 8 hours and end when the
   browser closes. `DJANGO_CSRF_TRUSTED_ORIGINS` must list `https://` origins.
7. **React link and provisioning.** After every sign-in the React app sends `POST /api/v1/me/`,
   which creates the Django account the first time (option a, owner 2026-10-25) and returns
   `django_admin` (active staff). The account menu
   shows "Admin" to Django Admin only when that is true and the build sets
   `VITE_DJANGO_ADMIN_URL`; otherwise the existing `/admin` link for the Amplify `Admins`
   group is unchanged.
8. **Serving.** New pinned dependencies: `gunicorn` 26.2.0 (WSGI server) and `whitenoise`
   6.12.0 (admin static files, hashed and compressed, from `STATIC_ROOT`). The image is
   `lai/Dockerfile`. `collectstatic` runs when the image is built (amended the same day, so the
   S3 copy matches each image's manifest), and gunicorn writes no access log (G10). The admin
   may ship as its own release on `admin.<domain>`: CloudFront with `/static/*` from a private
   S3 bucket and everything else from Django. The health route is exempt from the HTTPS redirect for load balancer checks.

**Consequences.** One person who is both a parent and an administrator has two credentials
until a Cognito-based admin sign-in (TR-D5 option a) is built; that is the upgrade path, and
`admin_username` can stay as the link. Local passwords need rotation by hand (`create_admin_account
--reset-password`); roles change with `set_admin_role`, which, like the admin form, never removes the
last active superuser; there is no MFA on the Django login yet. Hosting is still to be provisioned
(Phase 10, APPROVAL), see `docs/DJANGO_TARGET_ARCHITECTURE.md`, "Django Admin hosting".


## ADR-035: The shared asset manager versions binaries on the canonical ContentAsset identity, with private storage and signed delivery

Status: Accepted 2026-10-25 (proposed and implemented on `feature/django-asset-manager` for
LAI-2200 the same day; accepted after the implementation was reviewed against it, before merge).
Detail: `docs/ASSET_MANAGER.md`.

**Context.** LAI-2200 asks for a reusable asset manager: definitions, immutable versions,
publication, S3 storage, Django Admin upload, a child-facing resolver and an import path.
`catalog.ContentAsset` already is the platform's asset identity, keyed by the bundled manifest id
and the Amplify `Asset.slug` (ADR-030), and CLAUDE.md section 20 (ADR-033) forbids a second
catalog. ADR-034 left `PermissionsMixin` out, but publishing needs a permission beyond read
access. S3 is not provisioned (LAI-1002 is open). `GLTFLoader` fetches URLs without an
`Authorization` header.

**Decision.**
1. **The definition is `catalog.ContentAsset`**, extended with Django-owned fields (`display_name`,
   `description`, `category`, `tags`, `status`, `origin`, `default_version`, timestamps). It may be
   created in Django (`origin=DJANGO`, no release) as well as by the export. The importer still
   owns the content fields it imports and never touches the Django-owned ones.
2. **A new `apps/assets` app owns binaries**: `AssetVersion` (immutable once published, unique
   `(asset, number)`, unique `version_id` and storage key, database checks for the publication
   invariants), the validation service, the storage abstraction, the resolver and delivery. It
   is not a catalog: it has no identity of its own.
3. **Formats:** GLB, and self-contained glTF (embedded `data:` URIs only). No external URIs, no
   Draco or meshopt, no FBX, Blender, ZIP or RAR (no conversion pipeline exists).
4. **Storage:** an `AssetStorage` interface with S3 (new pinned dependency `boto3`), local and
   in-memory backends, chosen by `LAI_ASSET_STORAGE`. Keys are server-made and never reused;
   S3 writes use `IfNoneMatch` and a SHA-256 checksum.
5. **Permissions (amends ADR-034 item 3):** `ParentAccount` gains `PermissionsMixin` (groups and
   per-user permissions). The catalog admin keeps its role rules. Asset actions are Django
   permissions (`publish_assetversion`, `retire_assetversion` beyond add, change and view).
   `manage.py ensure_asset_roles` creates the "Asset editors" and "Asset publishers" groups.
   Superusers keep every permission. Parents still cannot sign in to Django Admin.
6. **Resolution:** `GET /api/v1/children/<child_id>/assets/?ids=` (child-scoped, parent token).
   It returns published versions only, with statuses `resolved`, `unavailable` (unknown, draft
   or unpublished, indistinguishable) and `retired`.
7. **Delivery:** self-authorizing URLs. `django` mode serves through a signed token and re-checks
   publication on every fetch (immediate revocation for new fetches). `s3` mode presigns the
   private object (valid until expiry; no revocation of issued URLs). Both reuse one URL per
   half-TTL window so browser caches hit. Signed CloudFront URLs are the planned next step.
8. **Frontend:** a Django-backed `AssetResolver` outside the engine folder, falling back to the
   bundled resolver; not wired into any scene (TR-10 does that).

**Consequences.** Adds `django.contrib.auth` group tables to real use and a `users` migration for
the permission relations. Adds `boto3` and its pinned transitive packages. The `asset-files`
route is the second route reachable without a bearer token (capability URLs for published
versions only). A model can be published without any source change, and the same version
serves every region that names its id.

**Acceptance (2026-10-25).** The implementation (AM-1 to AM-10) was checked against items 1 to 8
and matches them. Items 1 and 2: `ContentAsset` carries the Django-owned fields and
`apps.assets.AssetVersion` has the database checks. Item 3: validation refuses external URIs and
Draco or meshopt. Item 4: S3 writes send `IfNoneMatch` and `ChecksumSHA256`, and `boto3` is
pinned. Item 5: `PermissionsMixin`, the two permissions and `ensure_asset_roles` are in place.
Items 6 to 8: the resolver statuses, the two delivery modes and the bundled fallback exist. None
of this decision is still open. The following stay as separate follow-up work and do not reopen
it: the production delivery mode (`django` or `s3`, chosen when LAI-1002 provisions the bucket),
signed CloudFront URLs (AM-11), licence and source fields, and an `AdventureAsset` join model
(`docs/ASSET_MANAGER.md` section 16).

**Amendment: admin preview (AM-10, 2026-10-25).** Item 7 (delivery) stays as it is, for gameplay
and published versions only. Staff inspect any validated, published or retired version through a
separate Django Admin route (`/admin/assets/assetversion/<pk>/preview/model/`). It needs a staff
session with `assets.view_assetversion` and a 10-minute signed token bound to the version and the
account. The token is sent in a request header, never in a URL. The route serves bytes only after
re-checking their SHA-256, and always streams them through Django, so no presigned URL is issued
for a preview. Draft and rejected versions are never served. The viewer is a Three.js bundle
(ADR-020: Three.js is the only renderer) committed as an admin static file, because the Django
image has no Node build step. No dependency was added. Detail: `docs/ASSET_MANAGER.md` section 17.


## ADR-036: Native Android uses the Django API with Cognito bearer tokens; the game-only WebView uses a ticket-redeemed, child- and region-scoped game session cookie

Status: Proposed 2026-10-25. Implemented on `feature/android-api-foundation` for
LAI-ANDROID-API-001, at the Django API boundary only. Owner acceptance is pending. Detail:
`docs/android/ANDROID_API_CONTRACT.md`, `docs/android/ANDROID_AUTH_FLOW.md`,
`docs/android/ANDROID_GAME_LAUNCH.md`.

**Context.** The owner asked for the Django APIs a native Kotlin Android app needs. The native
app owns sign-in, the parent screens, child profiles, island and adventure selection, settings
and navigation. A WebView is used only for the standalone Three.js game. Cognito stays the
identity provider (ADR-024) and Django is the one backend (ADR-033). The API was bearer-only and
had no session or cookie authentication. A WebView page cannot hold a Cognito token safely: page
script can read it, and URLs and JavaScript bridges leak it.

**Decision.**
1. **Native screens use the existing bearer contract.** The Kotlin app sends
   `Authorization: Bearer <Cognito access token>` and provisions with `POST /api/v1/me/`, the same
   call the React app makes. There is no Android registration endpoint and no Android client in
   the code: a new Cognito app client is allowed only by adding it to
   `COGNITO_ALLOWED_CLIENT_IDS`.
2. **New client-neutral, read-mostly routes** on the canonical models: child profile list,
   create, read and update; child home; region and adventure discovery; inventory. Deleting a
   child stays blocked (`SensitiveActionBlocked`) until LAI-0602 and LAI-0209.
3. **Game launch is two steps, both bearer-authenticated.** `POST
   /api/v1/children/<id>/game-launches/` checks ownership, that the child is active, and that the
   region is visible to the child, then returns an opaque ticket. The ticket is 256-bit random,
   stored only as a SHA-256 hash, and expires after 60 seconds by default. The native app then
   redeems it with `POST /api/v1/game-launches/redeem/`. Redemption is one conditional UPDATE, so
   the ticket is single-use even under concurrent requests. It is bound to the same parent and
   re-checks the child and region. It returns the game session cookie and revokes the parent's
   earlier game sessions.
4. **The game session cookie** (`lai_game_session`) is HttpOnly, Secure, SameSite=Strict,
   host-only and `Path=/api/v1/`, with a 60-minute default lifetime. Only its SHA-256 hash is
   stored. It is checked again on every request: not revoked, not expired, parent and child both
   active.
5. **The cookie is accepted narrowly.** It is never a default authenticator. It authenticates
   only `GET /api/v1/game-session/`, `POST /api/v1/game-session/end/`, and the region play and
   asset routes that opt in through `GameRuntimeAccessMixin`. Even on those routes it reaches only
   its own child and region, including their sessions, attempts and offered quests. Everything
   else is the same 404 as a missing record. Account, child management, launch, progress,
   inventory, home and discovery routes answer it with 401. A structural test pins the list of
   routes that accept it.
6. **CSRF for cookie writes.** Every unsafe request needs the `X-LAI-Game-CSRF` header, an HMAC
   of the session derived with `SECRET_KEY`. Same-origin script reads it from
   `GET /api/v1/game-session/`, and there is no CORS. When the browser sends an `Origin`, it must
   be the API's own origin or one listed in `LAI_GAME_ALLOWED_ORIGINS`.
7. **Logout.** The game runtime calls `POST /api/v1/game-session/end/`. Native sign-out calls
   `POST /api/v1/game-launches/revoke/`, which ends every game session and voids unused tickets.
   Both responses clear the cookie, and the native app also clears the WebView cookie store.
8. **Server authority is unchanged.** The game runtime calls the existing play API. Answers are
   graded on the server, request bodies are closed, and nothing from the WebView can grant
   rewards, pick another child, or change privileges.

**Consequences.** This adds the first cookie credential the API accepts, limited by the rules
above. Django serves no game bundle. The standalone `/game/` entry point is a frontend
deliverable that does not exist yet, so `LAI_GAME_ENTRY_URL` names where it will be. Children
created through these routes live in Django's PostgreSQL. The deployed React app still keeps
children in Amplify until the Phase 11 data migration, so the web and Android apps do not share
child records yet (ADR-019 gates). Launch routes are throttled (`LAI_GAME_LAUNCH_RATE`, default
30 a minute per account).

## ADR-037: The Django backend is released to one EC2 instance per environment from GitHub Actions through ECR and SSM, with GitHub OIDC and no stored AWS keys

Status: Accepted 2026-10-30, directed by the owner ("Automated GitHub to AWS EC2 Deployment").
Implemented in the repository on `feature/aws-ec2-auto-deployment`; **nothing is provisioned**.
Creating the stacks, the first release and every production release are owner-approved steps
(ADR-019 gates G1 account and region, G7 cost; production data still waits for G8 to G10).
Runbook: `docs/platform/DJANGO_EC2_DEPLOYMENT.md`.

**Context.** Django had a production image (ADR-034) and production settings but no host and no
release path. LAI-1003 (ECR and image build), LAI-1004 (dev EC2 and Docker deploy, with a migrate
step and a tested rollback) and LAI-1006 (monitoring) were open. The owner asked for a merge to
`main` to release Django automatically: test, build, push to ECR, deploy to EC2 through SSM,
migrate safely, verify health, and fail with logs and a reliable rollback. The React app stays on
Amplify Hosting; the asset manager keeps its S3 storage (ADR-035).

**Decision.**
1. **One image, promoted by digest.** GitHub Actions builds `lai/Dockerfile` once per commit of
   `main`, tags it with the full SHA in one account-wide ECR repository (`lai/django`, immutable
   tags, scan on push, lifecycle rules) and deploys the **digest**, never a tag. Dev and prod run
   the same digest. The image carries `org.opencontainers.image.revision` and a
   `release-channel=release` label; the instance refuses an image whose labels do not match the
   requested commit (a local build cannot be released).
2. **The release logic travels with the image.** `scripts/aws/` and `deploy/ec2/` (compose file,
   nginx template) are copied into the image at `/app/deploy`. The SSM deploy document pulls the
   image, copies that bundle out and runs its `deploy-django.sh`, so the instance needs no source
   checkout and every release runs the scripts it was tested with.
3. **SSM Run Command, allowlisted.** Five SSM documents per environment (deploy, rollback,
   status, bootstrap, setup) are the only way in; no inbound SSH. Every parameter has a pattern or
   an allowed-values list, and the GitHub deploy role may send only deploy, rollback and status to
   its own instance. Exit codes separate application failures from SSM transport failures.
4. **GitHub OIDC, two trust subjects.** The image publisher role trusts
   `repo:<owner>/<repo>:ref:refs/heads/main` and can only push to the repository. Each
   environment's deploy role trusts `repo:<owner>/<repo>:environment:django-<env>`. Prod releases
   need the `django-prod` GitHub Environment's reviewers and run on manual dispatch until the
   repository variable `LAI_PROD_AUTO_DEPLOY` is `true`.
5. **Single instance, short interruption.** `t3.medium` (a parameter), Amazon Linux 2023,
   Docker Compose: gunicorn on a private network, nginx on port 8080 for the ALB only, ALB with
   ACM TLS and an HTTP redirect, a WAF rate rule on the admin login. A release replaces the
   containers in place: there is a brief interruption, and no zero-downtime claim is made.
6. **Database.** RDS PostgreSQL 16 in isolated subnets, encrypted, TLS required
   (`rds.force_ssl`, `sslmode=verify-full`), deletion protection, 7 (dev) or 14 (prod) days of
   backups, snapshot on stack deletion. Dev may instead run PostgreSQL in Docker on a retained EBS
   volume. Migrations run once per release with the new image before it starts; prod takes an RDS
   snapshot first when migrations are pending. Destructive operations (remove or rename a field or
   model, raw SQL) are refused unless a person dispatches with `allow_destructive_migrations`.
   Migrations are never reversed automatically: a rollback past applied migrations says so and
   marks the release record `manual_db_review_required`.
7. **Runtime configuration from AWS at release time.** Plain settings are SSM String parameters
   the stack writes; `DJANGO_SECRET_KEY` is a SecureString an operator writes; the database URL is
   built from the RDS-managed Secrets Manager secret. Values reach the container through a 0600
   env file, are never printed, and the settings module cannot be overridden from the store.
8. **Health and records.** `/api/v1/health/` stays the liveness probe; `/api/v1/health/ready/`
   (new) checks the database and pending migrations and is the ALB target check. A release is
   successful only when both pass through nginx with the expected image running; otherwise the
   instance rolls back to the previous healthy release. Every attempt is appended to a release
   history on the instance and mirrored to a versioned SSM parameter.
9. **No CORS.** Django keeps its same-origin design: until LAI-1005 the browser reaches it through
   the Amplify Hosting proxy rewrite of `docs/platform/AMPLIFY_HOSTING.md` section 7; the admin is
   used directly on `api.<domain>`.

**Consequences.** LAI-1003 and the repository side of LAI-1004 and LAI-1006 are done; their
acceptance on AWS is not, because nothing is deployed. The account gains three stacks and three
IAM roles (`docs/IAM_ROLE_AUDIT.md`). Recurring cost for one environment is roughly $90 to $110 a
month before tax and data transfer (runbook, "Cost"), above section 11a's Fargate estimate because
`t3.medium` is larger than a 0.25 vCPU task. Moving production to ECS Fargate (LAI-1007) later reuses the image, ECR,
OIDC, readiness probe and settings; only the release mechanism changes.

## ADR-038: Environment-selectable API authentication: Cognito in AWS, local Django sign-in for development, one Django user and authorization model

Status: Accepted 2026-10-30, directed by the owner (LAI-AUTH-DUAL). Merged to `main` on
2026-10-31 (`beebb6a`) after the full merge gate; Playwright acceptance was not run. Amends ADR-024 Accepted items 1 and 2 for
`AUTH_PROVIDER=django` only, and builds on ADR-034 (Django Admin's own session) without changing
it. Every AWS environment keeps ADR-024 unchanged.

**Context.** Running the React app or Treasure Rush against a local Django needed a Cognito user
pool, AWS credentials and an Amplify sandbox (docs/TREASURE_RUSH_LOCAL_DEV.md), only to obtain a
bearer token Django then verified. ADR-024 item 1 ruled out Django sessions and passwords, and
item 2 required a new security decision for any cookie API credential covering CSRF, cookie scope,
SameSite, HttpOnly, Secure, session lifecycle and deployment topology. This is that decision, for
local development.

**Decision.** Cognito and Django are interchangeable authentication providers for gameplay APIs,
but Django remains the authoritative application user and authorization system. Django Admin
retains Django session authentication independently.

1. **One setting.** `AUTH_PROVIDER` is `cognito` or `django`. Any other value fails at start-up.
   Local settings default to `django` only while `DEBUG` is on; without `DEBUG` it must be named.
   Production settings require `AUTH_PROVIDER=cognito` explicitly and refuse anything else
   whatever `DEBUG` says. The EC2 release fixes it in the compose file and the image (ADR-037), and
   `render-env.sh` refuses it from the parameter store. Test settings run `cognito`.
2. **One provider per process, no fallback.** The default DRF authenticator,
   `ApiAuthentication`, reads `AUTH_PROVIDER` per request and runs exactly one provider:
   `CognitoJWTAuthentication` (unchanged, ADR-024) or `LocalSessionAuthentication`. A credential
   for the other provider is ignored, so a Django session never authenticates the API under
   `cognito`, and a bearer token is not consulted under `django`. The game runtime cookie
   (ADR-036) is unchanged and still listed only by the runtime's own views.
3. **Same user, same rules.** Both providers set `request.user` to a `ParentAccount` (the existing
   `AUTH_USER_MODEL`). No second user model and no identity table: a local parent is a
   `ParentAccount` whose `cognito_sub` is `django-local:<username>` (no Cognito sub can have that
   form, as with the admin-only placeholder of ADR-034). Cognito parents keep their `sub` mapping
   and are never matched by email. No migration. Permissions, child scoping, play, progress,
   inventory and staff rules are the same code in both modes.
4. **Local sign-in.** `GET /api/v1/auth/csrf/`, `POST /api/v1/auth/login/` and
   `POST /api/v1/auth/logout/` exist only under `django` (a 404 otherwise). `GET /api/v1/me/` is
   "who am I" in both modes. Login checks only local parent rows with a usable Django password
   (`LocalParentPasswordBackend`, which also refuses everything unless `AUTH_PROVIDER=django`);
   admin usernames and Cognito parents cannot start a gameplay session, and an admin session does
   not authenticate the API even locally. Local parents are created only by
   `manage.py create_local_parent`, which refuses under `cognito`.
5. **Cookie and CSRF rules (ADR-024 item 2).** Django's own session and CSRF machinery, standard
   password hashing and validators. Cookies stay HttpOnly and SameSite=Lax; under `django` their
   path widens from the admin path to `/` so they reach `/api/`. Login, logout and every unsafe
   API request with a session pass Django's CSRF check (the `X-CSRFToken` header plus the Origin
   check); the token is read from `GET auth/csrf/`, never from a cookie. Login rotates the session
   key and the CSRF token; logout flushes the session. Cookies are not Secure because `runserver`
   is plain HTTP on loopback. Topology: the browser talks to the Vite dev server, which proxies
   `/api` to a loopback Django (TR-D14), so it is same-origin and needs no CORS.
6. **React.** `VITE_AUTH_PROVIDER` (default `cognito`) selects an auth adapter behind the existing
   `AuthProvider`: the Amplify adapter (unchanged behaviour) or the Django adapter (local username
   form, `credentials: 'same-origin'`, CSRF header). `django` needs `VITE_BACKEND=django` and
   `vite dev`; a build with it fails in `vite.config.ts`, so a deployed bundle cannot select it.
   Route guards and permission checks are not duplicated: Django decides every request.
7. **Out of scope.** Child-profile management in React stays on Amplify (LAI-0502 / LAI-0602); in
   Django sign-in mode a developer creates the child with `create_local_parent --child` and opens
   the island route by id. The Android app keeps Cognito (ADR-036); a local-backend variant is
   documented, not built.

**Consequences.** Local development needs no AWS account, Cognito pool or Amplify sandbox.
Production is unchanged: a session cannot authenticate the API there, the local routes do not
exist, and a missing or wrong provider stops the process. The risk is a misconfigured deployment
selecting `django`; it is refused at four points (production settings, image default, compose
file, parameter store). Tests: `apps/users/tests/test_local_auth.py`,
`apps/core/tests/test_settings.py`, `tests/deploy/`, and the React adapter and form tests.

## ADR-039: Django is the authority for parent and child profiles in every build with the Django API; Amplify profiles only until the controlled import and cutover; read-only audited Django Admin inspection

Status: Accepted 2026-10-31, directed by the owner (LAI-CHILD-001). Implemented on
`feature/lai-child-django`; not merged, nothing deployed, no production data moved. Amends ADR-034
and ADR-024 A4 for one thing only: read-only, permission-gated, audited inspection of parent and
child profiles in Django Admin.

**Principle.** Authentication identifies the parent; Django authorizes access to parent and child
resources and owns the associated application data. Which sign-in a build uses (Cognito or a
local Django session, ADR-038) never decides where profiles are stored.

**Context.** Django already held `ParentAccount` and `ChildProfile` with ownership enforced by the
foreign key and the LAI-0403 harness, and served list, create, read and update (LAI-ANDROID-API-001).
The React app still read and wrote profiles through Amplify Data, so a Django build had two
sources for the same child, and local sign-in could not manage children at all.

**Decision.**
1. In every React build with the Django API (`VITE_BACKEND=django`) all parent and child profile
   reads and writes go to Django: `GET/PATCH /api/v1/me/` and `/api/v1/children/`. Screens use
   hand-owned shapes (`react/src/features/child-profile/profileTypes.ts`), never a backend record
   type.
2. A build without the Django API (the deployed build today) keeps using Amplify Data for
   profiles, because that is where its families' records are. Removing that branch now would
   leave production parents with no children. The branch is selected by backend, never by
   sign-in, and is removed by LAI-1301 after the import and cutover (Phase 11/12, approval tasks).
3. Existing Amplify profiles move only through `manage.py import_amplify_profiles`: dry run by
   default, owner resolved from the Cognito `sub` Amplify recorded (never an email), Amplify ids
   preserved, nothing overwritten, conflicts reported, idempotent, ids-only report
   (docs/platform/AMPLIFY_PROFILE_IMPORT.md).
4. Archival, not deletion: a parent deactivates a child (`active: false`), which keeps the
   profile, progress and rewards. Hard deletion of a child or account stays
   `403 sensitive_action_unavailable` until LAI-0209 (ADR-024 A3) and LAI-0602.
5. Django Admin may show parent accounts and child profiles read-only to active staff holding
   `users.view_childprofile` (superusers hold it). Nothing can be added, changed or deleted there.
   Shown: ids, the parent-child link, age band, reading mode, session length, the active and AI
   switches, whether a photo exists, timestamps. Never shown: nicknames, interests, the photo
   path, the Cognito sub or local username, password hashes. Every list and detail view logs one
   `lai.admin_audit` line with the staff and record ids. Child-owned gameplay records stay off the
   admin.
6. Profile photos stay in Amplify Storage. A Django build neither uploads nor shows them until
   LAI-1103 moves the objects.

**Consequences.** One source of truth per build. Treasure Rush and the other Django routes see the
same child ids the parent dashboard shows. Amplify-backed features that still read a child from
DynamoDB (the `submit-adventure-answer`, `get-next-learning-activity` and `claim-coop-slot`
Lambdas, and Amplify Data reads keyed by `childProfileId`) do not know a child created in Django;
those features are Phase 6 work and are not usable for such a child in a Django build. The admin
change widens who can see child metadata, so the permission is granted to named staff only and
every read is logged.

