# Guided movement: Sprouts tap to walk (LAI-2104S, step B1)

- **Status:** Proposed (built on `feature/LAI-2104S-sprouts-guided-move`; not merged, not owner accepted)
- **Owner:** LAI 04 (engine)
- **Last reviewed:** 2026-11-28
- **Related tickets:** LAI-2104S, LAI-2303 (Sprouts playtest, owner), LAI-2203 (Wonderwild Forest WF-10), GE-L14 (terrain `groundHeightAt`), GE-L16 (clearance)
- **Decision:** owner chose option B (2026-11-28), see [phaser-retirement-audit.md](phaser-retirement-audit.md) section 10. B1 (this document) is static colliders, platforms and hazard areas on flat ground. B2 (terrain height) waits for a host `groundHeightAt` (GE-L14).

## What the child sees

A Sprouts child (age band `SPROUT`, whose profile has `guidedSteering: true`) taps the ground or an
object. The avatar walks a path around walls and props. A tap on a spot that cannot be reached
goes to the nearest reachable one. An object tap walks to within 2 m and turns to face it, and the
usual action prompt and Interact button then offer the action. The Jump button still hops in
place. There is no free look: the camera is third person only and turns behind the child as they
walk. The joystick and keyboard still work and cancel or override a tap path. Pathfinders and
Explorers are unchanged.

Sprouts difficulty is unchanged (`game/src/sdk/profiles.ts`): jump routes optional only, no moving
or vanishing platforms, a checkpoint after every jump. Falls use today's recovery.

## Public API

`@lai/game-engine/navigation` (also re-exported from `@lai/game-engine`), in `game/src/navigation/`:

| Piece | File | Purpose |
|---|---|---|
| `buildWalkGrid(input, options?)` | `walkGrid.ts` | the walkable grid and exact point and segment tests |
| `findWalkPath(grid, from, to, { stopWithin?, smooth? })` | `pathSearch.ts` | 8-neighbour A* without corner cutting, then line-of-sight string pulling; nearest-reachable fallback |
| `floodReachable(grid, start)` | `pathSearch.ts` | every cell reachable on walking links |
| `isReachable(source, start, goal, options?)`, `unreachableTargets(input, start, ids?, options?)` | `reachability.ts` | the realm-test helper (below) |
| `GuidedSteering` | `guidedSteering.ts` | turns a path into the `MoveInput` the shared `FirstPersonController` already takes |
| `assistedYaw(yaw, heading, dt, { reducedMotion })` | `guidedCamera.ts` | the assisted camera turn |
| `isGuidedBand(band, overrides?)` | `guidedMode.ts` | selects the mode from the profile's `guidedSteering` |

There is no second character controller: `GuidedSteering` only chooses forward and strafe each
frame, in the controller's own yaw convention. `attachPointerControls` gained three opt-in options
(`freeLook: false`, `onTap`, `shapeInput`); with none set it behaves exactly as before.

### Reachability helper for realm tests

```ts
import { isReachable, unreachableTargets } from '@lai/game-engine/navigation';
import { manifestWalkability, manifestSpawnPoint } from '<island-map>/three/runtime/manifestWalkability';

const input = manifestWalkability(manifestForBand(WONDERWILD_FOREST_MANIFEST, 'SPROUT'));
const start = manifestSpawnPoint(WONDERWILD_FOREST_MANIFEST);
expect(unreachableTargets(input, start, interactionIds)).toEqual([]);   // WF-10
isReachable(input, start, { id: 'wonderwild-beehive' }).reachable;      // by target id
isReachable(input, start, { x: 4, z: -2, approachRange: 2.5 });         // by point
isReachable(input, start, { rect: { minX, maxX, minZ, maxZ } });        // by zone
```

`WalkabilityInput` is `{ colliders, platforms?, hazards?, bounds?, targets? }`: plain data, so an
engine test can build one by hand. A `LocationDefinition` (`sdk/location.ts`) carries capability
requests, not geometry, so the manifest adapter `manifestWalkability(manifest, worldState?)` in
`react/src/features/island-map/three/runtime/manifestWalkability.ts` builds the input from a
manifest (colliders through the same `solidColliders` the live runtime uses, platforming, hazard
areas, and a target for every NPC, prop, collectible and interaction). Pass the child's world
state: a gated collider (the Pirate Bay bridge) is a wall until its requirement holds. The result
is `{ reachable, nearestDistance, nearest }`; an unknown target id throws `UNKNOWN_ID`.
The helper answers on walking links only, so "reachable" means one tap is enough.

`react/src/features/island-map/three/runtime/manifestWalkability.test.ts` runs it on Welcome
Harbor and Wonderwild Forest (all ten forest interactions reachable from the spawn) and on the
Pirate Bay bridge gate.

## The grid

| Parameter | Value | Why |
|---|---|---|
| Cell size | 0.2 m (`NAV_CELL_SIZE`) | keeps a 1 m doorway (the authored minimum) open with a cell of slack |
| Cell budget | 400,000 cells (`NAV_MAX_CELLS`), about 126 x 126 m at 0.2 m | past it the cell size grows (up to 0.5 m, `NAV_MAX_CELL_SIZE`) so a large Area builds fast; larger still throws `VALIDATION_FAILED` |
| Agent radius | 0.35 m (`DEFAULT_PLAYER_COLLISION.radius`) | the controller's footprint |
| Skin | 0.02 m | the controller's skin |
| Wall clearance | 0.02 m (`NAV_WALL_CLEARANCE`) | so a path never grazes a wall |
| Wall margin | 0.39 m | radius + skin + clearance |
| Hazard margin | 0.3 m (`NAV_HAZARD_MARGIN`) | a path stays this far from a hazard area |
| Minimum passable gap | 0.78 m | below `2 x 0.39` a gap is always blocked |
| Guaranteed gap | 0.98 m (`grid.guaranteedGap`, 2 x margin + one cell) | at or above it, a gap is always passable |

