# Asset Standard

- **Status:** Mandatory policy (ADR-072, accepted by the owner 2026-11-18). These standards are the final authority after the owner.
- **Owner:** Project owner
- **Last reviewed:** 2026-11-18
- **Related ADRs:** ADR-020, ADR-028, ADR-030, ADR-033, ADR-035, ADR-045, ADR-047, ADR-054, ADR-061, ADR-062, ADR-064, ADR-072 (Accepted); branch-only Reserved: ADR-066, ADR-070
- **Canonical sources:** [`docs/ASSET_LIBRARY.md`](../ASSET_LIBRARY.md), [`docs/ASSET_LICENCES.md`](../ASSET_LICENCES.md), [`docs/ASSET_SOURCING.md`](../ASSET_SOURCING.md), [`docs/THREE_WORLD_ASSET_CONVENTIONS.md`](../THREE_WORLD_ASSET_CONVENTIONS.md), [`docs/processing/CANONICAL_PATH.md`](../processing/CANONICAL_PATH.md), [`docs/platform/CHILD_PHOTO_STORAGE.md`](../platform/CHILD_PHOTO_STORAGE.md), [`docs/DECISIONS.md`](../DECISIONS.md)

This standard says how every adventure obtains, references and renders 3D models, textures,
images and audio files. It is policy plus pointers: the canonical sources above hold the detail
and win on any disagreement about behaviour. Where this page and a canonical source disagree on
a rule, raise it with the owner; do not pick one silently.

Labels used: **Implemented (main)**, **Pending merge (branch)**, **Approved future**, **Proposed**,
**Retired**.

## 1. Rules every adventure follows

| # | Rule | Source |
|---|---|---|
| A1 | Consume the shared Asset Library (Django `apps/assets` plus `catalog.ContentAsset`). Never build a second asset store, catalog, uploader, resolver or version table for one adventure | ADR-033, ADR-035, CLAUDE.md section 20 |
| A2 | Staff author assets only in Django Admin. React and Three.js only consume **published** assets through the child-scoped resolver. No React staff asset page and no administrator asset API | ADR-045 |
| A3 | Content refers to an asset by its stable id (`npc-pip`) or a pin (`npc-pip@2`), never by a URL, bucket, object key or file name | ADR-035; `noHardCodedAssetUrls.test.ts` |
| A4 | Every third-party file gets a ledger row in `ASSET_LICENCES.md` before it is checked in or published. Prefer CC0 | ADR-028; [`ASSET_LICENCES.md`](../ASSET_LICENCES.md) "Adding a third-party file" |
| A5 | No new binary file is committed to Git unless section 11 allows it or the owner approves | This page, section 11 |
| A6 | A missing, retired or failed asset never blocks play: the bundled fallback or a placeholder is drawn | [`ASSET_LIBRARY.md`](../ASSET_LIBRARY.md) sections 9, 10, 15 |
| A7 | The engine never imports React, Django clients or AWS SDKs; resolution lives outside the engine folder | ADR-020; `react/src/api/assets/djangoAssetResolver.ts` |
| A8 | Child photos are not assets. They live in their own bucket and flow, never in the Asset Library | [`CHILD_PHOTO_STORAGE.md`](../platform/CHILD_PHOTO_STORAGE.md) |

## 2. Asset Manager workflow (Implemented (main))

The "Asset Manager" is now called the Asset Library (ADR-045). The workflow, in order:

