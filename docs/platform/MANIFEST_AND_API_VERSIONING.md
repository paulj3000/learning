# Content Manifest and API Versioning Design (Phase 39)

Covers `docs/android/android.md` Phase 10 ("Content Manifest and
Incremental Updates") and Phase 11 ("API Versioning"), scoped per ADR-014
in `docs/DECISIONS.md`. **This is a design document, not an
implementation.** No `ContentManifest` model, no platform-configuration
query, and no version field is added to `amplify/data/resource.ts` this
phase.

## 1. Why both are blocked on work that has not happened yet

A content manifest's entire purpose (`docs/android/android.md` Phase 10)
is letting a client compare its local content version against the
server's and download only what changed. That only means something once
content actually *has* a server-side version to compare against. Phase 36
(`docs/platform/CANONICAL_CONTENT_MODEL.md`) and Phase 38
(`docs/platform/WORLD_ITEM_AND_ASSET_MODEL.md`) both designed target
schemas for curriculum, item, world, and asset content — and both
deliberately did not migrate anything, per ADR-011/ADR-013. Every one of
`lessons`/`stories`/`quests`/`worlds`/`zones`/`assets`/`NPC dialogue`/
`reward definitions` that android.md's example manifest lists version
numbers for is still a plain TypeScript module today, with no version
number of its own beyond `AdventureDefinition.version` and
`CoopSession.templateVersion` (both authored, hand-bumped integers already
compiled into the client bundle, not a fetchable manifest a client
compares before downloading anything). A `ContentManifest` built today
would have nothing real to version.

API versioning (`docs/android/android.md` Phase 11) exists to protect an
*installed* client from a backend response-format change while it sits on
a device for months without updating — the roadmap's own words for why:
"unlike the website, Android versions may remain installed for months."
There is no such installed client yet. The web client redeploys to
`main` on every merge and never has a "stale installed version" to
protect; building version-negotiation infrastructure with zero consumers
has a real (if small) ongoing cost — a model or config value someone has
to keep updated and no client that reads it — and no current benefit.

Both therefore stay design-only here, the same call ADR-011/ADR-013 already
made for content and asset migration, for the same reason: record the
target shape now so a future phase has something concrete to build against,
without paying the cost before a real second client exists to need it.

## 2. Proposed `ContentManifest` shape

```ts
ContentManifest: a.model({
  manifestVersion: a.integer().required(),
  /** One version counter per content type this schema eventually ships. */
  curriculumSchemaVersion: a.integer().required(),  // Skill/Subject/Grade/Domain — CANONICAL_CONTENT_MODEL.md
  itemSchemaVersion: a.integer().required(),         // ItemDefinition — WORLD_ITEM_AND_ASSET_MODEL.md
  worldSchemaVersion: a.integer().required(),         // WorldDefinition/WorldContentPack
  assetSchemaVersion: a.integer().required(),         // AssetCatalogEntry
  generatedAt: a.datetime().required(),
}),
```

A single row, read-only to every authenticated client (`PUBLIC` or
`AUTHENTICATED`, section 0 of `docs/AUTHORIZATION_REVIEW.md` — it carries
no child-specific data). Each `*SchemaVersion` field is bumped by whatever
future migration/admin workflow writes to that content type; a client
compares its last-seen value per field and re-fetches only the content
types that moved, per android.md's own "Android Flow" diagram. This
product's content is currently split across four independent designs
(curriculum, item, world, asset) rather than one monolith, so a per-type
version counter fits the existing shape better than a single global
number would.

**Not designed here**: the actual delta-fetch query shape (`AWSJSON`
diff, paginated list, or per-type "list changed since version N" query),
since that depends on how a future migration actually stores versioned
content — designing the transport before the storage exists would likely
guess wrong.

## 3. Proposed platform configuration shape

```ts
PlatformConfig: a.query()
  .returns(a.customType({
    apiVersion: a.integer().required(),
    minimumAndroidVersion: a.string(),   // null until an Android build exists
    recommendedAndroidVersion: a.string(),
    minimumWebVersion: a.string(),       // likely always null — see section 1
    contentManifestVersion: a.integer().required(),
  }))
  .authorization((allow) => [allow.authenticated()]),
```

A static/near-static read, not tied to any model. `minimumAndroidVersion`/
`recommendedAndroidVersion` have no meaningful value until an Android
build is actually released (CLAUDE.md section 12 keeps that out of scope
until separately approved) — this document records the shape so that
release, whenever it happens, has a field to populate rather than a schema
change to make under time pressure.

**Not designed here**: the actual backward-compatibility strategy for a
breaking API change ("new API version or backward-compatible resolver",
android.md's own wording) — there is no released API contract to break
yet, so writing that policy now would be speculative rather than grounded
in a real compatibility incident.

## 4. What this document does not do

- It does not add `ContentManifest`, `PlatformConfig`, or any version
  field to `amplify/data/resource.ts`.
- It does not change any content module or asset file.
- It does not design the delta-fetch transport or the API
  backward-compatibility policy — both are explicitly deferred, for the
  reasons given above, to whichever future phase actually has versioned
  content and a released client to design against.
