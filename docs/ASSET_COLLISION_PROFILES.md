# Asset collision profiles (Asset Manager)

Status: implemented on `feature/asset-collision-profiles` (2026-11-14), unit-tested, awaiting owner
QA. Builds on the shared derived colliders (`integration/avatar-amplify-exit`, commit `9b10f1f`).

A collision profile says how a 3D asset blocks the child's movement **wherever it is placed**, in
every location and adventure. Staff configure it once, in Django Admin, and the game applies it to
every placement with that placement's position, rotation and scale. Nothing is authored per scene.

## How it works

```text
Django Admin: Assets > Collision profiles          (staff, apps/assets/admin.py)
  -> CollisionProfile (asset default, or a version override)   (apps/assets/models.py)
  -> collision.py: shape -> model-space axis-aligned boxes + behaviour
  -> asset resolver answer: "collision": {behavior, shape, boxes}   (GET children/<id>/assets/)
  -> React: djangoAssetResolver.collisionProfiles(ids)   (same batched, cached request as models)
  -> engine: applyCollisionProfiles -> derivedColliders.ts (placement transform, keep-clear rules)
  -> the existing movement controller (FirstPersonController): unchanged
```

- **No new physics engine.** The movement controller only has axis-aligned boxes, so Django turns
  every shape into model-space boxes and the client turns those into world boxes under each
  placement's transform. A box turned off the axes is cut along its length into short pieces so
  it does not block empty air beside it.
- **Assets without a profile keep the built-in defaults** (`ASSET_FOOTPRINTS` in
  `react/src/features/island-map/three/runtime/derivedColliders.ts`). A profile only ever replaces
  the default for its own asset.
- **When it takes effect:** a child's next visit to a location. Profiles arrive with the asset
  resolver answer, after the scene starts; the runtime swaps the default boxes for the profile's
  and never places a new box where the child is standing.
- **Source-controlled locations** (Welcome Harbor, Pirate Builder Bay, ...) keep their bundled
  models but still read profiles from Django when the Django API is on. Without the Django API
  (`VITE_BACKEND` unset in a build) only the built-in defaults apply.

## Profile fields

| Field | Meaning |
|---|---|
| Asset | The asset (`ContentAsset`) the profile applies to. |
| Version | Empty: the asset's default for every version. Set: an override for that version only (one per version). |
| Shape | `None`, `Box`, `Cylinder`, `Capsule`, `Compound boxes`. |
| Behavior | `Automatic` (jumpable up to 1.2 m tall, solid above), `Solid`, `Jumpable`, `Walkable`, `Decorative`. |
| Axis | Cylinder and capsule: `Upright`, or lying along model X or Z (a log). |
| Width, Height, Depth | Model-space size along X, Y, Z in metres. **Empty: from the model's measured bounds.** |
| Radius | Cylinder and capsule radius. Empty: half the widest cross-section. |
| Offset X, Y, Z | Box centre on X and Z, bottom on Y. **Empty: the measured centre and bottom.** |
| Boxes | Compound only: `[{"x", "z", "y", "width", "height", "depth"}]`, with x and z the centre and y the bottom. |

Measured bounds come from the GLB's geometry at upload: validation now records the bounding box's
`min` and `max` corners in `AssetVersion.metadata["bounds"]`. Versions uploaded before this change
only have a size, so their bounds are taken as that size centred on the pivot and standing on it
(true of every kit model); enter offsets by hand if a model is not built that way.

### Behaviour

- **Solid**: blocks at every height. A solid box raised off the ground (a hanging sign) still
  blocks only at its own height.
- **Jumpable**: blocks the body, but the child can hop onto or over it (the default jump reaches
  1.2 m). Use for barrels, crates, rocks and logs. Never required to finish an adventure.
- **Walkable**: never blocks, and its placements are **kept clear**: a derived box from any other
  asset that would cover the centre of a walkable piece is dropped. Use for paths and planks.
- **Decorative**: never blocks (flowers, grass, butterflies, hanging leaves).
- **Automatic**: jumpable up to 1.2 m tall, solid above.

### Shapes

- **Box**: one box. With every size and offset empty this is the automatic bounding box.
- **Cylinder** upright: an octagon made of three boxes, so a trunk is round, not square. Lying: one
  box along the axis.
- **Capsule** upright: the same octagon (a character). Lying: a middle box between two octagon
  ends (a log with rounded ends).
- **Compound boxes**: up to 32 boxes, used as given (walls of a building, a dock with posts).
- **None**: never blocks, whatever the behaviour.

## What the game always protects

These rules hold for every derived box, profile or default:

1. **Location overrides win.** A piece whose centre an authored location collider covers
   (`manifest.colliders`, Treasure Cove's `colliders` in Django) gets no derived box: the author's
   box is used instead. Quest gates (gated colliders) count as covering in every state, so a gate's
   own piece never gets a second box that would outlive the gate opening.
2. **Spawn points and checkpoints stay clear**: a piece with a box over one is dropped.
3. **Entrances stay clear**: each open side of a building (no wall there), and a step outside it.
4. **Required paths stay clear**: the centre of every walkable piece (assets with a `Walkable`
   profile, and by default `path`, `path-forest`, `bridge-plank`, `bridge-plank-repaired`, `carpet`).
5. **A box never lands on the child** when profiles arrive mid-visit.

A piece is dropped whole (never half a log) when any of its boxes covers a protected point.

## Configuring common assets

Open **Django Admin > Assets > Collision profiles > Add**, pick the asset, fill in the fields below,
and save. The form refuses a profile it cannot build and says why. The change page then shows the
measured bounds and the exact boxes the game receives ("What the game uses"). Use **Preview** to
see them over the model.

| Asset | Shape | Behavior | Sizes | Why |
|---|---|---|---|---|
| Tree (`foliage-tree`, palms) | Cylinder, upright | Solid | Radius 0.2 to 0.3 (the trunk), Offset Y 0 | The canopy is above the child: block the trunk only. |
| Crate | Box | Jumpable | Empty (automatic) | The bounding box is the crate. |
| Barrel, upright | Cylinder, upright | Jumpable (or Automatic) | Empty | Round footprint, hop onto it. A barrel lying on its side is a placement rotation, not another profile. |
| Rock, boulder | Box or Cylinder, upright | Automatic | Empty | Small rocks are hopped over; scaled-up boulders become solid automatically. |
| Fallen log | Capsule, lying along its length axis | Jumpable | Radius about half its thickness | Rounded ends; a log turned at an angle blocks only where it lies. |
| NPC | Capsule, upright | Solid | Radius 0.3, Height 1.6 | A body, not the arms: the child can still walk up to talk. |
| Building | Compound boxes | Solid | One box per wall, leaving the doorway open | The interior stays walkable. |
| Path, plank, carpet | Box | Walkable | | Never blocks, and keeps other pieces off the trail. |
| Flowers, grass | None | Decorative | | Visual only. |

Example compound for a 4 m hut open on its south side:

```json
[
  {"x": 0, "z": -2, "y": 0, "width": 4, "height": 3, "depth": 0.2},
  {"x": -2, "z": 0, "y": 0, "width": 0.2, "height": 3, "depth": 4},
  {"x": 2, "z": 0, "y": 0, "width": 0.2, "height": 3, "depth": 4},
  {"x": -1.4, "z": 2, "y": 0, "width": 1.2, "height": 3, "depth": 0.2},
  {"x": 1.4, "z": 2, "y": 0, "width": 1.2, "height": 3, "depth": 0.2}
]
```

## Preview

The Asset Manager preview (**Asset versions > a version > Preview**) has a **Show collision** button
that draws the boxes the game will use, in the model's own frame: red for solid, amber for
jumpable. Without a profile it shows the built-in default box, and it says when a piece never
blocks. A link opens the asset's collision profiles.

## Permissions

`manage.py ensure_asset_roles` grants **Asset publishers** add, change and delete, and **Asset
editors** view only, because a saved profile changes what children meet on their next visit with
no separate publish step. Every save records who changed it and when.

## Not in scope

- New runtime shapes beyond axis-aligned boxes (true cylinders, capsules, rotated boxes, slopes).
  Each would need a change to the movement controller, which this feature deliberately leaves
  untouched.
- Per-placement collision overrides in a location manifest. Use an authored location collider
  over the piece instead (rule 1 above).
- NPC Manager NPCs moving at runtime use their own movement rules; manifest NPCs are static.

## Tests

- Django: `lai/apps/assets/tests/test_collision_profiles.py` (bounds measured at validation and
  the fallback for older versions, every shape, manual overrides, behaviour, precedence, unique
  constraints, validation, the resolver field, admin roles and form, the preview page).
- React: `collisionProfile` parsing and `derivedColliders` with profiles, keep-clear rules and
  building entrances (`derivedColliders.test.ts`); the resolver's shared request
  (`djangoAssetResolver.test.ts`); the engine swapping boxes mid-visit and keeping defaults on
  failure (`collisionProfiles.engine.test.ts`); `regionAssets.test.ts`; the preview
  (`mountAssetPreview.test.ts`, `modelPreviewViewer.test.ts`).
