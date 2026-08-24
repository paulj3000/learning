# World, Item, and Asset Model Design (Phase 38)

Covers `docs/android/android.md` Phases 7-9 ("Inventory and Reward
Platform", "Shared World Definition", "Shared Asset Catalog"), scoped down
per ADR-013 in `docs/DECISIONS.md` — same "design the target schema,
migrate nothing yet" treatment Phase 36 already applied to the curriculum
content model in `docs/platform/CANONICAL_CONTENT_MODEL.md`, extended here
to items, world/zone/NPC placement, and the 3D asset catalog. **This is a
design document, not a migration.** No model in `amplify/data/resource.ts`
changes, no content moves out of TypeScript, and no asset moves to S3.

## 1. Why this is design-only, same as Phase 36

`docs/DECISIONS.md` ADR-009 already decided "a world is a content pack,
not a code path or a second identity," and ADR-011 already established
that migrating content into live Amplify Data models before there is a
real second client to read it buys nothing and costs real things (runtime
latency, a still-nonexistent admin content-authoring workflow). Nothing
about items, worlds, zones, NPCs, or assets changes that reasoning — see
ADR-013 for the specific decision record.

Two things are explicitly **not** this document's job, despite
`docs/android/android.md` Phase 7's own acceptance criteria listing them:

- **"Inventory changes are server-authoritative."** This is `ChildInventory`
  writes (`grantRewards`, `src/features/rewards/api.ts`) — one of the five
  `NEEDS_MIGRATION` write paths `docs/platform/CURRENT_PLATFORM_AUDIT.md`
  catalogued and `docs/DECISIONS.md` ADR-012 explicitly deferred as Phase
  37's own remaining backlog. Folding it into Phase 38 under a different
  name would duplicate that already-tracked item rather than close it, and
  — unlike `submitAdventureAnswer` — a reward grant's legitimacy currently
  depends on quest/discovery/NPC state that is *itself* not yet
  server-verified, so it is not the well-isolated next pilot Phase 37's
  `submitAdventureAnswer` was. It stays exactly where ADR-012 already put
  it.
- **Uploading assets to S3.** No GLB/texture/audio file moves anywhere in
  this phase.

## 2. Mapping android.md's generic models onto this product

| android.md concept | This product's equivalent | Status |
|---|---|---|
| `ItemDefinition`, `PlayerInventoryItem` | `ItemDefinition` (`src/features/rewards/types.ts`, content) + `ChildInventory` (Amplify Data, `ownedItemIds`) | Inventory *state* is already `SHARED_DATA` (Phase 35 audit) — only the item *catalog* is TypeScript-only |
| `WorldDefinition`, `ZoneDefinition`, `LocationDefinition` | `WorldDefinition` + `WorldContentPack` (`src/features/worlds/types.ts`), `IslandLocation` (`src/features/island/locations.ts`) | Content, source-controlled, already manifest-shaped (section 4) |
| `NPCDefinition` | Split across **three** representations (section 5) — not unified today |
| Asset catalog | `ASSET_MANIFEST` (`src/features/island-map/three/assets/manifest.ts`) → `public/models/*.gltf` | Already asset-ID-indirected (section 6); not yet centralized or device-variant-aware |

## 3. `ItemDefinition`: two android.md fields conflict with product design, not just naming

`ItemDefinition` (`src/features/rewards/types.ts`) already exists as
authored content with `id`, `displayName`, `description`, `category`,
`rarity`, optional `setId`/`hidden`/`cosmeticSlot`. Two fields
`docs/android/android.md` Phase 7 suggests do not fit, for the same
category of reason ADR-011 already rejected level/XP/coins — not an
oversight to correct, a mechanic this product's own design already rules
out:

- **`rarity` as a drop rate.** `ItemRarity` already exists here, but its
  own doc comment is explicit: "emphatically NOT a drop chance, a power
  tier, or a status rank" — nothing in `rewardTable.ts` reads it when
  deciding what to grant (asserted by test), because every grant is
  deterministic (CLAUDE.md pillar 7, "no loot-box mechanics"). A canonical
  schema keeps `rarity` as a descriptive display-grouping field only, never
  a probability.
- **`stackable`/`tradable`.** This product's inventory has no quantity (an
  item is owned or not — `rewardTable.ts`'s own doc comment: "there is no
  currency and no sink, so no child can be made to feel poorer than
  another") and no trading feature exists or is planned. Neither field is
  proposed.

Proposed model (illustrative, not added to the schema this phase):

```ts
ItemDefinition: a.model({
  slug: a.string().required(),        // stable content id — see CANONICAL_CONTENT_MODEL.md's slug/id note
  displayName: a.string().required(),
  description: a.string().required(),
  category: a.string().required(),    // 'COLLECTIBLE' | 'COSMETIC' | 'QUEST_ITEM' | 'KEEPSAKE'
  rarity: a.string().required(),      // descriptive only, never read by grant logic
  setId: a.string(),
  hidden: a.boolean(),
  cosmeticSlot: a.string(),
  contentVersion: a.integer().required(),
}),
```

`ChildInventory` itself needs no schema change: `ownedItemIds`/
`grantedRuleIds` already reference items by the same stable string id this
model's `slug` would carry.

## 4. World/zone content is already a manifest — `WorldContentPack` is the android.md "content packaging" concept, already built

`WorldDefinition` and `WorldContentPack` (`src/features/worlds/types.ts`)
already are, in substance, what `docs/android/android.md` section
"Content Pack Manifest" and Phase 8's `WorldDefinition` ask for: a world
lists every location/adventure/quest/item/set/NPC/discovery/story slug it
owns, `validateWorldContentPack` refuses a pack naming content that does
not exist, and `packs.test.ts` asserts the union of packs covers the whole
authored registry exactly once. A canonical `WorldDefinition`/
`WorldContentPack` model would carry the same fields already defined in
`src/features/worlds/types.ts`, unchanged in shape — this is closer to "add
a database mirror of an already-correct design" than "design something
new."

## 5. NPCs: three representations today, not one — this is the phase's real finding

Unlike items and worlds, NPCs do **not** have one canonical shape today.
Three separate, differently-purposed types share the name "NPC" or
overlapping ids, joined only by string-id cross-references, never unified:

1. **Domain NPC** (`src/features/npc/types.ts`'s `NpcDefinition`) — who
   this character is: `displayName`, `role`, `homeLocationSlug`, `schedule`,
   `dialogue`, `questOffers`. No position, no visual data. Joined to a
   world object via `interactionId`.
2. **2D placement NPC** (`src/features/island-map/npcs.ts`'s own, separate
   `NpcDefinition`) — pixel-space spawn position and Phaser sprite palette
   (`NpcPalette`), joined to `WELCOME_HARBOR_INTERACTIONS` via the same
   `interactionId` string.
3. **3D placement** (`src/features/island-map/three/welcomeHarborRegion.ts`,
   `pirateBuilderBayRegion.ts`) — a third, independent placement
   representation for the two locations migrated to Three.js so far.

Only two of the ten island locations (Welcome Harbor, Pirate Builder Bay —
Phases 32-33) have a Three.js region at all; the rest still have only the
2D Phaser-era zone files (`src/features/island-map/*Zones.ts`, 7 files).
This means `docs/android/android.md` Phase 8's own acceptance criterion —
"the same zone definition can be interpreted by both clients" — is not yet
true even *between this product's own two existing web renderers*, let
alone for a third, Android one. A canonical `NPCDefinition`/
`ZoneDefinition` would need to either (a) unify all three representations
behind one platform-neutral placement model that each renderer projects
into its own coordinate system, or (b) accept that placement stays
renderer-specific content forever and only the *domain* NPC (dialogue,
schedule, quest offers — already dialogue/logic, not geometry) is shared.
This document does not resolve that choice; it is the concrete question
whichever future phase attempts this migration needs to answer first,
surfaced here rather than discovered mid-migration.

## 6. Asset catalog: the hard part (asset-ID indirection) is already done; centralization and device variants are not

`ASSET_MANIFEST` (`src/features/island-map/three/assets/manifest.ts`)
already satisfies `docs/android/android.md` Phase 9's core rule —
"referenced by clients through an asset ID rather than a hardcoded path":
every caller resolves an asset by `id` through `getAssetManifestEntry`,
never a raw URL, and `manifest.test.ts` is an authoring check that every
entry actually resolves to a generated file. What is genuinely missing:

- **Not centralized in S3.** Every asset is a `.gltf` file under Vite's
  `public/models/`, served as a static web asset — there is no `assets/`
  S3 structure, and nothing here is set up for a non-web client to fetch
  independently of this specific web deployment.
- **No device-quality variants.** `AssetLodLevel` already exists for
  render-distance LOD swapping (a rendering concern, decided by the
  client), but there is no `-high`/`-medium`/`-low` device-capability
  variant concept — every client gets the same asset today.
- **GLB, not glTF, for android.md's own suggested format** — a minor,
  low-risk difference (both are consumed by the same three.js `GLTFLoader`
  family; Android's typical native pipeline more commonly expects binary
  `.glb`), worth noting for whoever picks this up rather than silently
  assuming one implies the other.

Proposed model (illustrative; a real migration would also need an S3
upload/build step this document does not design):

```ts
AssetCatalogEntry: a.model({
  slug: a.string().required(),   // matches today's ASSET_MANIFEST id
  kind: a.string().required(),   // AssetKind
  s3Key: a.string().required(),  // e.g. 'assets/props/rope-coil-medium.glb'
  qualityVariant: a.string(),    // 'high' | 'medium' | 'low', absent for a single-variant asset
  clips: a.string().array(),
}),
```

## 7. What this document does not do

- It does not add any model to `amplify/data/resource.ts`.
- It does not change `src/features/rewards/`, `src/features/worlds/`,
  `src/features/npc/`, `src/features/island-map/`, or
  `src/features/island-map/three/assets/` — all remain the live source of
  truth today.
- It does not resolve section 5's three-representations-of-an-NPC
  question, or design the S3 upload/build pipeline section 6 would need.
- It does not touch `ChildInventory`'s write path — that is
  `docs/DECISIONS.md` ADR-012's tracked follow-up under Phase 37, not this
  phase's job.
