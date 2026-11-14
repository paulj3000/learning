# Gameplay and environment integration: owner QA guide

Branch `integration/gameplay-environment-qa` (2026-11-14) combines, without merging into `main`:

- `feature/pirates-leap`: the whole P1 gameplay stack (jumping, third-person camera, avatars,
  running and sprinting, derived colliders, collision profiles, shared platforms, Pirate's Leap,
  Cognito-direct auth, Django-only backend, Amplify removal). Details: `docs/P1_PLATFORMING_QA.md`.
- `feature/treasure-rush-palm-trees` (PR #36): palms, barrels, logs and vegetation from the asset
  library (`docs/ASSET_LIBRARY.md` section 23, `docs/TREASURE_RUSH_ASSET_REQUIREMENTS.md`).
- `main`.

Development is unit- and engine-tested only. Everything below is owner QA, **not yet done**.

## What changed in the integration itself

- **Cove layout v8** (`lai/apps/regions/treasure_cove_layout.py`): the environment branch's v7
  layout (43 palms, 37 library props, 138 vegetation placements, paths and docks, the original
  quest and chests) plus each prop's drawn `height`. The jump branch's separate landing-barrel
  colliders are gone: the bundled stand-in barrels are jumpable through the shared derived
  colliders, and drawn library barrels are jumpable from their height.
- **Pirate's Leap** stays in its own scene block (`scene.platforming`, `piratesLeapVersion` 1).
  Nothing in the cove layout stands inside the course area (a test guards it).
- **One collider per visible object.** When a library model replaces a stand-in
  (`propReplaces`), the stand-in's `derived:<id>` boxes are removed and the model's footprint
  colliders take over. A failed or missing model keeps the stand-in and its box.
- **Seeds stay idempotent.** A rerun creates nothing; an older layout is upgraded to v8 once and
  keeps `platforming`, `platformTuning` and any spawn point an admin moved.

## Local setup

Requires Node.js 22+, Python 3.12+ and Docker (PostgreSQL 16). Your local database and
`lai/.asset-storage/` are kept; nothing here resets them.

```bash
git fetch origin integration/gameplay-environment-qa
```
```bash
git checkout -B integration/gameplay-environment-qa origin/integration/gameplay-environment-qa
```
```bash
npm install
```
```bash
make py-install
```
```bash
cp -n .env.sample .env
```

`.env` needs only the existing Cognito values (no new variables on this branch; no secrets):

```
COGNITO_REGION=us-west-1
COGNITO_USER_POOL_ID=<pool id>
COGNITO_ALLOWED_CLIENT_IDS=<web app client id>
```

Database, migrations and content:

```bash
make up
```
```bash
make migrate
```
```bash
cd lai && ../.venv/bin/python manage.py load_content && ../.venv/bin/python manage.py seed_treasure_rush && ../.venv/bin/python manage.py publish_treasure_rush && ../.venv/bin/python manage.py ensure_asset_roles && cd ..
```

Environment models (external, never in Git; see "External GLB files" below). Dry run first:

```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source /path/to/environment-assets --category all --dry-run && cd ..
```
```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source /path/to/environment-assets --category all --publish && cd ..
```

Barrels, logs and vegetation are validated but stay unpublished until you confirm their licences;
once you do, publish them locally with:

```bash
cd lai && ../.venv/bin/python manage.py import_treasure_rush_environment --source /path/to/environment-assets --category all --publish --licence-confirmed && cd ..
```

Run (two terminals), then open http://localhost:5183/ (Django on port 8010):

```bash
make runserver
```
```bash
make web
```

Navigation: choose a child > Island > Pirate Builder Bay > Treasure Cove (Realms).

## External GLB files (owner-supplied, not in Git)

| Pack | Files | Asset ids | Licence |
|---|---|---|---|
| Quaternius Palm Trees | `PalmTree_1/2/3/5` | `nature-palm-tree-{tall,curved,standard,small}` | CC0, owner-stated; publishable |
| Quaternius Barrel | `Barrel.glb` | `prop-wooden-barrel` | CC0 expected, **unconfirmed** |
| Quaternius Wood Log, Log with Moss, Wood | `WoodLog`, `WoodLog_Moss`, `UI_Wood` | `nature-wood-log`, `nature-wood-log-moss`, `prop-wood-pile` | CC0 expected, **unconfirmed** |
| Nature kit (`MapleTree_5_2.zip`, `png.zip`, `PalmTree_Leaves.zip`) | bushes, flowers, grass `.gltf` | `nature-bush-*`, `nature-flower-tropical-*`, `nature-grass-*` | author and licence **not stated** |

Licence note: the Trello environment card records the owner's CC0-1.0 confirmation for every pack
(2026-11-14) and local publication, but `docs/ASSET_LICENCES.md` on this branch still reads
"unconfirmed" / "not stated" for the barrel, logs and nature kit. Reconcile that record before
merge; until then `--licence-confirmed` is the owner's call.

Without them the cove plays with its primitive palms and bundled barrels and logs, and no
vegetation; nothing errors. Imported files live in `lai/.asset-storage/` (git-ignored).

Collision needs no extra step: palms carry authored trunk colliders; props carry footprint
colliders in the layout; vegetation is walk-through. A collision profile (Assets > Collision
profiles) changes resolver-placed assets; it does not change the cove's extension-drawn props.

## Combined checklist

### Movement (desktop, touch, gamepad)
- [ ] WASD and arrows walk; left and right are not swapped; Shift sprints; the Shift tap setting toggles.
- [ ] Space jumps; V switches camera; E or Enter interacts; typing in a text box moves nothing.
- [ ] Touch: short drag walks, longer drag runs, past the edge sprints; Jump works while moving.
- [ ] Gamepad: left stick walks to running by tilt; L3 sprints; A jumps; X interacts; Y switches camera.
- [ ] First- and third-person both work; the avatar runs and lands cleanly.

### Environment assets (with the models imported and published)
- [ ] Palms, barrels, logs and the wood pile appear where the stand-ins were; no doubled objects.
- [ ] Bushes, flowers and grass appear round the landing, beach, grove, ruins and lookout; they sway gently (still under reduced motion); LOW quality thins them.
- [ ] Without the models (or with one unpublished) the stand-ins appear instead, with no warning.

### Collision across both branches
- [ ] Palm trunks block; you can walk under the fronds.
- [ ] Barrels block on the ground and can be jumped onto; logs can be jumped over.
- [ ] Pip and other characters block.
- [ ] Chests, building entrances, spawn points, checkpoints, paths and docks stay clear.
- [ ] Vegetation never blocks.
- [ ] Sprinting into any solid stops you; jumping never gets past the ruins gate or the channel.
- [ ] A collision profile edited in Django Admin changes how a resolver-placed asset blocks.

### Platforming (Pirate's Leap)
- [ ] The course plays as in `docs/P1_PLATFORMING_QA.md`: ferry, lift, sinking barrel, bounce drum, riddle bridge, checkpoints.
- [ ] Moving platforms stay in sync and never push you through a wall; falling in the water returns you to the last checkpoint.
- [ ] No environment asset (palm, prop, plant) stands in or near the course.
- [ ] The treasure, medal, shell and feather are given once; replay gives nothing twice.

### The original cove
- [ ] Pip's Missing Treasure, its chests and the lookout work as before.
- [ ] Re-entering the cove keeps everything; reseeding changes nothing.

### Staff (Django Admin)
- [ ] Asset library > Asset versions: preview, publish, make default and retire the environment models.
- [ ] Regions > 3D Areas > Treasure Cove > Edit content: `platformTuning` still applies.
