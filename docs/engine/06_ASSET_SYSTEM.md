# 06 — Asset System

## Preserve Existing Models

The Amplify schema already contains:

```text
Asset
AssetVersion
AssetType
AssetCategory
AssetStatus
AssetSource
```

Do not create a parallel Asset table.

## Extend the Existing Asset Pipeline

The generic world manifest should reference logical asset IDs or stable catalog keys.

Runtime resolution:

```text
manifest asset reference
 -> Asset / AssetVersion
 -> storage key
 -> S3/Amplify Storage URL
 -> Three loader
```

## Existing Three Asset Code

Inspect and reuse:

```text
src/features/island-map/three/assets/
```

including:

- asset loader
- manifest
- scene assets
- GLTF assembler
- animation vocabulary
- imported character/kit handling

Consolidate rather than replace.

## Environment Assets

Allow `AssetType.ENVIRONMENT` to represent larger reusable environment GLBs.

A location may be assembled from:

- one environment GLB
- reusable props
- primitive geometry
- custom extensions

## Character Modularity

Keep support for modular assets such as:

- base model
- skin/material
- hair
- clothing
- headgear
- accessories

Role-driven headgear must remain compatible with:

```text
bishop -> mitre
king -> crown
queen -> tiara
```

## Attachment Metadata

Standardize semantic attachment points:

```text
head
left_hand
right_hand
back
waist
```

Map model-specific bones/nodes to semantic attachment points through metadata.

## Admin Asset Usage

Admin should eventually show where an asset is referenced:

- location manifest
- Adventure
- character/NPC
- environment
- reward/item
- headgear/cosmetic

Block destructive deletion when dependencies exist.

## No Hard-Coded Storage URLs

Search and migrate hard-coded S3/public URLs behind the existing asset resolver where practical.
