# Player Avatar Assets (LAI-JMP-01c)

Status: **asset integration development complete** on `feature/player-avatar-assets`, unit-tested
only. **Production art is NOT ready:** none of the six production avatar models exist yet, so
every child still sees the procedural placeholder until staff upload, assign and make available a
real GLB per avatar (follow-up card LAI-JMP-01e). Decision record: ADR-057.

**Depends on** LAI-JMP-01a (`feature/third-person-avatar`, PR #27), which depends on LAI-JMP-01
(PR #26). Neither was merged when this branch was made. Merge #26, then #27, then this.

## What this adds

Staff can now give each of the six avatar identities a child can be given (Fox, Owl, Otter,
Dragon, Robot, Mermaid) a real animated 3D model, entirely in Django Admin, using the existing
Asset Manager for the file. A child whose parent chose that avatar sees the published model in
third-person in every 3D adventure. Anything missing or broken falls back to the placeholder.

## Architecture

```text
Django Admin                                   Play API                         React (any 3D location)
─────────────                                  ────────                         ───────────────────────
Assets (existing Asset Manager)                GET children/<child>/avatar/     playerAvatarSourceFor(child)
  upload GLB ─> validate ─> version               child-scoped (parent only)       ├─ published: Promise<model|null>
  ─> publish ─> default ─> (retire)               answers for the child's own      └─ loadModel(ref): Django asset
                                                  avatar_key only                     resolver + shared loader/cache
Player avatars (new, 6 fixed rows)              ──────────────────────────>       createLocationEngine
  model asset (+ optional pinned version)       { model: { ref: "player-fox@2",     └─ createPlayerAvatar (one renderer)
  scale, facing, animation map,                   scale, rotationOffset,               placeholder at once; swaps in the
  colour materials, attach points,                animationMap, customization,         model when loaded; never blocks
  thumbnail, status DRAFT/AVAILABLE/DISABLED      clips, version } | null }          └─ animation controller (NPC animator)
```

- **No second asset system.** The GLB is a `catalog.ContentAsset` (kind `character`) with
  immutable `assets.AssetVersion`s: upload, validation, versioning, publishing, retirement,
  signed delivery and caching are the Asset Manager's, unchanged. The avatar row only references
  it, like the NPC Manager's model variants do.
- **Served by reference.** The play API names the model as `asset-id` (the published default) or
  `asset-id@n` (a pinned version). React loads that through the existing child-scoped asset
  resolver (`GET children/<child>/assets/?ids=`) and the shared loader, so drafts, unpublished and
  retired versions can never be loaded and the parsed model is cached per visit.
- **One renderer** (`playerAvatar.ts`) for every location; no per-adventure avatar code.
- **The movement controller stays authoritative.** The avatar copies its feet and facing every
  frame; clips have root motion stripped.

## Avatar catalogue (Django model `avatars.PlayerAvatar`, ADR-057)

One row per identity, created by migration `avatars.0002` as drafts with no model.

| Field | Meaning |
|---|---|
| `avatar_key` | `FOX`, `OWL`, `OTTER`, `DRAGON`, `ROBOT` or `MERMAID` (the child profile's `avatar_key`). Fixed. |
| `display_name` | Staff and child-facing name. |
| `model_asset` | A `character` asset in the asset library (GLB or self-contained glTF). |
| `pinned_version` | Optional. Serve exactly this published version; empty serves the asset's published default. |
| `thumbnail_asset` | Optional. An image asset showing the character (served with a signed URL). |
| `scale` | 0.2 to 5. Multiplies the model (aim for 1.2 to 1.5 m tall in game). |
| `rotation_offset_y` | Radians added to facing, for a model not authored facing +Z. |
| `animation_map` | Player state to clip name (below). States left out use the standard clip names. |
| `customization` | `colorMaterials` and `attachPoints` (below). |
| `status` | `DRAFT` / `DISABLED`: children get the placeholder. `AVAILABLE`: children get this model. |
| `notes`, `updated_at`, `updated_by` | Staff only. |

Rules (`apps/avatars/validation.py`, checked on every save, and before "Make available"):

- the model must be a `character` asset, not retired; a pinned version must belong to it;
- to be AVAILABLE it must resolve to a **published** GLB/glTF version;
- every `animation_map` key must be a player state and every clip must exist in that version;
- `customization` may only hold the documented keys, roles and slots;
- the thumbnail must be an image.

Missing clips are **warnings**, never errors: an avatar with only `Idle` is usable.

The Asset Manager refuses to **retire** a model asset, or the exact version, that an AVAILABLE
avatar is served (the same guard mechanism the NPC Manager uses). Make the avatar a draft, or
point it at another model, first.

## Staff workflow (Django Admin)

Roles: run `python manage.py ensure_asset_roles`. **Asset editors** can view and configure
avatars as drafts; **Asset publishers** can also make one available or disable it.

1. **Upload** - Assets, Add content asset: kind `character`, category `character`, an id such as
   `player-fox`. On its page, upload the `.glb`. The Asset Manager validates it (structure, size,
   extensions, clip names) and shows the findings.
2. **Validate** - fix anything the validation report lists; check the clips it found.
3. **Publish** - publish the version and make it the default (or keep it unpinned until ready).
   Use the asset library preview to look at it.
4. **Assign** - Player avatars, open the identity (e.g. Fox): choose the model asset (and
   optionally pin a version).
5. **Scale and orientation** - set `scale` so the character is about 1.3 m tall and
   `rotation_offset_y` if it faces away (`3.14159` turns it round).
6. **Animation mapping** - read "Clips in the served model" and "Clip each state will play"; add
   `animation_map` entries only for clips that do not use the standard names.
7. **Customization** - name the materials that take the child's colours and the attachment
   nodes.
8. **Check** - "Problems and warnings" must say "Ready", and "What children choosing this avatar
   receive" shows the exact answer the play API will give.
9. **Publish to children** - select the row, action "Make available to children" (publishers).
   Children choosing that avatar get the model on their next visit to any 3D location.
10. **Verify** - play as a child with that avatar (see the QA checklist).
11. **Undo** - action "Make draft" or "Disable": children get the placeholder again at once.

## Animation

Player states (React `PLAYER_ANIMATION_STATES` and Django `PLAYER_ANIMATION_STATES`, parity-tested):

| State | When it plays | Standard clip names (used when the map leaves the state out) | If missing |
|---|---|---|---|
| `idle` | Standing | `Idle` | gentle procedural bob (none under reduced motion) |
| `walk` | Moving; speed-matched 0.6x to 1.25x | `Walk` | stays on idle |
| `run` | Reserved for a future run speed | `Run` | not used yet |
| `jump` | Take-off and rising | `Jump` | keeps walk or idle |
| `fall` | Falling (after the peak, or off a ledge) | `Fall` | `jump` if present, else walk or idle |
| `land` | The moment after touching down | `Land` | straight back to idle or walk |
| `interact` | Interacting with something (once) | `Point`, `Wave`, `Activate` | nothing |
| `celebrate` | A world change or a pickup (once) | `Celebrate` | nothing |

Jumping follows the physics state, not a timer. The controller asks the animator only for states
the avatar really has, so the NPC fallback chains can never turn a jump into a celebration. Clips
crossfade over 0.2 s, and a state is set only when it changes.

`Run`, `Jump`, `Fall` and `Land` are in the closed clip-name vocabulary on both sides
(`animationVocabulary.ts`, Django `CLIP_VOCABULARY`, parity-tested); `fall` and `land` joined the
shared NPC animation states additively (existing NPC releases are unchanged).

### Example: animation map and customization

A complete `animation_map` for a model whose clips use the standard names except two:

```json
{
  "idle": "Idle",
  "walk": "Walk",
  "run": "Run",
  "jump": "Jump_Start",
  "fall": "Jump_Loop",
  "land": "Jump_Land",
  "interact": "Interact",
  "celebrate": "Cheer"
}
```

(Clips must be named from the vocabulary to pass the Asset Manager's validation without
warnings; a map lets a model keep other names, as above, at the cost of a warning per name.)

A complete `customization`:

```json
{
  "colorMaterials": {
    "Fur": "body",
    "Belly": "accent",
    "Ears_Inner": "accent"
  },
  "attachPoints": {
    "head": "mixamorig:HeadTop_End",
    "back": "mixamorig:Spine2",
    "hand_left": "mixamorig:LeftHand",
    "hand_right": "mixamorig:RightHand",
    "feet": "mixamorig:Hips"
  }
}
```

## Customization

- **Colours.** The child's existing avatar look (`avatarAppearance.ts`: body and accent colour
  per avatar) is applied to every material named in `colorMaterials`. Materials come from the
  shared cache, so each is **cloned** before it changes; another child, an NPC or the next visit
  never sees this child's colours. The clones are disposed on leaving.
- **Attachment points.** `attachPoints` maps the slots `head`, `back`, `hand_left`, `hand_right`
  and `feet` to node or bone names in the GLB. `PlayerAvatar.attachPoint(slot)` returns that node
  (the placeholder has stand-ins), ready for future cosmetics.
- **The child's selection is unchanged** (one `avatar_key` per profile, chosen by the parent) and
  is the same in every adventure.

Prepared for, not built: hats (`head`), shirts and seasonal outfits (named materials or a second
model variant), shoes (`feet`), backpacks (`back`), costumes (a location `player.avatar.assetKey`
already exists), unlockable cosmetics. A cosmetic system would add its own catalogue of
accessory assets and an owned-items record; no shop, payments or inventory are part of this.

## Model requirements (for artists and asset providers)

| Requirement | Specification |
|---|---|
| Format | glTF 2.0, as `.glb` (preferred) or a self-contained `.gltf` (all buffers and textures embedded). 50 MB upload limit; aim for **under 5 MB**. |
| Rig | One humanoid (or compatible) skeleton, one `SkinnedMesh` preferred. **60 bones or fewer** (mobile GPU uniform limits). |
| Animations | Embedded clips, named from the vocabulary: **`Idle`, `Walk`, `Jump`** required for a complete character; `Fall`, `Land`, `Run`, `Celebrate`, `Point` or `Wave` recommended. Loops seamless for `Idle`, `Walk`, `Run`, `Fall`. **In place: no root motion** (the game strips it anyway). No combat clips. |
| Origin and ground | Origin between the feet, feet at y = 0, in metres. |
| Orientation | Facing **+Z** (glTF forward). Otherwise set `rotation_offset_y`. |
| Scale | 1.2 to 1.5 m tall at scale 1 (or set `scale`). All six characters the same height class. |
| Polygon budget | **Target 5,000 to 8,000 triangles; maximum 10,000** (the existing character NPCs are about 5,000 to 7,700). |
| Draw calls | **3 materials or fewer**; one texture atlas preferred. |
| Textures | Base colour atlas **1024 x 1024** (2048 x 2048 maximum), PNG, JPEG or WebP, embedded. Optional normal map at the same or half size. No KTX2/Basis. |
| Materials | `MeshStandardMaterial`-compatible PBR (glTF metallic-roughness). Name the materials that should take the child's colours (e.g. `Fur`, `Belly`). Avoid transmission and other heavy extensions. |
| Compression | **No Draco, meshopt or KTX2**: the game's loader does not decode them. |
| Dependencies | No external files, URLs or scripts; nothing outside the file. |
| Content | Child-friendly, readable at 4 m, no weapons, original or properly licensed (record it in `docs/ASSET_LICENCES.md`). |
| Attachment nodes | Named nodes or bones for head, back, hands and feet, if cosmetics are wanted later. |

## Required production files (what the owner needs to supply)

Six files, one per identity, each meeting the requirements above:

| Identity | Suggested asset id | Required clips | Recommended clips |
|---|---|---|---|
| Fox | `player-fox` | `Idle`, `Walk`, `Jump` | `Fall`, `Land`, `Run`, `Celebrate`, `Wave` |
| Owl | `player-owl` | same | same |
| Otter | `player-otter` | same | same |
| Dragon | `player-dragon` | same | same |
| Robot | `player-robot` | same | same |
| Mermaid | `player-mermaid` | same | same (a mermaid may need a hover or swim-style `Walk`) |

Plus, optionally, one thumbnail image per identity (512 x 512 PNG or WebP). Licence records for
every file in `docs/ASSET_LICENCES.md`.

## Test fixture (NOT a production character)

`react/public/models/npc-harbor-master.gltf` (Quaternius "Ultimate Modular Men", **CC0**, already
recorded in `docs/ASSET_LICENCES.md`) is a self-contained, rigged, ~5,200-triangle human with
`Idle`, `Walk` and `Wave`, about 1.86 m tall. It is suitable **only to test the pipeline**: it is
not a Fox, Owl, Otter, Dragon, Robot or Mermaid, has no `Jump`, and must never be left available
to children. Unit tests use small synthetic models instead and need no file.

## React integration

- `api/play/avatarApi.ts`: `GET children/<child>/avatar/`; never throws (failure means `null`).
- `playerAvatarCatalog.ts`: the contract and strict runtime parsing (a malformed reference, scale
  or map is "no model").
- `features/player-avatar/playerAvatarSource.ts`: the published answer (a promise) and a loader
  over the Django asset resolver, once per visit; used by `routes/LocationWorldPage.tsx`.
- `createLocationEngine`: `publishedAvatar`, `loadAvatarModel`; the avatar no longer holds up the
  scene's `ready`. The avatar celebrates on `WorldStateChanged` and `CollectiblePickedUp`.
- `playerAvatar.ts`: costume > published model > bundled registry > placeholder; scale and
  facing from the catalogue on top of the location's; colours; attach points; disposal of only
  what it made.

## Owner QA checklist

Uses the CC0 test fixture to prove the pipeline, then repeat with each real model when supplied.

**Django Admin**

- [ ] `python manage.py migrate` then `python manage.py ensure_asset_roles`; your staff account is
  in Asset publishers.
- [ ] Player avatars lists Fox, Owl, Otter, Dragon, Robot, Mermaid, all Draft, no Add or Delete.
- [ ] Assets: add `player-avatar-test-fixture` (kind character, category character, display name
  "TEST FIXTURE - not a production avatar"); upload `react/public/models/npc-harbor-master.gltf`;
  validation passes and lists `Idle`, `Walk`, `Wave`; publish and make default.
- [ ] Player avatars, Fox: choose that asset, scale `0.75`; "Problems and warnings" shows a warning
  for `jump` only; "What children ... receive" shows `"model": null` with reason
  `not_available` (still a draft).
- [ ] Make available as a publisher: it succeeds; as an editor-only account it is refused.
- [ ] Try to retire the fixture asset while Fox is available: refused, naming Fox.
- [ ] Set an animation map naming a clip the model lacks: saving is refused with the clip's name.

**Game (a child whose avatar is Fox; then one whose avatar is Owl)**

- [ ] Treasure Cove: the Fox child sees the fixture human (about 1.4 m), standing on the sand,
  not floating or sunk; walking plays the walk cycle at a speed that matches the feet; turning is
  smooth; jumping lifts the model with the physics (it keeps walking or idling in the air, as it
  has no Jump clip); landing is clean.
- [ ] Owl child: still sees the placeholder in Owl colours (Owl has no model).
- [ ] V switches to first-person (model hidden) and back (model restored).
- [ ] Storykeeper Castle and Pirate Builder Bay: the same model appears with no setup per
  adventure, and the castle camera still never shows through walls.
- [ ] Throttle the network (devtools, Slow 3G): the adventure starts at once with the placeholder
  and the model appears when loaded.
- [ ] Make Fox a draft in Admin and re-enter: the placeholder is back.
- [ ] After testing: set Fox back to Draft and leave the fixture unassigned.

**With each real production model**

- [ ] Clips `Idle`, `Walk`, `Jump` (and any `Fall`, `Land`, `Celebrate`, `Wave`) play at the right
  moments; picking up a collectible plays `Celebrate`.
- [ ] Coloured materials take the child's avatar colours.
- [ ] Performance on the target tablet is unchanged from the placeholder.

## Known limitations

- **No production models exist.** All six identities serve the placeholder until real GLBs are
  supplied and made available (LAI-JMP-01e).
- One model per identity; per-child appearance beyond the avatar's colours is not stored.
- Accessories are prepared (attach points), not rendered.
- The test fixture has no `Jump`, `Fall` or `Land`; those clips are covered by unit tests with
  synthetic models only.
- Not yet checked in a browser, on a device, or with a real uploaded file end to end.
