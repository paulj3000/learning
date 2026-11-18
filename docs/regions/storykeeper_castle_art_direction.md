# Storykeeper Castle — Art Direction and Asset Conventions (SC-R01-03)

**Status:** the conventions behind ADR-028's decision, **accepted by the owner on
2026-11-03**. Procedural surfaces and boxes are interim art, not production art.
Anything marked as depending on acceptance is now in force. Island-wide conventions live in
`docs/THREE_WORLD_ASSET_CONVENTIONS.md`, and this document adds only what
the castle needs beyond them. Where the two disagree, that file wins
until this document is merged into it.

## 1. Style: Stylized Fantasy Storybook 3D

| Principle | What it means in the castle |
| --- | --- |
| Vibrant, welcoming colour | Warm stone, honey wood, jewel-tone textiles. No grey-on-grey rooms. The darkest room (the library) is still readable at a glance |
| Consistent materials | Every surface comes from a named material preset (section 4). No ad-hoc colours in scene code |
| Stylized geometry, finished | Low-poly with chunky bevels and exaggerated proportions (thick shelves, round columns, big books). Detail comes from silhouette and pattern, not polygon count |
| Warm light, magical highlights | Candle and lantern warmth as the base; small cool-gold or violet emissive accents on magical things only |
| Distinct room personalities | Each room has a light mood and a material set (section 5). A child can tell rooms apart from a screenshot |
| Child-friendly shapes | Rounded tops, no sharp spikes at eye height, nothing menacing in Sprouts-reachable rooms |
| Clear interactive silhouettes | Interactive props are brighter, more saturated and higher contrast than scenery near them. Scenery never imitates an interactive prop's shape |
| Tablet-light rendering | Budgets in section 7. No post-processing, no real-time shadows by default |

## 2. Coordinates and scale

Inherits `docs/THREE_WORLD_ASSET_CONVENTIONS.md`, "Units and axes" and "Origin
and pivot":

- 1 unit = 1 metre; +Y up; ground-pivoted unless a placement says `CENTRE`.
- Castle-specific: wall height 3 m (`sceneKit.ts` `WALL_HEIGHT`), eye height
  per `firstPersonController.ts`, walls 0.5 m thick straddling room edges.
- Wall-mounted props sit 0.05 m proud of the inner face
  (`WALL_MOUNT_CLEARANCE`).
- Imports are normalised to these units before they reach the registry, never
  by per-placement scaling (see "Normalising an import's scale" in the
  conventions file).

## 3. Sourcing and provenance

Per ADR-028's recommendation:

| Source | Used for | Rule |
| --- | --- | --- |
| Licensed kit (prefer CC0; KayKit Dungeon Remastered named) | Architecture, furniture, decor | Acquire from the publisher's page; record the archive SHA-256, licence and URL in `docs/ASSET_LICENCES.md` **before** the file is committed. Never copy from a third-party mirror |
| Commissioned | Quill, Ember, the Great Storybook, landmark props | Contract must grant redistribution in the app bundle; ledger row as above. Unpriced (owner) |
| Generator (`scripts/generate-world-assets.ts`) | Gameplay-bearing assets, state-variant pairs, and interim decor | Deterministic; always regenerable; no licence |
| Runtime procedural surfaces (`runtime/surfaces`, SC-R02-01) | Floors, walls, ceilings, trim | Deterministic seeded patterns; no file; no licence |
| AI-generated imagery or textures | — | **Not permitted** (both castle roadmaps, ADR-028) |

A CC-BY asset needs an attribution surface a parent can reach before it ships.
A marketplace asset whose terms exclude redistribution in an app bundle is not
usable. Assets the project has not acquired are never referenced as if they
exist. The asset manifest (`docs/regions/storykeeper_castle_asset_manifest.md`,
SC-R02-07) records availability per logical id.

## 4. Material conventions

- **Material presets are the unit of consistency.** A preset has an id,
  a procedural pattern (or, later, a licensed texture id), base and accent
  colours, roughness, metalness, an optional emissive tint, and
  metres-per-repeat. They are declared in the location manifest
  (`materials`), are JSON-serializable (ADR-032), and are validated by
  `validateLocationManifest`.
- One `Material` instance per preset per scene, shared by every surface that
  uses it. One texture per preset, sized by the quality tier.
- Textures are world-scaled. UVs are in metres divided by metres-per-repeat,
  so a flagstone is the same size in a 2 m corridor and a 12 m hall.
- Generated kit parts keep flat `baseColorFactor` materials (the identical-
  vertex rule for state-variant pairs is unchanged). Emissive is reserved for
  magical things and lit states.
- Colour space: preset colours are authored in sRGB hex. Procedural textures
  are tagged sRGB.
