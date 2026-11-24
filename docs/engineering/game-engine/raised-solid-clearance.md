# GE-L16: raised Solid collision and walkable clearance

Status: owner-approved 2026-11-22 (Trello #245, linked to #244, GE-002..GE-007 and GE-090);
**merged to `main` in PR #59 (`4b949994`)** and verified on `main` `f0de1087` (2026-11-24);
not yet owner-accepted. Built on branch `feature/ge-raised-solid-clearance` from `origin/main` @
`92e55903`. Shared engine feature: no realm-specific code. Deployed profiles: no environment with
a database exists yet; `manage.py collision_clearance_audit` is a read-only step in LAI 05's
first-DEV-deployment plan (section 4 says what it reports).

## 1. Audit (Phase A)

### How collision works today

| Question | Answer (file) |
|---|---|
| How Solid parts are represented | Axis-aligned `Box3` in the controller's live `colliders` list, not in `jumpableColliders` (`game/src/movement/firstPersonController.ts`). |
| How a Solid box blocks | `blockedAt` tests a non-jumpable box **only if it contains y 0** (`box.min.y > 0 \|\| box.max.y < 0` is skipped). Such a box blocks the footprint at every height. A raised Solid box is ignored entirely. |
| How Jumpable boxes block | Only where they overlap the body (`feet + stepHeight` to `feet + bodyHeight`); their tops are landing surfaces (`supportHeight`), their undersides stop a rising head (`ceilingHeight`). |
| How Automatic geometry is generated | Django `collision.runtime_collision` resolves `AUTO` per profile: union height up to 1.2 m is `JUMPABLE`, above is `SOLID`. The client's built-in footprints (`derivedColliders.ts`, no profile) are `AUTO` per box with the same 1.2 m rule. |
| How vertical positions are interpreted | Profile boxes are model space (`y` is the bottom); `derivedColliders.placedBoxes` applies the placement transform (prop `elevation`, scenery `position.y`, scale). |
| How walkable surfaces are detected | Only Jumpable boxes and the ground (`groundHeightAt`, flat 0 by default) support the feet. `WALKABLE` profiles produce no box and keep other derived boxes off them. |
| How jumping and landing resolve | `stepVertical`: gravity, head bump on a Jumpable underside, landing on the highest support at or below the feet (plus a step). Horizontal blocking during the jump uses the same `blockedAt`. |
| Third-person camera | `colliderObstruction` raycasts the same live `Box3` list at their real extents (boundary walls excepted). It never moves the player; the avatar copies the controller. |
| Multi-part profiles | `COMPOUND` (up to 32 boxes) arrives through the asset resolver; `applyCollisionProfiles` re-derives the boxes per placement. All parts share one behaviour. |

### Root cause

The controller has only two collider kinds: a ground-level **column** (Solid) and a
**height-aware, standable** box (Jumpable). A raised Solid part fits neither: as a column it would
close the space under a lintel, and as a plain Solid it is ignored (it does not contain y 0). So
`derivedColliders.ts` marked **every raised part** (`box.minY > 0`) as jumpable to keep its
height. That made it standable, let a jump carry the child over it, and fired for any offset, even
1 cm (a fence model sitting slightly above its pivot). The engine path (`aabbProvider`,
`standardEngine`, engine-bridge `SOLID` specs) has the mirror bug: a `SOLID` collider whose bottom
is above 0 does not block at all.

### Content audit (repository)

Run on `92e55903` over every source location manifest through `solidColliders` (authored, building
walls and derived boxes) and over the Django region snapshots (`lai/apps/regions/*.json`: Treasure
Cove, North Pole, Firepeak Heart, Pirate's Leap course and bridge). Region-play props and engine
doors were read from their builders.

| Realm / source | Raised Solid colliders | Raised parts made jumpable only by elevation | Change in gameplay |
|---|---|---|---|
| Treasure Rush (Treasure Cove layout, 176 colliders, region-play props) | None (no `minY` above 0; props start at 0 or -1) | None | None |
| Storykeeper's Castle (castle rooms, writing room, castle platforms) | None (`minY` values found are mural and mote bounds, not colliders) | None | None |
| Firepeak (Heart scene, 114 colliders) | None (`minY` 0) | None | None |
| North Pole (scene and layout, 484 colliders) | None (`minY` 0 or absent) | None | None |
| Pirate's Leap course and bridge | No colliders in the snapshots (platforms are Jumpable) | None | None |
| Wonderwild Forest | None authored | `derived:chatty-perched`: Chatty on the perch, character footprint 1.6 m tall at elevation 0.55 m (box 0.55 to 2.15 m) | Becomes a Solid column (gap 0.55 m is below 1.7 m). The child could not walk under it before (the body overlapped it) and could not reach its 2.15 m top. Only the camera box now reaches the ground under the perch. No route changes. |
| Engine doors (`game/src/components/doors.ts`) | Gate boxes start at the door's position (0 in every shipped Area) | None | None; a door on a raised floor would now block (it did not before). |

Seeded collision profiles: the repository seeds only two pack profiles (`model_packs.py`: one
upright `CYLINDER` `SOLID` from the model's measured bottom, one `NONE`). The North Pole catalogue
(`north_pole_assets.py`) lists the profiles staff are to enter (`BUILDING` compound walls from 0,
`NPC_BODY` capsules, `PLATFORM` `JUMPABLE`); none has a raised Solid part.

**Published profiles in a deployed database cannot be read from this session** (no live AWS). Run
the read-only audit command (section 4) there; it lists every Solid part that is raised, with its
classification under the new rule.

Verdict: no gameplay-blocking defect in shipped content; priority stays P2.

## 2. Design (Phase B)

### The rule

A non-jumpable (Solid) box is classified by the clearance under it, measured from the highest
ground under its footprint (`groundHeightAt` at its centre and corners; flat 0 by default):

| Class | Condition | Behaviour |
|---|---|---|
| Below ground | top below the ground | Ignored (as before). |
| Column | gap under it `< bodyHeight + clearanceMargin` (includes every ground-level box) | Blocks the footprint at every height (as before for ground boxes; new for low raised boxes). |
| Overhead | gap under it `>= bodyHeight + clearanceMargin` | Blocks the body wherever the body reaches its underside or above (from its bottom up, at every height above it); the space under it stays open; a rising head stops at its underside. Never a standing surface. |

- **Required clearance** = the controller's `bodyHeight` (the avatar's collision height, 1.7 m for
  the standard avatar, `DEFAULT_BODY_HEIGHT`) plus `movement.collision.clearanceMargin` (default 0,
  0 to 0.5 m). Validation against the drawn avatars: the placeholder explorer is 1.39 m
  (`PLACEHOLDER_HEIGHT`) and published characters are scaled to about 1.35 m, so the 1.7 m collider
  already keeps 0.3 m or more between a drawn head and an overhead underside. 1.7 m is not
  repeated in code: it is `DEFAULT_BODY_HEIGHT`, and Django's admin copy names the same default.
- **Width, position and neighbours** are the runtime's job, unchanged: the body is a cylinder of
  `radius + skin`, so two pillars closer than its width still block, and every other part (a
  pillar under an arch, a wall beside a lintel) blocks on its own.
- **Overhead blocks upward without limit**, exactly as a ground Solid already does. Nobody can get
  above it, so nobody can land on it or fall into it, and no jump carries a child over it
  (jumping standard: walls and gates are never jumped).
- **Jumpable is behaviour only.** A part is jumpable when its behaviour is `JUMPABLE`, or
  `AUTO` and no taller than 1.2 m (the client's per-box rule; Django's per-profile rule). Elevation
  never makes a part jumpable. Landing stays the controller's: a top is landed on only when the
  feet physically came down onto it (reachable by the jump), only from above (a rising head stops
  at an underside), never inside another part (horizontal blocking runs during the jump).
- **Automatic taller than 1.2 m** is Solid, so it gets the same clearance evaluation; height alone
  never opens a passage.

### Where it lives

One place: `FirstPersonController.blockedAt` and `ceilingHeight`, with the pure classifier
`classifySolidBox` / `requiredClearance` in `game/src/movement/clearance.ts` (exported through
`@lai/game-engine/movement`). Every host uses that controller: the live location runtime
(`createLocationEngine`), the engine's `standardEngine`, and the engine bridge's host colliders. No
second collision system, no new collider set, no realm code. `derivedColliders.ts` stops forcing
raised parts to jumpable and leaves raised Solid boxes at their authored height (ground-level
boxes keep their -1 bottom, as before).

The classification is cached per box and recomputed when the box moves, so a terrain
`groundHeightAt` is sampled five times per box change, not per collision test.

### Compatibility

- Ground-level Solid and every Jumpable box behave exactly as before.
- Changed on purpose: a raised Solid box now blocks (column or overhead) instead of being ignored
  (engine path) or jumpable (derived path).
- No published profile is rewritten. A staff profile that relied on standing on a raised Solid part
  (a deck marked Solid) needs `JUMPABLE` for that part's profile; the audit command lists every
  raised Solid part so staff can check.
- `movement.collision.clearanceMargin` is additive and optional.

## 3. Tests (Phase D)

- `game/src/movement/clearance.test.ts`: the classifier (sufficient and insufficient clearance,
  margin boundaries, avatar heights, terrain under the box, holes, below-ground boxes).
- `game/src/movement/firstPersonController.clearance.test.ts`: walking under an overhead part,
  being blocked by a low one, different avatar heights and margins, narrow passages between
  pillars, overlapping parts, approach from four directions, head bump, jumping onto a reachable
  Jumpable platform, failing to reach a high one, landing on an elevated surface, never standing
  on an overhead part.
- `react/.../runtime/derivedColliders.test.ts`: raised Solid keeps its height and is not jumpable;
  low raised Solid is a column on the controller; Automatic below and above 1.2 m; raised
  Automatic; compound profiles with mixed parts; invalid metadata unchanged (parser tests).
- `game/src/stabilization/raisedSolid.test.ts`: the standard engine path (raised `SOLID` specs were ignored before); camera aim and avatar stay on the controller when it is blocked.
- Django: `collision.solid_clearance` classification and the audit command.

## 4. Operator audit of published profiles

`python manage.py collision_clearance_audit` (read-only): prints every collision profile with a
Solid part whose bottom is above 0 in model space, with the gap, and whether the new rule makes it
an overhead passage or a column. A placement's elevation adds to the gap; the command reports model
space and says so.