| Step | Who | Where | Result |
|---|---|---|---|
| 1. Create a definition (id, kind, category, name, tags) | Staff with `catalog.add_contentasset` | Django Admin > Catalog > Content assets | `ContentAsset`, `origin=DJANGO`, no versions |
| 2. Upload a file | `assets.add_assetversion` | Asset versions > Add | Server makes the key, checksums, validates. Pass: `VALIDATED`. Fail: nothing stored, findings shown |
| 3. Preview | View permission | Version page (sandboxed 3D viewer, image thumbnail, native audio player) | Staff check scale, clips, look |
| 4. Publish | `assets.publish_assetversion` | Actions | `PUBLISHED`; the first published version becomes the default |
| 5. Make default or roll back | `assets.publish_assetversion` | Actions | Unpinned references get the new default |
| 6. Retire | `assets.retire_assetversion` | Actions | Stops resolution; refused while a LIVE NPC release, an AVAILABLE player avatar, the LIVE sound release or a PUBLISHED 3D Area uses it (one refusal names every blocker). Shipped scenes, drafts, superseded releases and derived artifacts are listed only (`asset_usage`, "Used by"): [`ASSET_LIBRARY.md`](../ASSET_LIBRARY.md) section 25 |
| 7. Reference | Content author | Content revision, NPC release, sound cue, region seed | Stable id or pin |

Roles come from `manage.py ensure_asset_roles` (viewers, editors, publishers). Every transition is
recorded in Django Admin history. Detail: [`ASSET_LIBRARY.md`](../ASSET_LIBRARY.md) section 21.

## 3. Identifiers

| Identifier | Format | Rule |
|---|---|---|
| Asset id | Slug on `catalog.ContentAsset.asset_id` (for example `npc-pip`, `treasure-chest`) | Stable for life; never reused for a different object. Shares a namespace with the bundled manifest ids, so a published id can replace a bundled one |
| Pinned reference | `<asset id>@<version number>` | Use when an older adventure must keep an exact version |
| Version id | UUID on `AssetVersion` | Server-made; used in keys and cache keys; never typed by people |
| Object key | `assets/<models\|images\|audio>/<asset id>/<version uuid>/<model\|image\|audio>.<format>` | Made only by the server (`object_key`); never appears in game code |
| Sound cue id | `<channel>.<group>.<name>` | Owned by the audio app, see [`audio-standard.md`](audio-standard.md) |
| NPC id | `catalog.NpcDefinition.npc_id` | Owned by the NPC Manager, see [`npc-standard.md`](npc-standard.md) |

## 4. Versioning (`AssetVersion`)

- Each upload is a new immutable version (1, 2, 3...). Identical bytes on the same asset answer
  `duplicate_version`.
- Lifecycle: `DRAFT > VALIDATED | REJECTED`, `VALIDATED > PUBLISHED | REJECTED`,
  `PUBLISHED > RETIRED`, `RETIRED > PUBLISHED` only through rollback after the bytes are
  re-verified. `DRAFT` exists for asynchronous validation; no path creates it today.
- Published and retired versions are never edited or deleted. A definition is never deleted.
- React never chooses a version. Django resolves the default or the pin.
- A running scene keeps what it loaded; new resolutions get the new default.

## 5. Formats and GLB/glTF compatibility

| Kind | Family | Accepted | Size limit (setting) |
|---|---|---|---|
| `character`, `prop`, `collectible`, `kit-piece` | 3D model | `.glb` (glTF 2.0 binary); `.gltf` only if fully self-contained (every buffer and image an embedded `data:` URI) | 50 MB (`LAI_ASSET_MAX_UPLOAD_BYTES`) |
| `texture`, `image`, `sprite` | Image | PNG, JPEG, WebP | 10 MB, 4096 px a side, 16 M pixels |
| `audio` | Audio | MP3, WAV (PCM or float), Ogg (Vorbis or Opus) | 20 MB, mono or stereo, 8 to 96 kHz, 15 minutes |

Not accepted on `main`: external `uri` references, `KHR_draco_mesh_compression`,
`EXT_meshopt_compression`, `KHR_texture_basisu`, FBX, Blender files, archives, SVG, GIF. There is
no conversion pipeline: export browser-ready glTF 2.0 from the authoring tool. Format is read from
the bytes, never the extension. A model over 10 MB deserves a second look before a child's tablet
downloads it ([`THREE_WORLD_ASSET_CONVENTIONS.md`](../THREE_WORLD_ASSET_CONVENTIONS.md),
"Uploaded models").

