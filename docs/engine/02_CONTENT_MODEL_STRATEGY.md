# 02 — Content Model Strategy

## Do Not Immediately Move Everything Into Amplify Data

The current application intentionally keeps canonical playable definitions in source control while using Amplify `Island` and `Adventure` as admin catalog overlays.

That design provides:

- deterministic content
- code review
- testable invariants
- safe versioning
- reproducible builds

The new Admin-authoring goal conflicts somewhat with that model.

Resolve it in stages.

## Stage A — Manifest-Driven, Source-Controlled

First make locations and bindings manifest-driven while manifests remain TypeScript/JSON in source.

Goal:

> adding a location no longer requires new runtime architecture.

This isolates the rendering problem before changing persistence.

## Stage B — Serializable Definitions

All new manifest structures must be JSON-serializable.

Do not store:

- functions
- Three.js objects
- React components
- arbitrary executable callbacks

Instead use registered IDs:

```text
interactionType
actionType
extensionId
assetId
npcId
adventureSlug
questId
discoveryId
```

This makes future database authoring possible.

## Stage C — Draft Content Records

After generic runtime parity, introduce database-managed draft definitions if desired.

Recommended new concepts:

```text
LocationDefinition
LocationVersion
AdventureDefinitionVersion
```

Do not overload the existing catalog `Adventure` record with a giant mutable JSON blob without versioning.

## Stage D — Publish Snapshot

Admin edits a draft.

Publishing creates an immutable version/snapshot.

Player runtime reads the published version.

Existing sessions retain their content/adventure version.

## Existing Adventure Definitions

`src/features/adventures/content/` is mature and tested.

Do not migrate all Adventure steps into DynamoDB during the first rendering refactor.

First support references such as:

```text
adventureSlug: "the-storykeepers-tale"
```

Later, Admin-managed Adventure definitions can be introduced behind the same loader interface.

## Existing World Packs

Keep `WorldContentPack`.

Extend it if necessary to include a location-manifest identifier/version, but preserve:

- exhaustive ownership
- one-world ownership
- validation tests

## Canonical Loader Boundary

Introduce loader interfaces so storage can change later:

```ts
interface LocationDefinitionRepository {
  getPublished(slug: string): Promise<ThreeLocationManifest>;
}

interface AdventureDefinitionRepository {
  getPublished(slug: string): Promise<AdventureDefinition>;
}
```

Initial repository may read source-controlled registries.

Future repository may read Amplify Data.

The runtime should not care.