A cell is free when its centre passes an exact test, so a gap between 0.78 m and 0.98 m depends
on how it lines up with the grid. Path legs and string pulling use the exact test (sampled every
0.1 m, finer than any obstacle is thick), not the cells, so a smoothed path keeps its margins.

### How things rasterise

- **Colliders.** The controller's own rules decide whether a box blocks a walker, on flat ground
  (ground 0): a Solid box is classified by GE-L16 (`classifySolidBox`): `COLUMN` blocks, an
  `OVERHEAD` lintel (gap at least the 1.7 m body) does not, `BELOW_GROUND` does not. A jumpable box
  blocks only when its top is above one step (0.25 m) and its underside is below the body's top.
  So a 0.2 m kerb is walked over, a 0.6 m crate is avoided: a path never uses a jump. Trigger
  colliders are ignored. A blocking box blocks every point closer than the wall margin to its
  footprint (rounded corners, as the controller measures).
- **Platforms.** A fixed platform (no motion, spin, bounce, vanish or switch; `isFixedPlatform`)
  whose top is within one step is a walkable surface and opens the hazard under it, which is how a
  flat bridge crosses water. Any other platform is never a path: its box only blocks by the
  collider rule. A platform taller than a step blocks.
- **Hazard areas.** A hazard (`platforming.hazards`, feet at or below `belowY`, default 0.05)
  blocks every point within the hazard margin of its rectangle, unless a fixed walkable platform
  covers the point. A hazard whose `belowY` is under the ground cannot catch a walker and is
  ignored. A route never needs a hazard crossing (`hazardsOnRequiredRoutes` is always false).
- **Bounds.** The Area's walkable extent plus its boundary walls; anything outside is not on the
  grid. Without explicit bounds, the extent of every input.

## Steering and camera

`GuidedSteering` follows the smoothed waypoints (reached within 0.12 m; the last within 0.15 m),
eases over the last 0.6 m, pushes at walking pace only (never `analog`, never sprint), and gives
up after 1.5 s without progress. The live glue (`runtime/guidedWalk.ts`) then replans once from
where the child is, and stops if that fails too. Any manual push (joystick, keys, pad) cancels
the path on that frame and passes through unchanged; a panel opening (`resetInput`) cancels it.

The assisted camera (`assistedYaw`): the view turns toward the direction of travel at most 95
degrees a second, smoothly. The tilt stays at the third-person entry angle. Under reduced motion
it never sweeps: it holds, and cuts in one frame only when the heading is more than about 60
degrees off. While the child steers by hand the view does not turn (a camera that follows a
camera-relative joystick would spin); tapping is how a Sprouts child turns.

## Live wiring

`react/src/features/island-map/three/runtime/createLocationEngine.ts` takes a new option
`ageBand`. `ThreeLocationWorldView` passes the child's band. When `isGuidedBand(ageBand)`:

- the pointer controls get `freeLook: false`, `onTap` and `shapeInput`; the camera config is
  third person with `allowModeSwitch: false`;
- a tap casts a ray from the camera: an object (or the ground within 1.2 m of one) walks to 2 m
  of it and faces it, anything else walks to the ground point (flat plane at the child's feet);
- `interactionAssist` is on for the engine and the view, so a walk that ends near a thing shows the
  action prompt and Interact button;
- the engine handle gains `guided` and `walkTo(x, z)` (the accessible equivalent of a tap).

The grid is rebuilt from the live collider list on each tap and replan, so gates that opened and
colliders an extension added count.

## Limits of B1

- **Flat ground.** Heights are measured from ground 0. Terrain height needs `groundHeightAt`
  (GE-L14) and is step B2. A host with real terrain should not turn the mode on until B2.
- **Hazards come from `platforming.hazards`.** Hazard areas an extension owns (for example the
  engine bridge's gameplay hazards) are not on the grid yet; a path may cross one and the child
  uses today's recovery.
- **Moving platforms** are never a path; their current box only blocks.
- **Objects an extension moves** (carried props) are not tracked between taps.
- **Doorways under 0.98 m** are not guaranteed passable; authored doorways are 1 m or wider.
- The reachability helper does not know about gates the host opens later: pass the world state.

## Tests

- `game/src/navigation/navigation.test.ts`: grid from simple colliders; the controller's step,
  jumpable, overhead and trigger rules; a path around an L-shaped wall driven by the real
  controller with no jump; no path through a hazard area and a bridge across one; the nearest
  reachable fallback; an object tap's approach range; a gap narrower than the agent stays blocked
  and a 1 m doorway opens; no jump links; the reachability helper; steering in the controller's
  frame; joystick override; the assisted camera and reduced motion; Sprouts get guided mode and
  other bands do not.
- `react/.../runtime/guidedMove.engine.test.ts`: the same through `createLocationEngine`.
- `react/.../runtime/guidedWalk.test.ts`, `guidedPointerControls.test.ts`,
  `manifestWalkability.test.ts`.
