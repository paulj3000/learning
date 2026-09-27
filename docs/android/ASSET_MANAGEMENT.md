# Learning Adventure Island — Model Asset Manager

## Objective

Implement a production-ready **Model Asset Manager** inside the Learning Adventure Island administration system.

The system will allow administrators to upload, validate, organize, preview, publish, replace, and manage 3D model assets used throughout Learning Adventure Island.

The architecture should follow the same basic principle used for Naughty Chess:

> **Large binary assets belong in Amazon S3. The application database stores metadata and references to those assets. Assets should not be committed to the application source repository.**

The system should initially concentrate on `.glb` models used by Three.js, but the underlying asset architecture should be designed so it can later support textures, animations, images, Amazon Polly audio, sound effects, music, and other game assets.

---

# 1. Core Architecture

Implement the following pipeline:

```text
Artist / Blender / AI Model Generator
                │
                ▼
       Admin Asset Manager
                │
        Upload + Validation
                │
                ▼
           Amazon S3
                │
                ▼
       Amplify Data Record
                │
                ▼
        Published Asset
                │
                ▼
       Three.js Game Engine
```

Do NOT build an actual 3D model generator at this stage.

Models will be created externally using Blender, AI modeling tools, artists, or other 3D pipelines.

Learning Adventure Island needs an **asset ingestion and management system**, not a modeling application.

---

# 2. Admin Routes

Create the following administration structure:

```text
/admin
/admin/assets
/admin/assets/models
/admin/assets/models/new
/admin/assets/models/:id
/admin/assets/models/:id/edit
```

Design the architecture so these can later be added:

```text
/admin/assets/textures
/admin/assets/animations
/admin/assets/audio
/admin/assets/images
/admin/assets/environments
```

Do not put the primary model management system underneath `/admin/characters`.

Characters should reference model assets.

---

# 3. Asset vs. Character Separation

Maintain a strict distinction between a **ModelAsset** and a **Character**.

A ModelAsset represents the actual reusable 3D resource.

Example:

```text
ModelAsset
---------
Pirate Captain Male
pirate-captain-v3.glb
```

A character represents something existing in the game world.

Example:

```text
Character
---------
Captain Barnacle

Model:
Pirate Captain Male

Voice:
Amazon Polly Matthew

Region:
Pirate Bay
```

Multiple characters should eventually be capable of referencing the same underlying model.

Never duplicate a GLB simply because multiple characters use it.

---

# 4. Amplify Data Model

Inspect the existing Amplify Gen 2 schema before modifying it.

Reuse existing models/enums where appropriate.

Introduce a generalized asset model if one does not already exist.

Suggested model:

```text
Asset

id
name
slug
description

assetType
category

status

s3Key
bucket
fileName
originalFileName
mimeType
fileSize

version

thumbnailKey

source
sourceNotes

worldId
regionId

metadata

createdBy
createdAt
updatedAt
publishedAt
```

Suggested `assetType` enum:

```text
MODEL_3D
TEXTURE
ANIMATION
AUDIO
IMAGE
ENVIRONMENT
OTHER
```

Suggested model categories:

```text
CHARACTER
NPC
CREATURE
BUILDING
PROP
VEGETATION
VEHICLE
QUEST_ITEM
ENVIRONMENT
DECORATION
OTHER
```

Suggested publication states:

```text
DRAFT
PROCESSING
READY
PUBLISHED
ARCHIVED
ERROR
```

Use the conventions already established by the project's Amplify schema rather than blindly implementing these exact names.

---

# 5. 3D-Specific Metadata

A 3D model should have additional metadata.

Store information such as:

```text
format
triangleCount
vertexCount
meshCount
materialCount
textureCount

hasSkeleton
boneCount

hasAnimations
animationCount

animations[]

boundingBox

dimensions

embeddedTextures

threeJsCompatible

validationStatus
validationMessages[]
```

Example:

```json
{
  "format": "GLB",
  "triangleCount": 18240,
  "meshCount": 4,
  "materialCount": 3,
  "hasSkeleton": true,
  "boneCount": 67,
  "hasAnimations": true,
  "animations": [
    "Idle",
    "Walk",
    "Run",
    "Talk"
  ]
}
```

Do not require every field to be populated manually.

Extract metadata automatically wherever practical.

---

# 6. S3 Storage

Use Amplify Gen 2 Storage/S3.

Do not store GLB files in the repository.

Use an organized key structure.

Recommended starting structure:

```text
assets/
    models/
        characters/
        creatures/
        buildings/
        props/
        vegetation/
        vehicles/
        quest-items/
        environments/

    textures/

    animations/

    audio/
        voices/
        music/
        sfx/

    images/

    thumbnails/
```

Where useful, organize world-specific assets underneath their categories.

Example:

```text
assets/models/environments/storykeeper-castle/
assets/models/environments/wonderwild-forest/
assets/models/environments/clockwork-harbor/
assets/models/environments/dragons-sanctuary/
assets/models/environments/pirate-bay/
```

Do not encode application logic around these paths.

The database Asset record must remain the authoritative reference.

---

# 7. Upload Workflow

Create a model upload wizard.

## Step 1 — Select Model

Allow:

```text
.glb
```

Make GLB the preferred and initially supported production format.

Do not add formats simply because Three.js technically supports them.

---

## Step 2 — Basic Information

Administrator enters:

```text
Name
Description
Category
World
Region
Source
Source notes
```

World/region should be optional because some assets will be globally reusable.

---

## Step 3 — Upload

Upload directly to S3 using Amplify Storage.

Display:

```text
Uploading...
XX%
```

Handle:

- failed upload
- canceled upload
- network interruption
- duplicate filename
- invalid file
- excessive file size

Do not create a PUBLISHED database record before the S3 upload succeeds.

---

# 8. Model Validation

After upload, load the GLB using Three.js `GLTFLoader`.

Validate that the model can actually be loaded by the game's Three.js runtime.

Inspect:

```text
Scenes
Meshes
Geometry
Materials
Textures
Skeleton
Bones
Animations
Bounding box
Dimensions
```

Detect obvious problems.

Examples:

```text
Model cannot be parsed
No scene found
Missing geometry
Missing textures
Invalid material
Extreme polygon count
Extreme dimensions
No skeleton where expected
Animation errors
```

Do not automatically reject an asset simply because it has no animations or skeleton.

Buildings and props may legitimately have neither.

---

# 9. Validation Severity

Use:

```text
PASS
WARNING
ERROR
```

Example:

```text
PASS
Model successfully loaded.

PASS
Textures available.

WARNING
Model contains 145,000 triangles.

WARNING
No animations detected.

ERROR
GLB could not be parsed.
```

ERROR should prevent publication.

WARNING should allow an administrator to publish after reviewing it.

---

# 10. Three.js Preview

This is an important requirement.

Every uploaded 3D model must have an admin preview.

Create a reusable:

```text
<ModelPreview />
```

component.

Use Three.js.

The viewer should provide:

```text
Orbit controls
Rotate
Zoom
Pan
Reset camera
Grid
Lighting
Bounding box toggle
Skeleton toggle
Animation selection
Play animation
Pause animation
```

Automatically position the camera based on the model's bounding box.

Do not assume all models use identical dimensions.

---

# 11. Animation Inspection

If animations exist, display them.

Example:

```text
Animations

Idle            4.2 sec
Walk            1.1 sec
Run             0.8 sec
Talk            3.6 sec
Wave            2.1 sec
```

Allow the administrator to select and preview each animation.

Use Three.js `AnimationMixer`.

---

# 12. Model Details Screen

Example:

```text
Pirate Captain Male

Status: PUBLISHED
Version: 3

[3D PREVIEW]

FILE

pirate-captain-v3.glb
14.8 MB
GLB

GEOMETRY

Meshes: 5
Triangles: 24,812
Vertices: 18,302

MATERIALS

Materials: 4
Textures: 6

RIGGING

Skeleton: Yes
Bones: 68

ANIMATIONS

Idle
Walk
Run
Talk
Point

LOCATION

World: Pirate Bay
Region: Harbor

USED BY

Captain Barnacle
Dockmaster Henry
Pirate NPC #7
```

---

# 13. Asset Usage Tracking

The system needs to answer:

> Where is this asset being used?

This is critical before an administrator replaces or archives an asset.

Show relationships such as:

```text
Characters
NPCs
Quests
Scenes
Worlds
Regions
Buildings
```

Do not allow destructive deletion of a published asset that is currently referenced.

---

# 14. Asset Replacement

Administrators must be able to replace a GLB without creating an entirely new logical game asset.

Example:

```text
Captain Model

v1
v2
v3
v4
```

The game should reference:

```text
assetId
```

rather than:

```text
pirate-captain-v4.glb
```

This is important.

Game code and content should not depend directly upon versioned filenames.

---

# 15. Versioning

Implement asset versioning.

At minimum maintain:

```text
Asset
AssetVersion
```

Suggested AssetVersion:

```text
id
assetId

version

s3Key
fileName
fileSize

metadata

uploadedBy
createdAt
```

The Asset record identifies the currently active version.

Example:

```text
Asset

id: pirate-captain
currentVersion: 4
```

Existing versions should not immediately be destroyed.

---

# 16. Publishing

Use the workflow:

```text
UPLOAD
   ↓
PROCESSING
   ↓
READY
   ↓
PUBLISHED
```

Assets with validation errors:

```text
PROCESSING
   ↓
ERROR
```

An administrator should explicitly publish an asset.

Uploading should NOT automatically make the model available to children.

---

# 17. Archive Instead of Delete

Published assets should normally be archived rather than deleted.

Use:

```text
ARCHIVED
```

Archived assets:

- cannot be assigned to new content
- remain available to existing references when necessary
- remain visible to administrators

Permanent deletion should only be possible when there are no references.

---

# 18. Model Browser

`/admin/assets/models`

Create a useful asset browser.

Display:

```text
Thumbnail
Name
Category
World
Status
Version
File size
Triangles
Animations
Updated
```

Provide search.

Provide filters:

```text
Category
World
Region
Status
Animated
Rigged
```

---

# 19. Thumbnail Generation

Each model should have a thumbnail.

Initially it is acceptable to generate the thumbnail client-side from the Three.js preview.

Eventually this could become a backend process.

Store generated thumbnails in S3:

```text
assets/thumbnails/models/
```

Store the S3 key in the Asset record.

---

# 20. Character Integration

Update the character architecture so characters reference:

```text
modelAssetId
```

instead of hard-coded GLB URLs.

Example:

```text
Character

id
name

modelAssetId

voiceId
personalityId

worldId
regionId
```

Resolve the current published model version through the asset system.

---

# 21. World Integration

World content should follow the same principle.

Do not write:

```javascript
loader.load(
  "https://bucket.s3.amazonaws.com/pirate.glb"
)
```

throughout the application.

Instead use an asset service.

Example conceptual API:

```typescript
const asset = await assetService.getAsset(assetId);
const url = await assetService.getRuntimeUrl(asset);
```

Then:

```typescript
loader.load(url, ...);
```

Centralize asset resolution.

---

# 22. Runtime Asset Service

Create a reusable service/module responsible for resolving assets.

Example:

```text
AssetService

getAsset()
getPublishedAsset()
getCurrentVersion()
getAssetUrl()
preloadAsset()
```

Three.js code should not need to understand S3 key organization.

---

# 23. Caching

Design for browser/CDN caching.

GLB files can become large.

Avoid repeatedly downloading identical assets.

Use versioned S3 objects so long-lived caching can safely be used.

Example:

```text
pirate-captain/
    v1/model.glb
    v2/model.glb
    v3/model.glb
```