- Double-sided only where the generator already needs it. Surfaces built by
  the runtime are single-sided with correct winding.

## 5. Room palettes

| Room | Floor | Walls | Accent | Light mood |
| --- | --- | --- | --- | --- |
| Entry Hall | Patterned flagstone with a central inlay | Warm ashlar | Royal blue and gold banners | Daylight from the doors, warm torches |
| Story Hall | Honey wood planks | Warm plaster over ashlar wainscot | Crimson and gold | Hearth-warm, the brightest room |
| Character Gallery | Wood planks | Deep green plaster | Gilt frames | Gallery spot warmth |
| Costume Room | Patterned carpet | Plum plaster | Brass and mirrors | Theatrical warm |
| East Corridor | Flagstone | Ashlar | Runner carpet | Dimmer, sconce pools |
| Setting Tower | Stone | Cool ashlar | Brass instruments | Cool sky light |
| Illustration Studio | Pale wood planks | Cream plaster | Paint colours | Bright, neutral |
| Great Library | Dark wood planks | Ashlar | Gold and violet magic | Candle-warm, darkest room, glowing focal dais |

## 6. Naming and logical ids

- Logical ids are kebab-case, `<thing>[-<variant>][-lit]`. A state pair is
  `x` and `x-lit` (or `x-ajar`, `x-revealed`), as today.
- New castle-only decoration is prefixed `castle-` (`castle-column`,
  `castle-candelabra`) so island-wide ids stay unclaimed. Existing ids keep
  their names; renaming a logical id is a content migration, not a cleanup.
- Material preset ids are `<surface>-<room or style>` (`flagstone-entry`,
  `planks-library`).
- An id names *what it is*, never *where the file came from*: `ground-tile-stone`
  resolves to a KayKit file today and could resolve to a commissioned one
  tomorrow without a code change.

## 7. Budgets (provisional until measured on target hardware)

**Every number here is provisional.** None has been measured on a tablet.
SC-R11-01's profiling pass replaces them with measured values. SC-R02-08
enforces the static ones as tests, so growth is caught before a device
run.

| Budget | LOW | MEDIUM (tablet default) | HIGH |
| --- | --- | --- | --- |
| Procedural texture size | 64² | 128² | 256² |
| Imported environment texture | ≤ 512² | ≤ 1024² | ≤ 1024² |
| Character / landmark texture | ≤ 512² | ≤ 1024² | ≤ 2048² |
| Placed point lights in the scene | ≤ 8 | ≤ 14 | ≤ 20 |
| Real-time shadows | none | none | none (not planned) |
| Device pixel ratio cap | 1 | 1.5 | 2 |
| Ambient particles (motes) per emitter | 0 (static) | ≤ 40 | ≤ 80 |
| Post-processing | none | none | none |

Static scene budgets (counted from the manifest, all tiers):

| Budget | Value |
| --- | --- |
| Distinct material presets | ≤ 16 |
| Scenery items, original eight rooms | ≤ 160 (a baseline that is not raised). Each later room has its own allowance, set when it is designed: Trophy Room ≤ 20, Secret Chamber ≤ 24 (reserved). The castle-wide limit is the sum for the rooms that exist |
| Scenery items in the Great Library | ≤ 48 |
| Draw calls, whole castle (estimated from instancing and static decor batching, WS-C; about 241 estimated, not measured) | ≤ 300 |
| Triangles, generated asset | ≤ 2 000 |
| Triangles, imported prop / character | ≤ 5 000 / ≤ 15 000 |
| `.gltf`/`.glb` file size, prop / character | ≤ 200 KB / ≤ 2 MB |

Targets for SC-R11 (provisional): 30 fps sustained in the Great Library on
the target tablet at MEDIUM, and under 8 s to the first walkable frame on a
cold load.

## 8. glTF / GLB import rules

The import contract in the conventions file applies: units, ground pivot,
single root, no required extensions, embedded textures, and the import
contract test. In addition:

- Textures are PNG or JPEG embedded in a `.glb`. KTX2, Draco and Meshopt
  need a separate decision, because they add decoders.
- At most one material per mesh for instanced pieces
  (`createInstancedMeshFromAsset` keeps the first).
- No lights or cameras in imported files.
- Animation clip names come from `animationVocabulary.ts`.

## 9. Colliders and interaction boundaries

