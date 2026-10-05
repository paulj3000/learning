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
