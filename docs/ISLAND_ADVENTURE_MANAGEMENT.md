# Learning Adventure Island — Admin Islands & Adventures Roadmap

> **Status (2026-09-27):** implemented as an admin catalog overlaid on the
> source-controlled islands and adventures; see `docs/DECISIONS.md` ADR-024
> for how this spec was adapted to the existing architecture, and
> `docs/IMPLEMENTATION_STATUS.md` for what is built and what is not yet
> deployed.

## Purpose

Implement an administrative management system for **Islands** and **Adventures** in Learning Adventure Island.

Use the following terminology consistently throughout the UI, backend, data model, and documentation:

- **Island** — a major world location/region, such as Dragon's Sanctuary, Pirate Bay, Clockwork Harbor, Wonderwild Forest, or Storykeeper Castle.
- **Adventure** — a playable storyline/learning experience associated with an Island.

The admin system must allow authorized administrators to create, inspect, activate, and deactivate Islands and Adventures. Superusers receive additional destructive permissions.

---

# 1. Goals

Build an admin experience that supports:

1. Listing all Islands.
2. Creating Islands.
3. Activating/deactivating Islands.
4. Opening an Island and listing all Adventures assigned to it.
5. Creating Adventures and assigning them to an Island.
6. Opening an Adventure detail page.
7. Viewing the Adventure description.
8. Viewing the 3D models/assets associated with an Adventure.
9. Activating/deactivating Adventures.
10. Allowing **Superusers only** to delete Adventures.
11. Exposing an **Admin** link in the authenticated-user navbar dropdown only when the user has admin access.
12. Returning the normal application **404 page** when a non-admin attempts to access an admin URL.
13. Enforcing every permission on the backend in addition to the UI.

---

# 2. Recommended Admin URL Structure

Use `/admin` as the root of all administrative functionality.

```text
/admin
/admin/islands
/admin/islands/new
/admin/islands/:islandId
/admin/islands/:islandId/edit
/admin/islands/:islandId/adventures/new
/admin/adventures
/admin/adventures/:adventureId
/admin/adventures/:adventureId/edit
```

Existing admin functionality, such as character/model management, should remain under its appropriate `/admin/...` hierarchy.

Suggested main admin navigation:

```text
Admin
├── Dashboard
├── Islands
│   └── Island Detail
│       └── Adventures
├── Adventures
└── Characters / Models
```

Do not create separate unrelated administration systems for Islands and Adventures. They should be part of the existing `/admin` experience.

---

# 3. Authorization Model

## 3.1 Roles

Use the project's existing authorization/role mechanism where possible. Do not introduce a second role system if one already exists.

At minimum support:

### Admin

Can:

- Access `/admin`.
- List Islands.
- Create Islands.
- View Island details.
- Activate/deactivate Islands.
- List Adventures.
- Create Adventures.
- View Adventure details.
- Edit Adventures.
- Activate/deactivate Adventures.
- View models assigned to Adventures.

Cannot:

- Delete Adventures unless explicitly granted that permission by the existing authorization system.

### Superuser

A Superuser has **all administrative permissions**.

In addition to normal Admin capabilities, a Superuser can:

- Delete Adventures.

If the application already defines Superuser semantics, integrate with those semantics rather than creating a duplicate flag.

---

# 4. Authorization Must Be Enforced Server-Side

Hiding buttons in React is not sufficient authorization.

All admin mutations and sensitive queries must verify permissions in the backend/API layer.

Examples:

```text
createIsland       -> Admin or Superuser
updateIsland       -> Admin or Superuser
setIslandActive    -> Admin or Superuser
createAdventure    -> Admin or Superuser
updateAdventure    -> Admin or Superuser
setAdventureActive -> Admin or Superuser
deleteAdventure    -> Superuser ONLY
```

A user must not be able to bypass authorization by manually calling an Amplify Data mutation, Lambda, REST endpoint, GraphQL operation, or other backend interface.

Reuse the project's existing Amplify Gen 2/Cognito authorization conventions.

---

# 5. Navbar Admin Link

Update the authenticated user's dropdown menu in the main navigation bar.

If the current user has permission to access the admin system, display:

```text
Account
Admin
Sign Out
```

`Admin` should navigate to:

```text
/admin
```

If the user does **not** have admin access:

- Do not display the Admin menu item.
- Do not leave an empty separator or visual gap where Admin would normally appear.

Determine access from the authoritative user/role information already used by the application. Do not rely on a client-controlled localStorage flag.

---

# 6. Admin Route Protection and 404 Behavior

All `/admin` routes must be protected.

