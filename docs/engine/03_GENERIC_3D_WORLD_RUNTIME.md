# 03 — Generic Three.js World Runtime

## Highest-Priority Refactor

This is the center of the rebuild.

## Existing Code to Reuse

Start from shared code already under:

```text
src/features/island-map/three/
```

Especially inspect/reuse:

```text
ThreeGameContainer.tsx
WorldHud.tsx
worldEngineEvents.ts
assets/
npcApproachBridge.ts
worldActionBridge.ts
```

Do not create an unrelated second Three.js stack.

## Step 1 — Extract Common Region Contracts

Compare current:

```text
*Region.ts
*Scene.ts
*WorldView.tsx
```

Identify repeated concepts:

- bounds
- spawn
- collision rectangles
- paths
- zones
- entity spots
- NPC spots
- checkpoints
- exits
- lighting
- scene floor/terrain
- decor placement
- focus labels
- interaction handling

Create shared serializable types.

## Step 2 — Generic Manifest Renderer

Create a shared runtime such as:

```text
src/features/island-map/three/runtime/
  types.ts
  manifestRegistry.ts
  ThreeLocationRuntime.ts
  buildEnvironment.ts
  spawnPlacements.ts
  bindInteractions.ts
  bindZones.ts
  bindCheckpoints.ts
  extensionRegistry.ts
```

Names may differ.

## Step 3 — Generic React World View

Replace repeated WorldView orchestration with one component:

```tsx
<ThreeLocationWorldView
  childId={childId}
  locationSlug={locationSlug}
/>
```

It should resolve:

- child avatar
- world state
- manifest
- NPC interactions
- quest/adventure hooks
- checkpoint persistence

without a location-name branch.

## Step 4 — Generic Route

Prefer an existing generic location route if it can be adapted.

Target concept:

```text
/island/:childId/location/:locationSlug
```

One route should render any supported Three.js location.

Keep compatibility redirects for old URLs during migration.

## Step 5 — Scene Primitives

Convert common hand-authored scene patterns into manifest primitives:

```text
GROUND
BOX
WALL
PATH
WATER
MODEL
LIGHT
PARTICLE
BILLBOARD
TRIGGER_ZONE
COLLIDER
```

Do not force every artistic structure into generic primitives if a GLB environment/model is more appropriate.

## Step 6 — Asset Placement

Manifest placement:

```json
{
  "id": "harbor-crate-1",
  "assetId": "crate-small",
  "position": [4, 0, -2],
  "rotation": [0, 1.57, 0],
  "scale": [1, 1, 1],
  "collision": "BOX"
}
```

Use current asset resolver/manifest conventions.

## Step 7 — Interaction Bindings

Generic interaction:

```json
{
  "entityId": "pirate-pip",
  "interaction": "TALK_TO_NPC",
  "targetId": "pirate-pip"
}
```

or:

```json
{
  "entityId": "glowing-moss",
  "interaction": "DISCOVERY",
  "targetId": "wonderwild-glow-moss"
}
```

The renderer emits semantic events. Existing domain engines handle meaning.

## Step 8 — Custom Extensions

Move unavoidable special code behind extension IDs.

Example:

```text
extensionId: "castle-pattern-lock"
```

Registry:

```ts
registerWorldExtension('castle-pattern-lock', createCastlePatternLockExtension);
```

Do not import castle code into the generic runtime.

## Step 9 — Disposal

The generic runtime must centrally dispose:

- animation frame loop
- Three renderer
- geometries/materials when owned
- event listeners
- audio
- controls
- observers
- extension cleanup

Add repeated mount/unmount tests.

## Entry requirements (`entryRequirements`)

*Decision note (owner approved, SC-final-B; added by SC-R10-01).* A location manifest may carry an
optional door. This is the schema, validation and semantics, so a second region that wants one
does not have to rediscover them.

### Schema

```ts
interface ThreeLocationManifest {
  // ...
  /** While these do not hold, the view shows `copy.locked` and never builds the engine. */
  entryRequirements?: readonly WorldRequirement[];
}
interface LocationCopy {
  /** Shown instead of the scene while `entryRequirements` do not hold. Readable aloud, never a refusal. */
  locked?: string;
}
```

`WorldRequirement` is the same closed union every interaction, prop, collider and scenery piece
already uses (`ALWAYS`, `WORLD_CHANGE_PRESENT`, `WORLD_CHANGE_ABSENT`, `ITEM_OWNED`, `ITEM_ABSENT`,
`DISCOVERY_PRESENT`, `DISCOVERY_ABSENT`). There is no second expression language.

### Validation (`validateLocationManifest.ts`)

Each entry goes through the same `checkRequirement` as every other requirement list, with the path
`entryRequirements[i]`. An unknown item id or discovery id is reported (`UNKNOWN_ITEM`,
`UNKNOWN_DISCOVERY`). World-change keys are free strings (no registry yet), so only their shape is
checked. Tests: `runtime/validateEntryRequirements.test.ts`.

### Semantics

- **Optional; absent means open.** An empty list is also open. No shipped manifest has to carry one.
- **AND.** Every requirement in the list must hold. There is no OR; a region that wants "either of
  two keys" authors a world change that either one writes.
- **Evaluated against the snapshot context**, the same `WorldInteractionContext` (world changes,
  owned items, discoveries) the view reads once up front and refreshes after a change. It is not a
  second read and is not cached longer than the snapshot.
- **Fails closed.** A failed progress read leaves the snapshot with no keys, so a gated place stays
  shut and shows `copy.locked` (or a calm default). It never opens because a read failed.
- **The engine is never built while shut.** `ThreeLocationWorldView` returns before
  `createLocationEngine`, so a locked region loads no scene, assets or audio.
- **A door, not a rule engine.** It decides only whether a child may be in the place. Entry from a
  neighbouring place (a castle door, a location card) keeps its own requirements, and the server
  decides what a Place's card shows (`place_unlocked`, from the Location's `unlockRequirement`).
  The client and server must agree: change them together.

### Backward compatibility

The field and `copy.locked` are additive and optional, the manifest `schemaVersion` did not change,
and a manifest without them behaves exactly as before. Tests: `ThreeLocationWorldView.test.tsx`
("entryRequirements").

### Current use

None. The Writing Room was the first user (SC-R10-01, gated on `THE_CASTLES_SECRET_DOOR_COMPLETE`).
SC-final-B removed that gate because the Secret Door arc has an arithmetic step (chapter 1,
`number-input`), and the room is a writing space for every child. The mechanism stays, tested,
for the next region that has a reason to be closed that is not arithmetic.
