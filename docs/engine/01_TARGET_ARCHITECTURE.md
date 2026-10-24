# 01 — Target Architecture

## Preserve the Existing Layering

The project documentation already establishes:

```text
World Engine
    |
Story Engine
    |
Adventure Engine
```

Keep that conceptual layering.

The change is to make the **Three.js World Engine consume a generic location manifest**.

## Target Runtime

```text
Generic Location Route
        |
        v
WorldPlayer / ThreeWorldView
        |
        v
LocationManifestLoader
        |
        +-- location definition
        +-- environment definition
        +-- geometry/terrain
        +-- asset placements
        +-- NPC placements
        +-- zones
        +-- checkpoints
        +-- interactions
        +-- adventure bindings
        +-- discovery bindings
        +-- audio/lighting
        |
        v
Generic Three World Runtime
        |
        +-- existing world event bus
        +-- existing Adventure Engine
        +-- existing Story Engine
        +-- existing Quest Engine
        +-- existing Discovery Engine
        +-- existing NPC conversation
        +-- existing inventory/rewards
```

## New Core Abstraction

Introduce a manifest roughly equivalent to:

```ts
interface ThreeLocationManifest {
  schemaVersion: number;
  slug: string;
  title: string;

  worldSlug: string;

  environment: EnvironmentSpec;
  spawnPoints: SpawnPointSpec[];
  checkpoints: CheckpointSpec[];

  terrain: TerrainSpec;
  structures: PlacementSpec[];
  props: PlacementSpec[];
  npcs: NpcPlacementSpec[];

  zones: ZoneSpec[];
  interactions: InteractionBinding[];
  adventureBindings: AdventureBinding[];
  discoveryBindings: DiscoveryBinding[];

  lighting: LightingSpec;
  audio?: AudioSpec;
  sky?: SkySpec;

  extensions?: ExtensionBinding[];
}
```

Exact naming should fit current code.

## Generic Runtime Responsibilities

The shared runtime owns:

- scene initialization
- camera/player controller
- renderer loop
- asset loading
- placement
- raycast focus
- generic interaction
- NPC approach events
- checkpoint events
- zone enter/exit
- HUD integration
- world-state loading
- world-state persistence
- cleanup/disposal

## Region Manifest Responsibilities

A region manifest owns:

- what exists
- where it exists
- how it looks
- which semantic events it emits
- which existing domain actions it binds to

It must not own:

- renderer lifecycle
- React routing
- Amplify clients
- child identity
- generic quest logic
- generic NPC conversation logic
- generic Adventure Engine transitions

## Escape Hatch

Some worlds will need special mechanics.

Provide a registered extension mechanism:

```ts
interface WorldExtension {
  id: string;
  mount(context: WorldExtensionContext): void | Cleanup;
}
```

Examples:

- castle pattern lock
- custom painting/easel interaction
- dragon flight spectacle
- clockwork machinery puzzle

But:

- extensions must be reusable where reasonable
- extensions must be explicitly declared in the manifest
- the generic runtime must not switch on location slug
- ordinary locations should need zero extensions

## Anti-Pattern

Never evolve the generic runtime into:

```ts
if (slug === 'storykeeper-castle') ...
else if (slug === 'wonderwild-forest') ...
```

Use registries and declarative bindings.