## Authorized User

Allow the route to render normally.

## Unauthorized User

If an authenticated user without admin access manually enters something such as:

```text
/admin
/admin/islands
/admin/islands/123
/admin/adventures/456
```

the application must render the application's standard **404 / Page Not Found** experience.

Do **not** render:

```text
Not Authorized
Access Denied
Forbidden
You do not have permission to view this page
```

The goal is to avoid exposing the existence or structure of administrative pages to unauthorized users.

Where practical, backend responses should follow the same information-disclosure principle. Do not return sensitive admin data and rely on the frontend to hide it.

Create/reuse a centralized route guard, for example:

```tsx
<AdminRoute>
  <AdminPage />
</AdminRoute>
```

Conceptual behavior:

```text
loading auth -> show normal loading state
admin/superuser -> render admin route
not admin -> render standard 404
```

Avoid redirect loops and avoid briefly rendering admin content while authorization is loading.

---

# 7. Island Data Model

First inspect the existing Amplify Gen 2 schema and reuse/extend existing models if Island/Region concepts already exist.

Do not create duplicate models representing the same concept.

If a dedicated model is required, the conceptual structure is:

```ts
Island {
  id
  slug
  name
  shortDescription
  description
  active
  sortOrder
  thumbnailKey
  createdAt
  updatedAt
}
```

Recommended fields:

### `name`

Human-readable name.

Examples:

```text
Dragon's Sanctuary
Pirate Bay
Clockwork Harbor
Wonderwild Forest
Storykeeper Castle
```

### `slug`

Stable URL/code identifier.

Example:

```text
dragons-sanctuary
pirate-bay
clockwork-harbor
```

Do not silently change the slug whenever the display name changes if other records or URLs depend upon it.

### `active`

Controls whether the Island is available to normal users.

Inactive Islands remain visible to authorized administrators.

### `sortOrder`

Allows administrators/developers to control Island ordering without depending on creation date or alphabetical order.

---

# 8. Adventure Data Model

Inspect existing Adventure/story/chapter models before changing the schema.

If an Adventure model already exists, extend it rather than creating a parallel concept.

Conceptually:

```ts
Adventure {
  id
  islandId
  slug
  name
  shortDescription
  description
  active
  sortOrder
  thumbnailKey
  createdAt
  updatedAt
}
```

Each Adventure belongs to an Island.

Relationship:

```text
Island 1 ---- * Adventure
```

An Island can contain many Adventures.

An Adventure belongs to one Island unless existing architecture explicitly supports Adventures appearing in multiple Islands. Do not introduce many-to-many behavior unless required by existing product decisions.

---

# 9. Adventure Models / Assets

An Adventure detail page must display the models associated with that Adventure.

First inspect the existing asset/model architecture. The project already uses S3 for model assets; reuse those records and S3 keys instead of duplicating model metadata inside Adventure.

Prefer a relationship/join model if assets can be shared between Adventures.

Conceptual example:

```ts
AdventureModel {
  id
  adventureId
  modelId
  role
  sortOrder
  createdAt
}
```

Where `modelId` references the existing character/model/asset record.

This permits the same model to be reused across multiple Adventures without copying the GLB/GLTF asset.

Possible model roles could include existing project categories or, if needed later:

```text
NPC
CREATURE
CHARACTER
PROP
BUILDING
ENVIRONMENT
INTERACTIVE_OBJECT
```

Do not invent a competing asset taxonomy if one already exists.

---

# 10. Admin Islands List

Create:

```text
/admin/islands
```

The page should list **all Islands**, including inactive Islands.

Suggested table:

| Island | Status | Adventures | Updated | Actions |
|---|---|---:|---|---|
| Dragon's Sanctuary | Active | 4 | ... | View / Deactivate |
| Pirate Bay | Active | 3 | ... | View / Deactivate |
| Clockwork Harbor | Inactive | 5 | ... | View / Activate |

Provide a clear:

```text
Create Island
```

button.

Clicking the Island name or View action opens:

```text
/admin/islands/:islandId
```

Do not hide inactive Islands from administrators.

---

# 11. Create Island

Create:

```text
/admin/islands/new
```

Minimum form:

```text
Name
Slug
Short Description
Description
Active
Sort Order
Thumbnail / Image (if supported by existing asset system)
```

Validate required fields.

Prevent accidental duplicate slugs.

After successful creation, navigate to the new Island's detail page and show the project's normal success notification/toast.

---

# 12. Island Detail Page

Create:

```text
/admin/islands/:islandId
```

Display:

```text
Island Name
Status: Active / Inactive
Description
Metadata
```

Provide actions appropriate to the user's permissions:

```text
Edit Island
Activate Island
Deactivate Island
Create Adventure
```

Below the Island information, display:

```text
Adventures
```

List every Adventure belonging to the Island, including inactive Adventures.

Example:

| Adventure | Status | Models | Updated |
|---|---|---:|---|
| The Lost Dragon Egg | Active | 12 | ... |
| Cavern of Numbers | Inactive | 8 | ... |
| Flight School | Active | 6 | ... |

Each Adventure name must be clickable and navigate to:

```text
/admin/adventures/:adventureId
```

Include a clear:

```text
Create Adventure
```

button that creates an Adventure already associated with the current Island.

---

# 13. Adventure List

Also provide a global Adventure management page:

```text
/admin/adventures
```

This makes it possible for an administrator to manage Adventures without first navigating through an Island.

Suggested columns:

| Adventure | Island | Status | Models | Updated | Actions |
|---|---|---|---:|---|---|

Useful controls:

```text
Search
Filter by Island
Filter by Active / Inactive
```

Every Adventure must be clickable.

---

# 14. Create Adventure

An Adventure may be created from either:

```text
/admin/adventures
```

or an Island detail page.

Minimum fields:

```text
Island
Adventure Name
Slug
Short Description
Description
Active
Sort Order
Thumbnail / Image (if supported)
```

When launched from an Island detail page, preselect that Island.

Validate that the selected Island exists and that the current administrator has permission to perform the mutation.

---

# 15. Adventure Detail Page

Create:

```text
/admin/adventures/:adventureId
```

The page should clearly show:

```text
Adventure Name
Island
Status
Short Description
Full Description
Models
Created
Last Updated
```

The Island name should link back to its admin detail page.

Provide appropriate actions:

```text
Edit Adventure
Activate
Deactivate
Delete Adventure   <-- Superuser only
```

Only display actions that the current user is allowed to perform.

---

# 16. Adventure Model List

On the Adventure detail page, add a **Models** section.

Display the models/assets currently associated with the Adventure.

Suggested information:

| Model | Type / Role | Asset Status | Actions |
|---|---|---|---|
| Dragon Elder | NPC | Available | View |
| Baby Dragon | Creature | Available | View |
| Castle Gate | Prop / Environment | Available | View |

Where existing model administration supports a model detail page, make the model clickable and link to the existing `/admin/characters/...` or model-management route rather than building a duplicate model viewer.

The first implementation requirement is **viewing the list of models used by the Adventure**. Assignment/removal controls can be added here if the existing asset architecture makes that appropriate, but do not duplicate the existing model-management system.

---

# 17. Activate / Deactivate Behavior

Both Islands and Adventures need an explicit active state.

Use an `active` boolean or the project's equivalent existing status mechanism.

## Deactivating an Adventure

When an Adventure is inactive:

- Normal users should not be able to start it.
- It should not appear in normal playable Adventure listings unless the product intentionally displays "Coming Soon" content.
- Existing progress/history should NOT be deleted.
- Admins can still view and edit it.

## Deactivating an Island

When an Island is inactive:

- Normal users should not be able to enter/access it.
- Its Adventures should not become playable merely because an Adventure's own `active` flag is true.
- Do not automatically overwrite every child Adventure's active flag.

Effective availability should be conceptually:

```ts
isAdventurePlayable = island.active && adventure.active
```

This preserves each Adventure's individual configuration if the Island is later reactivated.

---

# 18. Delete Adventure — Superuser Only

Only Superusers can delete Adventures.

Normal Admin users must not see the Delete action.

The backend must independently enforce Superuser authorization.

Before deletion, display a destructive confirmation dialog such as:

```text
Delete Adventure?

You are about to delete "The Lost Dragon Egg".
This action may permanently remove the Adventure configuration.

Cancel | Delete Adventure
```

Do not delete immediately from a single button click.

Before implementing physical deletion, inspect relationships such as:

```text
Child progress
Adventure progress
Quest progress
Model assignments
Analytics/events
Achievements
Rewards
Story/chapter records
```

If Adventure records are referenced by user history, prefer a safe deletion strategy appropriate to the existing schema (for example, preventing deletion when dependent progress exists, or using archival/soft-delete semantics).

Do **not** cascade-delete children's historical learning/progress records without an explicit architectural decision.

---

# 19. Island Deletion

Island deletion is **not part of this requirement**.

Do not add Island deletion merely because Adventure deletion exists.

For now, administrators can deactivate an Island.

