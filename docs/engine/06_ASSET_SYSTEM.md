# 06 — Asset System

## Preserve Existing Models

The Django asset library (ADR-035, administered in Django Admin per ADR-045;
`docs/ASSET_LIBRARY.md`) already contains:

```text
catalog.ContentAsset   the asset definition: stable asset_id, kind, category
                       (AssetCategory), status (ACTIVE, RETIRED), origin
                       (EXPORT, DJANGO), default_version, tags
assets.AssetVersion    immutable versions: file format, size, checksum,
                       status (DRAFT, VALIDATED, REJECTED, PUBLISHED, RETIRED)
```

Do not create a parallel Asset table.

## Extend the Existing Asset Pipeline

The generic world manifest should reference logical asset IDs or stable catalog keys.

Runtime resolution:

```text
manifest asset reference (asset id)
 -> Django's read-only, child-scoped resolver (published default version)
 -> signed Django file route (bytes from the private asset bucket)
 -> Three loader
   (falls back to the bundled react/public/models/ file when nothing is published)
```

Staff create, upload, validate, publish, roll back and retire assets in Django
Admin only; there is no React staff asset manager and no administrator asset
API (ADR-045).

## Existing Three Asset Code

Inspect and reuse:

```text
react/src/features/island-map/three/assets/
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

Allow an environment kind or category (today `AssetCategory.SCENERY`) to represent larger reusable environment GLBs.

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
