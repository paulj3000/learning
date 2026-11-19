# Platforms, checkpoints and safe recovery (LAI-JMP-02, LAI-JMP-04)

Status: development complete on `feature/interactive-platforms` (2026-11-14), unit- and
engine-tested; owner QA pending. Decision: ADR-059. Builds on jumping (ADR-055), the third-person
camera and avatar (ADR-056, ADR-057), running and sprinting (ADR-058), the shared derived colliders
and Asset Manager collision profiles.

## Architecture

```text
manifest.platforming  (TypeScript manifest, or Django scene.platforming + scene.platformTuning)
  -> validateLocationManifest (platformSpec.ts validatePlatforming)
  -> PlatformSystem (platforms/platformSystem.ts)          every frame, before the child moves:
       triggers -> motion (platformMotion.ts, yields to the child) -> box moved in place
       -> carry the rider -> bounce -> checkpoints, hazards, goals -> events
  -> FirstPersonController (unchanged authority): carry, inheritVelocity, launch, recover
  -> PlatformPresentation (meshes only) + WorldEngineEventBus -> Sound Manager cues, HUD toasts
```

- **One movement controller.** A platform is a jumpable box in the controller's own collider list,
  so standing on it, bumping its sides, jumping from it and landing on it all use the existing
  physics. No second physics engine.
- **Collision always matches the drawing:** the box is moved in place every frame; a vanished
  platform's box is emptied, so no invisible collider is ever left behind.
- **Platforms yield.** A platform never moves or reappears into a child's body; it waits. A lift
  never squeezes its rider into anything above. Riders are carried with collision tests, so a
  platform cannot push a child through a wall. Locked gates and authored colliders stay
  authoritative because they are ordinary solid boxes the carried child still collides with.
- **Deterministic:** the same time steps give the same motion on every device and in tests.
- **No per-location code.** Any manifest-driven Three.js location can add a course.

## Platform types

| Type | How | Notes |
|---|---|---|
| Static (wood, stone, terrain, stepping stones, floating) | `size` + `position` | Any height; floating is just a higher `position.y`. |
| Horizontal / vertical / waypoint | `motion.path` (offsets), `speed`, `pauseSeconds`, `mode` | `PING_PONG` (default), `LOOP`, `ONCE`. |
| Pressure-plate | `activation: { trigger: "PLATE", source }` | While stood on, or latched. |
| Switch | `activation: { trigger: "SWITCH", source: <prop entityId> }` | An existing interactive prop toggles it. |
| Zone | `activation: { trigger: "ZONE", source: <zone id> }` | While the child is in the zone. |
| Educational challenge / game signal | `activation: { trigger: "SIGNAL", source }` | React calls `engine.signalPlatforms(name)` when a challenge is solved. |
| Persistent unlock | `activation: { trigger: "WORLD_STATE", requirements }` | Django world changes, read on entry. |
| Appearing bridge | `activation.hiddenUntilActive: true` | Not drawn or solid until activated. |
| Disappearing | `vanish: { mode: "TIMED" or "STAND", visibleSeconds, hiddenSeconds, warningSeconds }` | Blinks (dims under reduced motion) before vanishing. |
| Bounce | `bounce: { height }` | Uses the jump's gravity and air control. |
| Turntable | `spin: { degreesPerSecond }` (max 45) | Carries the rider round; collision is the platform's square (round models approximate it). |
| Delay and reset | `activation.delaySeconds`, `activation.reset: "STAY" or "RETURN"` | |

Not implemented, because they need a real physics dependency the project has not approved:
tilting or seesaw platforms, rotating platforms with rotated collision, rolling objects, ropes.

## Configuration reference

`manifest.platforming` (TypeScript) or `scene.platforming` (Django 3D Area, seed-authored):

```json
{
  "platforms": [ /* PlatformSpec */ ],
  "pressurePlates": [ { "id": "plate", "position": { "x": 0, "z": 0 }, "halfSize": 0.6, "latch": false } ],
  "checkpoints": [ { "id": "dock", "x": 0, "z": 0, "yaw": 3.14, "label": "the old dock" } ],
  "hazards": [ { "id": "water", "rect": { "id": "water", "minX": 2, "maxX": 8, "minZ": -2, "maxZ": 2 } } ],
  "goals": [ { "id": "end", "rect": { "id": "end", "minX": 10, "maxX": 12, "minZ": -1, "maxZ": 1 } } ]
}
```

`PlatformSpec` fields: `id`, `size {width, height, depth}` (metres; width and depth at least
0.8), `position {x, y, z}` (bottom centre), optional `assetId` (published or bundled model, fitted
to the size), `color`, `rotationY` (visual), `motion`, `spin`, `bounce`, `vanish`, `activation`,
`sounds {activated, moving, stopped, bounce}` (Sound Manager cue ids), `indicator` (destination
ring, default on for moving platforms).

Limits (forgiving by design, ages 3 to 8): tops at least 0.8 m; speed 0.2 to 4 m/s; pauses up to
10 s; vanish visible at least 1.5 s; bounce 0.5 to 4 m; turntables at most 45 degrees per second;
at most 64 platforms. Reduced motion slows platforms and turntables to 60%.

### Examples

Static crate step:

```json
{ "id": "crate-step", "size": { "width": 1.2, "height": 0.6, "depth": 1.2 }, "position": { "x": 3, "y": 0, "z": 2 }, "assetId": "crate" }
```

Horizontal moving dock:

```json
{ "id": "moving-dock", "size": { "width": 2.4, "height": 0.4, "depth": 2.4 }, "position": { "x": 0, "y": 0.2, "z": 10 },
  "motion": { "path": [ { "x": 6, "y": 0, "z": 0 } ], "speed": 1.2, "pauseSeconds": 2.5 } }
```

Vertical lift:

```json
{ "id": "pirate-lift", "size": { "width": 2.4, "height": 0.4, "depth": 2.4 }, "position": { "x": -8, "y": 0, "z": 12 },
  "motion": { "path": [ { "x": 0, "y": 3, "z": 0 } ], "speed": 0.9, "pauseSeconds": 3 } }
```

Pressure-plate platform (returns when the plate is released):

```json
{ "id": "plate-bridge", "size": { "width": 2, "height": 0.3, "depth": 3 }, "position": { "x": 5, "y": 0, "z": 0 },
  "motion": { "path": [ { "x": 0, "y": 0, "z": 4 } ], "speed": 1, "mode": "ONCE" },
  "activation": { "trigger": "PLATE", "source": "gate-plate", "reset": "RETURN" } }
```

Disappearing platform:

```json
{ "id": "sinking-barrel", "size": { "width": 1.4, "height": 0.9, "depth": 1.4 }, "position": { "x": 2, "y": 0, "z": 6 },
  "vanish": { "mode": "STAND", "visibleSeconds": 3, "hiddenSeconds": 2.5, "warningSeconds": 1 } }
```

Bounce platform:

```json
{ "id": "bounce-drum", "size": { "width": 1.6, "height": 0.4, "depth": 1.6 }, "position": { "x": 0, "y": 0, "z": 4 },
  "bounce": { "height": 2.5 } }
```

## Django Admin authoring

- **Layout (positions, paths, checkpoints, hazards, goals)** is seed-authored: Treasure Cove's in
  `lai/apps/regions/treasure_cove_layout.py`, written to `WorldRegion.scene["platforming"]` by
  `manage.py seed_treasure_rush` (ADR-033). Django Admin does not move platforms until LAI-0805 is
  decided. `apps/regions/platforming.py` checks the layout (`layout_problems`).
- **Tuning is staff-authored in Django Admin, no code change:** Regions > 3D Areas > the Area >
  **Edit content**. An Area with platforms shows a `platformTuning` block, keyed by platform id:

  ```json
  { "moving-dock": { "speed": 1.0, "pauseSeconds": 3 }, "bounce-drum": { "bounceHeight": 2 }, "sinking-barrel": { "enabled": false } }
  ```

  Keys: `enabled`, `speed`, `pauseSeconds`, `bounceHeight`, `visibleSeconds`, `hiddenSeconds`.
  Publishing validates them against the Area's platforms and the same limits as the client
  (`tuning_problems`); invalid tuning is refused, and the client ignores anything invalid
  regardless. Children see changes on their next visit.

## Checkpoints and recovery

- Course checkpoints (`platforming.checkpoints`) are reached by standing in them; the latest one
  reached this visit is where a child goes back to. They are validated to be inside the Area, not
  inside an obstacle, and never on a platform that moves, spins, vanishes, bounces or appears later.
- Hazards (water under a missed jump) send a child back to the latest checkpoint (else to the last
  safe ground). Falling out of the world does the same. Moving or vanishing platforms are never
  remembered as safe ground.
- No lives, no game over, no timer. Collected items, quest progress and rewards are server state
  and are never touched by a recovery; rewards stay idempotent on the server.
- Feedback (`platforms/platformCopy.ts`): "Safe spot: the old dock. If you slip, you will come back
  here." and "Splash! Back to the old dock. Have another go!"

## Sound Manager cues

Events on the world engine bus, played by logical cue id (optional catalogue entries, `wired=False`;
missing audio is silent and never blocks play). A platform may name its own cues in `sounds`.

| Event | Default cue |
|---|---|
| `PlatformActivated` | `sfx.platform.activate` |
| `PlatformMoving` | `sfx.platform.move` |
| `PlatformStopped` | `sfx.platform.stop` |
| `PressurePlatePressed` | `sfx.platform.plate` |
| `PlayerBounced` | `sfx.platform.bounce` |
| `CourseCheckpointReached` | `sfx.platform.checkpoint` |
| `PlayerRecovered` | `sfx.player.recover` |
| `PlatformGoalReached` | `sfx.platform.goal` |

## Accessibility

Forgiving widths (0.8 m minimum), predictable speeds and pauses, destination rings, checkpoint
flags, blink warnings before vanishing (a steady dim under reduced motion), reduced-motion slow-down,
non-punitive retries, adjustable speeds per Area through tuning, and running/sprinting settings
from ADR-058. Adventures must give an alternative route for required progress (Pirate's Leap does).

## Testing

```bash
cd react && npx vitest run --maxWorkers=2 src/features/island-map/three/platforms src/features/island-map/three/runtime/platforms.engine.test.ts
```

```bash
LAI_REQUIRE_POSTGRES=1 .venv/bin/python -m pytest -q lai/apps/regions/tests/test_platforming.py
```

Covered: waypoint interpolation, ping-pong, loop, once, return, determinism across frame rates;
carrying sideways and vertically; jumping off (keeping the platform's speed) and landing on; walking
off; yielding to a child in the way; lift head clearance; reduced motion; plates, switches, signals,
zones, delays, reset; appearing bridges; vanishing (no collision while gone, never back inside the
child); bounce height; checkpoints, hazards, safe ground, goals; validation and tuning in both
TypeScript and Django; the engine: drawing, signals, events and recovery.