Replacing a model should create a new versioned object rather than overwriting the old object.

---

# 24. Security

Only administrators should be able to:

```text
Upload
Replace
Publish
Archive
Delete
Modify metadata
```

Do not rely solely on hiding admin routes in React.

Enforce authorization through Amplify backend/storage/data rules.

Children must never receive administrative mutation permissions.

---

# 25. Upload Limits

Define reasonable upload limits.

Do not hard-code arbitrary limits without documenting them.

Configuration should support something similar to:

```text
MODEL_MAX_UPLOAD_MB
```

Also generate warnings for unusually large assets.

Large GLBs directly affect children's loading time and memory usage.

---

# 26. Performance Budget

Introduce configurable recommendations for:

```text
GLB file size
Triangle count
Texture resolution
Material count
Animation count
Bone count
```

Initially treat these as warnings rather than hard failures.

Example:

```text
Performance

File size:      PASS
Triangles:      WARNING
Textures:       PASS
Materials:      PASS
Bones:          PASS

Overall:
READY WITH WARNINGS
```

This will become especially important for Android/mobile support.

---

# 27. Amazon Polly

The generic Asset architecture should eventually support Polly-generated MP3 files.

Do NOT implement Polly as part of the initial Model Asset Manager unless existing project architecture makes it trivial.

Prepare for:

```text
AssetType.AUDIO
```

with categories such as:

```text
VOICE
MUSIC
SFX
AMBIENT
```

Polly audio should also ultimately live in S3 and be referenced through the asset system.

---

# 28. Future Texture Management

Do not tightly couple the asset manager to GLBs.

Future support should allow:

```text
/admin/assets/textures
```

for:

```text
PNG
JPG
WEBP
KTX2
```

This will eventually allow shared textures and optimized game assets.

---

# 29. Future Animation Library

Prepare for:

```text
/admin/assets/animations
```

Animations may eventually exist independently of models.

This could allow:

```text
Walk
Run
Jump
Wave
Talk
Point
Celebrate
Attack
Defend
```

to be reused across compatible rigs.

Do NOT implement animation retargeting as part of the initial version.

---

# 30. Audit Information

Record:

```text
Created by
Created date
Last modified by
Last modified date
Published by
Published date
```

Asset management is an administrative content-management function and should have traceability.

---

# 31. Error Handling

Use the project's existing notification/toast system.

Provide meaningful errors.

Bad:

```text
Error
```

Good:

```text
The model could not be processed because the uploaded GLB is invalid.
```

or:

```text
Upload completed, but three referenced textures could not be found.
```

---

# 32. Phase 1 — Foundation

Implement:

- Asset schema
- AssetVersion schema
- enums
- Amplify authorization
- S3 storage configuration
- AssetService
- `/admin/assets`
- `/admin/assets/models`

Do not modify unrelated systems.

---

# 33. Phase 2 — Upload

Implement:

- GLB file selection
- metadata form
- S3 upload
- progress indicator
- Asset creation
- AssetVersion creation
- error handling

Test large uploads and failures.

---

# 34. Phase 3 — Validation

Implement:

- GLTFLoader validation
- metadata extraction
- geometry statistics
- material inspection
- skeleton inspection
- animation inspection
- bounding box calculation
- validation results

---

# 35. Phase 4 — Three.js Viewer

Implement the reusable:

```text
<ModelPreview />
```

Add:

- OrbitControls
- lighting
- grid
- camera fitting
- animation controls
- skeleton display
- bounding box

Use this component anywhere the admin system needs a model preview.

---

# 36. Phase 5 — Publishing

Implement:

```text
DRAFT
PROCESSING
READY
PUBLISHED
ARCHIVED
ERROR
```

Add publication controls and authorization.

The child-facing application should only use published assets.

---

# 37. Phase 6 — Versioning

Implement:

```text
Replace Model
```

Replacement should:

1. Upload a new S3 object.
2. Create a new AssetVersion.
3. Validate the model.
4. Allow administrator review.
5. Publish the new version.
6. Update the Asset's current version.
7. Preserve previous versions.

---

# 38. Phase 7 — Character Integration

Inspect the existing Character/NPC architecture.

Migrate model references to:

```text
modelAssetId
```

Do not destroy existing references until migration has been verified.

Provide backwards compatibility during migration if necessary.

---

# 39. Phase 8 — Usage Tracking

Implement:

```text
Used By
```

for each model.

Before archive/delete operations, determine which game objects reference the asset.

Display those references to the administrator.

---

# 40. Phase 9 — Performance and Polish

Add:

- thumbnails
- filtering
- search
- sorting
- performance warnings
- responsive admin UI
- loading states
- empty states
- confirmation dialogs
- better error reporting

---

# 41. Testing

Add automated tests covering:

### Data

- create Asset
- create AssetVersion
- publish Asset
- archive Asset
- authorization

### Upload

- valid GLB
- invalid GLB
- upload failure
- oversized model
- duplicate filename

### Three.js

- static model
- rigged model
- animated model
- multiple animations
- model without textures

### Versioning

- replace model
- previous version retained
- current version updated
- failed replacement does not affect production version

### Security

Verify that:

- administrators can manage assets
- parents cannot manage assets
- children cannot manage assets
- anonymous users cannot manage assets

---

# 42. Documentation

Update the project's existing documentation rather than creating redundant documentation.

Document:

```text
Asset architecture
S3 organization
Asset lifecycle
Model requirements
Model naming conventions
Performance recommendations
Versioning
Publishing
Character integration
Three.js integration
```

Update relevant existing files such as:

```text
docs/ARCHITECTURE.md
docs/DATA_MODEL.md
docs/IMPLEMENTATION_STATUS.md
docs/ROADMAP.md
docs/DECISIONS.md
```

Add an ADR if this constitutes a significant architectural change.

---

# 43. Important Development Rules

Before coding:

1. Inspect the existing project.
2. Inspect the Amplify Gen 2 schema.
3. Inspect existing S3/Storage configuration.
4. Inspect existing admin routes.
5. Inspect existing Three.js loaders.
6. Inspect existing Character/NPC models.
7. Search for existing hard-coded model paths.
8. Reuse existing components and patterns where appropriate.

Do not create duplicate infrastructure.

Do not rewrite working systems unnecessarily.

Do not place GLBs in Git.

Do not hard-code S3 URLs into world/adventure components.

Do not delete existing assets during migration.

Do not expose admin mutations to children.

Do not automatically publish uploaded assets.

---

# 44. Definition of Done

The first production version is complete when an administrator can:

1. Navigate to `/admin/assets/models`.
2. Upload a GLB.
3. Store that GLB in S3.
4. Automatically create its database metadata.
5. Preview the model in Three.js.
6. See model statistics.
7. See skeleton and animation information.
8. Preview animations.
9. See validation warnings/errors.
10. Publish the model.
11. Assign the published model to a character/NPC.
12. Load that character's model in the actual Three.js world through its Asset ID.
13. Replace the GLB with a newer version without changing the character record.
14. Roll back/reference previous versions if necessary.
15. Archive unused assets safely.

The key architectural rule is:

> **Game content references logical Asset IDs. Asset records reference versioned S3 objects. Three.js obtains runtime URLs through the asset service.**

This separation should remain intact throughout the implementation.

---

# Final Instruction to Claude

Implement this roadmap incrementally.

Before beginning each phase, inspect the existing implementation and adapt the roadmap to the project's actual architecture rather than assuming files, models, or services do not already exist.

After each phase:

1. Run the appropriate build.
2. Run tests.
3. Resolve TypeScript errors.
4. Verify Amplify schema compatibility.
5. Verify authorization.
6. Update `IMPLEMENTATION_STATUS.md`.
7. Commit the completed phase separately when the repository workflow permits it.

Do not move to a later phase while the current phase leaves the application in a broken state.