Authoring conventions (canonical: [`THREE_WORLD_ASSET_CONVENTIONS.md`](../THREE_WORLD_ASSET_CONVENTIONS.md)):

| Topic | Rule |
|---|---|
| Units and axes | 1 unit = 1 metre, +Y up, glTF right-handed. Convert at import, never in the loader |
| Pivot | Ground-pivoted: origin at the base centre so placement sets `y = 0` |
| State variants | One asset per state (for example weathered and repaired), both from the same producer (ADR-028) |
| Gameplay-bearing geometry | Where the geometry is the rule (countable items, graded lengths), it stays generated, not bought (ADR-028) |
| Cloning | Always `cloneAssetScene` (skinned meshes need `SkeletonUtils.clone`); never dispose shared geometry or materials from a scene |

## 6. Materials

| Rule | Detail |
|---|---|
| Generated pack | Texture-free by design; flat materials from the generator |
| Imported models | Embedded textures only (no external texture URI); PNG or JPEG inside the GLB. Embedded WebP (`image/webp`, `EXT_texture_webp`) is refused until end-to-end compatibility (validation, preparation, the engine loader and the target browsers) is demonstrated (owner, 2026-11-22). Standalone `texture`, `image` and `sprite` assets may still be WebP |
| Runtime surfaces | Use the shared material presets and procedural surfaces (`runtime/visual/`, `materialLibrary.ts`): one material and at most one texture per preset per scene, disposed on unmount |
| Quality tiers | LOW, MEDIUM, HIGH (`renderQuality.ts`) change texture size, light budget, pixel ratio and effects. They change appearance only, never gameplay |
| Textures | Non-power-of-two textures get a validation warning; keep textures as small as the view needs |
| Fallback | An unknown preset draws neutral flat colour; an unpaintable texture draws the preset's base colour |

## 7. Animations

- Clip names come only from the shared vocabulary in
  `react/src/features/island-map/three/assets/animationVocabulary.ts`
  (`Idle, Walk, Talk, Wave, Point, Celebrate, ReactHappy, ReactConcerned, Open, Close, Activate`).
  Validation refuses duplicate names. A name outside the vocabulary is allowed with an
  `unknown_clip` warning (owner, 2026-11-22): the version can be published, but the game does
  not play that clip by name until the name joins the vocabulary.
- Implemented (main): Run, Jump, Fall, Land are in the vocabulary for the player avatar
  (LAI-JMP-01a, LAI-JMP-01c), in both `animationVocabulary.ts` and `validation.py`.
- A new version of an asset must keep every clip the asset already declares.
- Strip clips a children's product does not need (combat, weapons) before upload.
- NPCs map their own runtime states (`idle`, `talk`, `wave`...) to clip names through the
  variant's `animationMap`, with fallbacks to `idle`. See [`npc-standard.md`](npc-standard.md).
- One `AnimationMixer` per placed instance. Motion that is decorative stops or simplifies under
  reduced motion.

## 8. Collision geometry

| State | Rule |
|---|---|
| Implemented (main) | Collision is authored data, decoupled from the visual mesh. Authored zones become `Box3` colliders; a mesh's silhouette never silently changes where a child can walk. Built-in per-asset footprints live in the shared runtime |
| Implemented (main) | **Collision profiles**: staff set per asset (or per version) a shape (`None`, `Box`, `Cylinder`, `Capsule`, `Compound boxes`) and a behaviour (`Automatic`, `Solid`, `Jumpable`, `Walkable`, `Decorative`) in Django Admin; the resolver returns them and the shared runtime applies them to every placement ([`ASSET_COLLISION_PROFILES.md`](../ASSET_COLLISION_PROFILES.md)) |
| Owner-approved 2026-11-22, Pending merge (`feature/ge-raised-solid-clearance`, GE-L16) | **Raised Solid parts and walk-under clearance**, the rule below |

