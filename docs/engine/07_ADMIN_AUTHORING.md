# 07 — Admin Authoring Roadmap

## Existing Admin Must Be Extended

Current source already has:

```text
src/features/admin/
src/features/admin/catalog/
src/routes/AdminIslands.tsx
src/routes/AdminIslandDetail.tsx
src/routes/AdminIslandForm.tsx
src/routes/AdminAdventures.tsx
src/routes/AdminAdventureDetail.tsx
src/routes/AdminAdventureForm.tsx
src/routes/AdminAssets.tsx
src/routes/AdminModelAssets.tsx
src/routes/AdminNewModelAsset.tsx
```

Do not create a second admin app.

## Preserve Authorization Requirements

- Admin navigation visible only when authorized.
- Unauthorized direct admin routes use 404 behavior.
- Backend enforces mutations.
- Superuser retains all required rights.
- Existing Adventure delete behavior/history preservation must remain intact.

## Important Current Limitation

The existing Island/Adventure records are catalog overlays.

Therefore a newly created Adventure catalog row whose slug has no source-controlled template is intentionally not playable.

Do not pretend the current admin already authors executable Adventures.

## Admin Evolution

### Phase A — Catalog + Manifest Association

Add management of:

- location manifest
- environment
- spawn points
- model placements
- NPC placements
- zones
- interaction bindings

while executable Adventures can still reference source-controlled definitions.

### Phase B — Visual Placement Editor

Add a Three.js admin preview/editor:

- load location
- asset browser
- place object
- translate/rotate/scale
- edit collision
- edit semantic entity ID
- assign interaction
- assign NPC
- assign discovery
- assign Adventure entrance
- save draft

### Phase C — Adventure Definition Authoring

Only after the runtime loader boundary is stable, allow Admin to author versioned Adventure definitions.

Reuse the current `AdventureDefinition` vocabulary first.

Do not invent a second quest-like Adventure format.

### Phase D — Quest/Story Authoring

Expose existing content vocabularies progressively.

## Draft and Publish

Admin-authored executable content must support:

```text
DRAFT
PUBLISHED
ARCHIVED
```

Publishing creates an immutable version.

Never mutate a definition underneath an in-progress child session.

## Validation

Before publish validate:

- manifest schema
- unique semantic IDs
- asset references
- spawn point
- collision/zone validity
- NPC references
- Adventure references
- discovery references
- extension IDs
- world pack ownership
- route/location registry
- published dependency availability

## Clone

Support cloning a location/adventure configuration while reusing shared assets.

This is a major expansion accelerator.