This prevents accidentally destroying an Island and all of its associated Adventures.

---

# 20. Loading, Empty and Error States

Every admin screen should support proper states.

Examples:

### No Islands

```text
No islands have been created yet.
Create your first island.
```

### Island With No Adventures

```text
No adventures have been created for this island yet.
```

### Adventure With No Models

```text
No models are currently assigned to this adventure.
```

Use the project's existing loading indicators, toast system, confirmation components, error handling, and styling conventions.

---

# 21. Audit Information

Where practical, retain/display:

```text
createdAt
updatedAt
createdBy
updatedBy
```

For destructive actions, especially Adventure deletion, consider recording an administrative audit event if the project already has or plans an audit/event system.

Useful event examples:

```text
ISLAND_CREATED
ISLAND_ACTIVATED
ISLAND_DEACTIVATED
ADVENTURE_CREATED
ADVENTURE_ACTIVATED
ADVENTURE_DEACTIVATED
ADVENTURE_DELETED
```

Do not build an entirely new audit subsystem solely for this roadmap if the application has no such infrastructure; structure mutations so audit logging can be added cleanly later.

---

# 22. Suggested React Components

Reuse existing admin components where possible.

Potential structure:

```text
src/
  pages/
    admin/
      AdminDashboard.tsx
      islands/
        IslandListPage.tsx
        IslandCreatePage.tsx
        IslandDetailPage.tsx
        IslandEditPage.tsx
      adventures/
        AdventureListPage.tsx
        AdventureCreatePage.tsx
        AdventureDetailPage.tsx
        AdventureEditPage.tsx

  components/
    admin/
      AdminRoute.tsx
      AdminLayout.tsx
      IslandStatusBadge.tsx
      AdventureStatusBadge.tsx
      AdventureList.tsx
      AdventureModelList.tsx
      DeleteAdventureDialog.tsx
```

Adapt names and locations to the actual repository structure instead of forcing this exact tree.

---

# 23. Backend / Service Layer

Keep backend/data operations out of large page components.

Use the project's existing service/repository conventions.

Conceptually provide operations equivalent to:

```ts
listIslands()
getIsland(id)
createIsland(input)
updateIsland(id, input)
setIslandActive(id, active)

listAdventures()
listAdventuresByIsland(islandId)
getAdventure(id)
createAdventure(input)
updateAdventure(id, input)
setAdventureActive(id, active)
deleteAdventure(id)

listModelsByAdventure(adventureId)
```

Do not create redundant custom Lambdas if Amplify Data can securely and cleanly perform an operation using the project's existing architecture. Use functions/custom operations where business rules require them.

---

# 24. Data Integrity Requirements

Enforce the following:

1. Every Adventure references a valid Island.
2. Adventure deletion cannot accidentally orphan or destroy child learning history.
3. Deactivating an Island does not erase Adventure activation settings.
4. Inactive content remains manageable from Admin.
5. Model records reference existing S3-backed assets rather than copying binaries into database records.
6. Slugs should be unique within the scope required by the routing architecture.
7. Backend authorization applies to all mutations.

---

# 25. Testing Requirements

Add tests appropriate to the project's current testing stack.

## Authorization

Verify:

```text
normal user -> /admin -> 404
normal user -> /admin/islands -> 404
normal user -> /admin/adventures/:id -> 404
admin -> /admin -> allowed
superuser -> /admin -> allowed
```

Verify that a normal user cannot obtain admin data by directly invoking backend operations.

Verify:

```text
Admin deleteAdventure -> rejected
Superuser deleteAdventure -> allowed
```

## Navbar

Verify:

```text
normal user -> Admin item absent
admin -> Admin item present
superuser -> Admin item present
```

## Islands

Verify:

- List active and inactive Islands.
- Create Island.
- Open Island.
- Activate/deactivate Island.
- List only Adventures belonging to selected Island.
- Adventure links navigate to correct records.

## Adventures

Verify:

- Create Adventure under an Island.
- View Adventure description.
- View associated models.
- Activate/deactivate Adventure.
- Admin does not see Delete.
- Superuser sees Delete.
- Delete requires confirmation.
- Dependent progress/history is protected.

## Effective Availability

Verify:

```text
Island active + Adventure active   -> playable
Island active + Adventure inactive -> unavailable
Island inactive + Adventure active -> unavailable
Island inactive + Adventure inactive -> unavailable
```

---

# 26. Implementation Order

Implement in this order to minimize rework:

## Phase 1 — Inspect Existing Architecture

Before coding:

1. Inspect Amplify Gen 2 schema.
2. Find existing Island/Region/World models.
3. Find existing Adventure/Story/Chapter models.
4. Find existing character/model/asset records and S3 asset conventions.
5. Identify current Admin and Superuser authorization implementation.
6. Identify the application's existing 404 component.
7. Identify current navbar/user dropdown implementation.
8. Identify existing admin layout and `/admin/characters` conventions.

Document any conflicts before introducing new models.

## Phase 2 — Data Model

Implement or extend:

```text
Island
Adventure
Island -> Adventures relationship
Adventure -> Models relationship
```

Run the required Amplify schema/backend generation/deployment workflow.

## Phase 3 — Authorization

Implement:

```text
Admin access checks
Superuser checks
backend mutation authorization
AdminRoute -> 404 behavior
```

Authorization should be complete before destructive operations are exposed.

## Phase 4 — Admin Navigation

Implement:

```text
Admin dashboard links
Navbar Admin link
Admin layout/navigation
```

## Phase 5 — Island Management

Implement:

```text
Island list
Create Island
Island detail
Edit Island
Activate/deactivate
Adventure list within Island
```

## Phase 6 — Adventure Management

Implement:

```text
Global Adventure list
Create Adventure
Adventure detail
Edit Adventure
Activate/deactivate
```

## Phase 7 — Adventure Models

Connect the Adventure detail screen to existing S3-backed model/asset records and display the models assigned to the Adventure.

## Phase 8 — Superuser Delete

Implement Superuser-only Adventure deletion after dependency behavior has been verified.

## Phase 9 — Tests and UX Cleanup

Complete:

```text
authorization tests
route tests
CRUD tests
activation tests
delete tests
empty states
loading states
error handling
toasts
responsive admin layout
```

---

# 27. Acceptance Criteria

The feature is complete when all of the following are true:

- [ ] Authorized admins can navigate to `/admin`.
- [ ] The authenticated navbar dropdown displays **Admin** only for users with admin access.
- [ ] Clicking Admin navigates to `/admin`.
- [ ] Unauthorized users requesting any `/admin` route receive the standard 404 page.
- [ ] Unauthorized users cannot retrieve or mutate admin-only data directly through the backend.
- [ ] Admins can list all Islands.
- [ ] Admins can create an Island.
- [ ] Admins can activate/deactivate an Island.
- [ ] Clicking an Island opens its detail page.
- [ ] Island detail displays its description and all Adventures assigned to it.
- [ ] Every Adventure in the Island's Adventure list is clickable.
- [ ] Admins can create an Adventure and associate it with an Island.
- [ ] Admins can list all Adventures globally.
- [ ] Clicking an Adventure opens its detail page.
- [ ] Adventure detail displays the Adventure description.
- [ ] Adventure detail displays the models associated with the Adventure.
- [ ] Admins can activate/deactivate Adventures.
- [ ] Deactivating an Island makes all of its Adventures unavailable to normal users without overwriting their individual active flags.
- [ ] Normal Admin users cannot delete Adventures.
- [ ] Superusers can delete Adventures.
- [ ] Adventure deletion requires explicit confirmation.
- [ ] Adventure deletion does not accidentally delete child learning/progress history.
- [ ] Existing model/S3 infrastructure is reused rather than duplicated.
- [ ] Existing project UI conventions are followed.
- [ ] Automated tests cover permissions and primary management flows.

---

# 28. Important Instructions for Claude

Before implementing this roadmap:

1. **Read the repository documentation first**, especially `CLAUDE.md`, `docs/ARCHITECTURE`, `docs/DATA_MODEL`, `docs/DECISIONS`, `docs/IMPLEMENTATION_STATUS`, and relevant admin/asset documentation.
2. Inspect the current codebase before creating models, routes, role helpers, or services.
3. Reuse existing architecture and naming conventions wherever possible.
4. Do not create duplicate Island, Adventure, Character, Model, Asset, User, Role, or authorization concepts.
5. Preserve existing functionality and migrations/data.
6. Treat authorization as a backend security requirement, not merely a frontend visibility feature.
7. Use the application's existing standard 404 component for unauthorized admin routes.
8. Do not add Island deletion as part of this work.
9. Do not cascade-delete child learning history when deleting an Adventure without an explicit architectural decision.
10. Keep S3 model binaries out of the source repository and reuse the existing asset-management/S3 system.
11. Update relevant documentation as implementation decisions are made.
12. Add tests for every permission boundary introduced by this feature.

When an existing implementation conflicts with an assumption in this roadmap, prefer the established project architecture and document the adjustment rather than creating a parallel system.