Behaviour rules (GE-L16, the shared engine's controller decides; no adventure code):

| Behaviour | Rule |
|---|---|
| `Solid` | Blocks at every height. A part whose bottom is at least the **walk-under clearance** above the ground keeps its height: the child walks under it, a rising head stops at its underside, and it blocks from its underside up. A lower raised part blocks down to the ground. Never stepped or jumped onto |
| `Automatic` | Jumpable when no taller than 1.2 m (the default jump); taller is `Solid`, with the same clearance rule. Height alone never opens a passage |
| `Jumpable` | Blocks only where it is in height; its top is a surface the child can hop onto if the jump reaches it, and walk under if there is headroom. Use it for elevated platforms, decks and walkways |
| `Walkable`, `Decorative` | No collider |

- **Walk-under clearance** = the avatar's collision height plus a margin. The standard avatar's
  collider is 1.7 m (the drawn avatars are about 1.35 to 1.4 m), margin 0 by default; a location
  may add up to 0.5 m with `movement.collision.clearanceMargin`. The gap is measured from the
  ground under the part, after the placement's position and elevation.
- **Width** is the avatar's footprint (0.35 m radius plus a 2 cm skin): a gap between two parts
  narrower than about 0.74 m stays blocked, whatever the headroom.
- **Multi-part profiles** (`Compound boxes`) share one behaviour; each part is classified on its
  own. A building with a doorway: wall parts from 0, a lintel part from 2.0 m or higher.
- **Elevation never makes a part jumpable.** A surface the child should stand on is a `Jumpable`
  profile (or `Automatic` and no taller than 1.2 m); a deck marked `Solid` is not stood on.

| Configuration | Valid? | Result |
|---|---|---|
| Doorway: two wall parts from 0 to 3 m, a lintel part from 2.2 to 2.8 m | Valid | The child walks through under the lintel |
| Lintel part from 1.5 m in a `Solid` profile | Valid but closed | Below 1.7 m: the doorway is blocked at every height |
| Fence part from 0.05 m, 0.9 m tall, `Solid` | Valid | A wall: never hopped over (it was jumpable before GE-L16) |
| Raised deck from 0.6 to 0.8 m, `Solid`, meant to be stood on | Invalid intent | Use `Jumpable`; a `Solid` deck is a wall |
| Sign board from 1.0 m on a 1.0 m post, `Automatic` (1.8 m in all) | Valid | `Solid`; the board blocks down to the ground, no gap |
| A box with its top below its bottom, or a missing size | Invalid | Refused in Django Admin; the client also refuses it and keeps the built-in default |

`python manage.py collision_clearance_audit` lists every published profile with a raised Solid
part and how the rule treats it (read-only).

Rules: an adventure never adds its own physics engine or per-scene collision system. A jumpable
obstacle is never the only way to finish an adventure (see [`jumping-standard.md`](jumping-standard.md)).
Movement, jumping and footprint decisions on open branches are Pending merge.

## 9. Validation

All validation is server-side (`apps/assets/validation.py`, `validation_media.py`). It reads
within limits, executes nothing and follows no URI. Checks include format by signature, size, GLB
header and chunk layout, glTF `asset.version == "2.0"`, buffer and accessor bounds,
embedded-only resources, supported extensions, mesh, node and accessor limits, a default scene with
geometry, clip names, bounding box, kind and family match, PNG CRCs, trailing data (polyglot
files), and SHA-256 re-verified on publish, rollback, preview and verify. Any error means
`REJECTED`. Adventure tests must not re-implement these checks; they rely on the published
resolver contract ([`ASSET_LIBRARY.md`](../ASSET_LIBRARY.md) section 21.7).

## 10. Licensing

- The ledger is [`ASSET_LICENCES.md`](../ASSET_LICENCES.md). It covers every third-party file:
  models, fonts, icons, audio, reference images.
- Prefer CC0. A CC-BY asset requires a parent-reachable attribution surface built in the same
  change (ADR-028); none exists today.
- Source archives stay out of Git (`assets/*.zip` is ignored); their SHA-256 is recorded in the
  ledger so a re-download can be verified.
- The Django Asset Library does not yet model licence or source fields
  ([`ASSET_LIBRARY.md`](../ASSET_LIBRARY.md) section 16). Until it does, a third-party file
  uploaded through Django Admin still needs its ledger row, added in the same change that
  references it.
- Never use `docs/images/` reference images in the product.

## 11. Binary files in Git

**What the repository holds (audit of `main`, 2026-11-18).** There is no `.gitattributes` and no
Git LFS tracking. 157 tracked files match `.glb`, `.gltf`, `.mp3`, `.ogg`, `.wav` or `.png`:

| Location | Count | What |
|---|---|---|
| `react/public/models/` | 121 (116 `.gltf`, 5 `.glb`) | Generated pack from `npm run assets:generate` and normalised CC0 imports from `npm run assets:import-kenney` / `assets:import-characters` |
| `docs/qa/` | 33 `.png` | QA evidence screenshots |
| `docs/images/` | 1 `.png` | Art-direction reference, not shipped |
| `lai/apps/users/tests/fixtures/` | 1 `.png` (plus 3 `.jpg`) | Photo upload test fixtures |
| `content/models/` | 1 `.glb` | `npc-pip-pirate.glb`, input to `manage.py add_pip_pirate_variant` |

No audio file is committed. Two self-hosted fonts (`react/public/fonts/*.woff2`) are also tracked.

**Rule.** Do not commit a new binary file unless one of these existing policies explicitly allows
it, or the owner approves it in the ticket:

| Allowed by | What it allows |
|---|---|
| [`THREE_WORLD_ASSET_CONVENTIONS.md`](../THREE_WORLD_ASSET_CONVENTIONS.md) "Regenerating the pack" | Regenerated `.gltf` output of `scripts/generate-world-assets.ts` in `react/public/models/` ("regenerate and commit") |
| `.gitignore` comment above `assets/*.zip`, and [`ASSET_LICENCES.md`](../ASSET_LICENCES.md) | Normalised files written by the import scripts into `react/public/models/`, each with a ledger row |

Everything else (new models, textures, audio, screenshots, fixtures) goes through the Asset
Library or needs owner approval. ADR-030 already records that uploaded models need "a home that is
not the Git repository"; ADR-035 and ADR-045 make that home the Asset Library. Adding files under
`react/public/models/` also has release consequences ([`release-policy.md`](../engineering/release-policy.md)).

## 12. Publication and delivery

- Only a `PUBLISHED` version of an `ACTIVE` definition resolves.
- Resolver: `GET /api/v1/children/<child_id>/assets/?ids=a,b@2` (parent's Cognito token,
  child-scoped, up to 100 ids). Answers per reference are `resolved`, `unavailable` or `retired`.
  Never returned: drafts, validation reports, keys, buckets, uploaders.
- Delivery mode `django` (default and the production choice): a signed, self-authorizing URL
  re-checked on every fetch, so retirement takes effect at once. `s3` (presigned) mode exists but
  is not the chosen mode. Signed CloudFront delivery (AM-11) is deferred.
- Consistency rules (default changes, pins, retirement, expiry): [`ASSET_LIBRARY.md`](../ASSET_LIBRARY.md) section 9.

## 13. Storage: local development versus S3

| Setting `LAI_ASSET_STORAGE` | Where | Use |
|---|---|---|
| `local` | `lai/.asset-storage/` (ignored by Git) | Local development |
| `memory` | Process memory | Unit tests; nothing touches AWS |
| `s3` | Private bucket, keys under `assets/models/`, `assets/images/`, `assets/audio/`; `IfNoneMatch="*"` so a key is never overwritten | Deployed environments |

The asset bucket and its IAM policy are defined in `infra/` (synthesized) but **not deployed**;
deploying them and hosting Django are owner-approval steps (AM-16 open). Never create, change or
delete AWS resources from an adventure task. `manage.py asset_storage_audit` finds orphans.

## 14. Placeholders and fallbacks

Resolution order for a model id: published Django version, else the bundled file for that id
(`react/public/models/`), else the TR-7a placeholder (a primitive box sized for the object; NPCs
get a stand-in box under their root until the model arrives). The reason is reported through the
resolver's issue hook (`not-published` or `request-failed`), never as a child-facing error. A
build without the Django API plays on bundled files. An adventure spec must name the placeholder
behaviour for every required asset.

## 15. Rendering performance

No project-wide numeric performance budget is approved. Each adventure states its own budget in
its specification ([`templates/adventure-specification.md`](templates/adventure-specification.md))
and measures against it on a target tablet. Existing limits and tools:

| Tool or limit | Where |
|---|---|
| Instancing (one draw call per repeated kit piece) | [`THREE_WORLD_ASSET_CONVENTIONS.md`](../THREE_WORLD_ASSET_CONVENTIONS.md) "Instancing" |
| LOD pairs only with a measured reason | Same doc, "LOD variants" |
| Quality tiers, LOW auto-selected on small devices | `renderQuality.ts` |
| Loader cache: one load per id, failures not cached | "Runtime loading, cloning and the cache" |
| Upload limits (50 MB model, 10 MB image, 20 MB audio) | Section 5 |

Load only the assets the current Area needs, dispose scene-owned resources on exit, and never
block the first frame on an optional asset.

## 16. Optimization (Proposed only)

Meshopt, Draco and KTX2 are **not approved for runtime on `main`**: the validator refuses those
extensions and the loader has no decoders configured. GLB optimization (meshopt, Draco, KTX2) is a
separately tracked workload (LAI-LAMBDA-010) on branches (`feature/lambda-meshopt-ktx2`, with a
branch-only proposal numbered ADR-070, which collides with another branch and is Reserved). A
native-tool container needs its own ADR first ([`CANONICAL_PATH.md`](../processing/CANONICAL_PATH.md)).
Do not ship optimized or compressed assets until an accepted ADR and a merged change allow them.

## 17. Artifact processing architecture

| Item | State |
|---|---|
| One canonical background path: `apps.jobs.ProcessingJob`, SQS work queues (`ai`, `media`), zip-packaged arm64 Lambda workers with no database access, transactional outbox, one results consumer | Implemented (main), ADR-064 (amends ADR-061, ADR-062). Not deployed |
| `asset.inspect` job: read-only metadata on the job, never rewrites a version's metadata | Implemented (main), `apps/assets/jobs.py` |
| `asset.validate_model`, `reference.checksum`, asynchronous validation behind `LAI_ASSET_ASYNC_VALIDATION` (approved, default off) | To re-land on the canonical path; LAI-LAMBDA-002 and 004 open |
| Derived artifacts (thumbnails, image conversion, audio transcoding, GLB optimization) | Pending, on branches and proposals only (`feature/lambda-derived-artifacts` and related; Reserved ADR-066 to ADR-071). Not merged; not approved for runtime |

An adventure never adds its own queue, worker, bucket or processing service. Derived files, when
they exist, will be versions or artifacts of the canonical asset, never a second store.

## 18. Checklist for an adventure's assets

- [ ] Every asset is referenced by stable id or pin; no URLs or keys in code or content.
- [ ] Every required asset has a named placeholder or bundled fallback.
- [ ] Every third-party file has a ledger row; CC-BY only with an attribution surface.
- [ ] No new binary committed outside section 11, or owner approval recorded on the ticket.
- [ ] Clip names from the shared vocabulary (an unknown name is a warning, never relied on);
  NPC animation maps set.
- [ ] Collision from authored data (or merged collision profiles), never from mesh silhouettes.
- [ ] Performance budget stated in the adventure specification and measured.
- [ ] No Meshopt, Draco or KTX2 content.
- [ ] No new asset store, resolver, uploader, worker or bucket.