Unchanged from the conventions file ("Collider proxy", "Interaction
anchor"): authored `RectZone`s become colliders, and a mesh's bounding box is
never read for collision. Swapping art never changes where a child can walk
or what they can aim at. A new decorative object that should block movement
gets an authored collider in the region module and a test that keeps every
authored spot walkable.

## 10. Fallback rendering

| Failure | Behaviour |
| --- | --- |
| Model fails to load | The engine's placeholder box (props, models, NPCs) or flat plane (tiled ground), as today. Gameplay continues |
| Material preset references an unknown pattern | Validation rejects the manifest in tests. At runtime the flat base colour is used |
| Procedural texture cannot be created (quality LOW, or a renderer without float or byte textures) | Flat base colour, same preset otherwise |
| Asset resolver failure (Django) | Bundled manifest fallback, as today |
| An imported texture fails to decode | `GLTFLoader` rejects; the engine's placeholder is drawn |

## 11. Tablet performance targets

- MEDIUM is the default.
- LOW is chosen when the device reports at most 4 logical cores or at most
  4 GB of memory, or when the owner forces it. No GPU sniffing.
- HIGH is never automatic. It exists for development and for a future
  parent-facing setting.
- Quality changes never change gameplay: colliders, interactions, bindings
  and copy are identical at every tier, which is tested.

## 12. Wall geometry audit for ceilings other than 3 m (Final F)

SC-R11 made the ceiling a manifest value (`wallHeight`, default 3). This audit answers the open
"kit-piece scaling" question (acceptance 4.3 decision 5) for the **castle's own** pieces. It is a
geometry and manifest audit, checked by unit tests; it has not been looked at in a browser, and no
room is built at 4 m yet.

| Piece | Authored height | At `wallHeight` 4 | Change |
| --- | --- | --- | --- |
| `wall-stone` panels (`room-walls`) | 3 m plane, ground pivot | Stopped 1 m short of the ceiling | Only the panel's y scale grows (`wallHeight / 3`). The panel is a flat stone face with no opening, frame or pattern baked in, so nothing is distorted. Default positions are returned untouched |
| `archway` (jambs 2.6 m, lintel to 3 m) | 3 m, multi-part | Left a 1 m hole above every doorway | **Not scaled**, so openings keep their 2 m (secret passage 1.5 m) by 2.6 m size. A plain stone header course (`castle-arch-header:<archway id>`, `CASTLE.stoneDark`, a static batched box) fills 3 m to `wallHeight` over each gap. The secret passage's course is gated on the discovery, like its archway, so the seal never overlaps it. No collider is added (the opening is 2.6 m and the header is out of reach) |
| `door` (castle doors) | fits the archway | unchanged | None |
| Entry Hall pillars | base to 0.22, shaft to 2.78, cap to 3 | Floated 1 m under the ceiling | The shaft and cap follow `wallHeight`; the cap stays 0.22 m deep and ends on the ceiling. Their colliders stay 3 m (no collision change) |
| Great Library beam | hangs from the ceiling | handled in SC-R11 | None |
| Ceiling slab, wall and ceiling surfaces, cornices, room lamps, wall colliders, zone boxes | follow `wallHeight` | handled in SC-R11 | None |
| Banners, tapestries, portrait frames, mural, door cue plates, carvings, hearth | fixed y (1 to 2.92 m) | Hang lower on a taller wall, none touches the ceiling | None. Banners at a fixed y are a styling choice, not a defect; raise them only if a room is built tall |

What the tests prove for `wallHeight` 3 and 4 (`storykeeperCastleWallGeometry.test.ts`): the wall
panels' top is exactly the ceiling; no decor box exceeds the ceiling; pillars are unbroken from floor
to ceiling; every archway has a header that starts on the lintel and meets the ceiling and none
exists at 3 m; archway, secret archway and door placements are deep-equal to the shipped ones;
colliders keep their ids, rectangles and `minY`, and only wall segments change `maxY` (to the
ceiling), identical to the baseline fixture at 3 m; zones, interactions, checkpoints, props, NPCs,
collectibles and platforms equal the shipped snapshot, and the only new scenery ids are
`castle-arch-header:*`; and the draw-call estimate is at or under 300 at both heights. The shipped
castle (3 m) is unchanged: the headers appear only above 3 m.

Limits. A ceiling below 3 m is not supported by these pieces (the archway lintel is 3 m). A room
needing a different opening height needs a new archway piece, not a scaled one.

**Writing Room note (not changed here; another workstream owns it).** The Writing Room is a separate
manifest with its own `WRITING_ROOM_WALL_HEIGHT` (3) and does not set `wallHeight`, so it inherits
the engine default of 3 for zone and boundary boxes. It is consistent today. If it is ever built
taller, both must change together: set `wallHeight` on its manifest as well as the constant, and
cover the space above `secret-door-ajar` (the castle's header-course approach applies, as the door is
a fixed-height piece). Nothing in this audit needs a Writing Room edit now.
