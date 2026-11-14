# Treasure Rush: running it locally

How to play Treasure Cove on your own machine against a local Django: PostgreSQL in Docker,
Django's `runserver`, and Vite proxying `/api` to it (TR-D14). Synthetic content and test
accounts only. Nothing here touches a deployed environment.

**Sign-in.** Amazon Cognito, as in every environment (ADR-040): the existing user pool, configured
by environment variables. No Amplify sandbox and no `amplify_outputs.json` are needed. You need a
**test** parent account in that pool. Django Admin keeps its own staff sign-in (step 3).

**Profiles live in Django (LAI-CHILD-001, ADR-039).** Django is the only backend (AMP-03): the
parent dashboard lists, creates, edits and deactivates children through Django, so you add a child
in the app and pick it from the dashboard. Profile photos go to Django's private photo storage
(local disk in development). Deleting a child needs a recent Cognito sign-in (LAI-0209). Children
and photos from the retired Amplify backend are not here unless imported (below). Treasure Rush
runs entirely on Django.

## Prerequisites

- Docker (for PostgreSQL 16), Python 3.12+, Node 22+.
- The existing Cognito user pool's region, pool id and web app client id, and a **test** parent
  account in it.

## 1. Python environment and database

From the repository root:

```bash
make py-install     # creates .venv and installs requirements-dev.txt
make up             # PostgreSQL 16 on 127.0.0.1:5442 (set POSTGRES_PORT to change it)
make migrate
```

## 2. Content

```bash
cd lai
../.venv/bin/python manage.py load_content          # exported islands, NPCs, quests, items...
../.venv/bin/python manage.py seed_treasure_rush    # Treasure Cove, as DRAFT
../.venv/bin/python manage.py publish_treasure_rush # validates, then publishes it
```

`publish_treasure_rush` refuses unless `DEBUG` is on and the database is on loopback (both true
with `config.settings.local`, the `manage.py` default). It checks every row with the same
validation an admin save runs and publishes nothing if any check fails; the messages say what to
fix. It publishes only the seed-owned rows (the region and its challenge specs). The location,
its world, and Pip's quest are catalog content from the export: they must already be `active`,
and the command refuses rather than switching them on. Run it again any time; it only reports
what changed.

## 3. Cognito settings for Django, and an optional admin

Django verifies the app's Cognito **access** tokens (ADR-024, ADR-040). Put the pool's three values
in the repository-root `.env` (`cp .env.sample .env`); `make runserver` passes them to Django and
`npm run dev` reuses the pool id and the first client id for browser sign-in:

```bash
COGNITO_REGION=<region, e.g. us-west-2>
COGNITO_USER_POOL_ID=<pool id>
COGNITO_ALLOWED_CLIENT_IDS=<web app client id>
```

Without all three every API request is rejected (fail closed). ADR-024 gate A6 (verification
against a real Cognito token) is still open: if every request is a 401, check these values first.

For Django Admin (optional):

```bash
make createsuper
```

It asks for a username, then a password twice (it wraps
`manage.py create_admin_account <username> --superuser`; Django's own `createsuperuser` is
disabled). The password needs 12+ characters and must not be common; nothing is stored in
the repository.
The admin account signs in to Django Admin only; its session never authenticates the app's API.
Staff can inspect parents and children read-only in Django Admin
(**Users > Parent accounts / Child profiles**; ADR-039).

## 4. Start Django

```bash
make runserver      # http://127.0.0.1:8010, settings config.settings.local
curl http://127.0.0.1:8010/api/v1/health/
```

The port is `DJANGO_DEV_PORT` (default 8010). To use 8000, put `DJANGO_DEV_PORT=8000` in the
root `.env`, or pass it on both commands (`make runserver DJANGO_DEV_PORT=8000`, `make web DJANGO_DEV_PORT=8000`);
`make runserver` and the Vite proxy read the same value.

## 5. Frontend environment

Nothing is required: `vite dev` uses the Django backend by default, proxies `/api` to
`127.0.0.1:$DJANGO_DEV_PORT`, and takes Cognito from the root `.env`. Optional overrides go in
`react/.env.local` (gitignored; template `react/.env.example`): `VITE_COGNITO_USER_POOL_ID`,
`VITE_COGNITO_CLIENT_ID`, `DJANGO_DEV_PORT` or `DJANGO_DEV_PROXY_TARGET` (loopback only).

Leave `VITE_DJANGO_API_BASE` unset: the app calls `/api/...` on the Vite origin and Vite
forwards it to Django, so no CORS is needed.

## 6. Start the app, sign in and play

```bash
npm install         # repository root, once
make web            # or npm run dev
```

The dev server prints `[lai] dev` lines: backend, proxy target, whether Django answered, and
whether Cognito is configured. Sign in as the test parent on the app's sign-in page. The first Django request sets up the parent's
Django account through `POST /api/v1/me/`; there is no separate step. On the dashboard choose
**Add a child profile**, save it, then play as that child and open
`/island/<childId>/explore/treasure-rush-cove` (the id is in the address bar). Walk to Pirate Pip
(E or Enter to talk), accept the quest, find the chest, answer, and open the backpack (bottom
right).

To bring over test children from the retired Amplify backend's retained tables, export them and
use `manage.py import_amplify_profiles` (docs/platform/AMPLIFY_PROFILE_IMPORT.md), which keeps
their ids. Importing production data is an owner approval.

## 7. Sign out

Use **Sign out** in the account menu (Cognito). Any later API call answers 401 until you sign
in again.

To start over, remove that child's progress (sessions, attempts, world changes, items, quests)
in the shell, or `make down && docker volume rm <project>_lai_pgdata` and repeat from step 1.

## 8. Checking the API by hand (optional)

Every request needs a Cognito **access** token for the test parent (not the ID token):

```bash
base=http://127.0.0.1:8010/api/v1
read -rs TOKEN    # paste the access token
curl -s -H "Authorization: Bearer $TOKEN" $base/children/    # the parent's children, ids included
```

## 9. Models from the asset library (TR-10)

The cove always asks Django for its three models (`npc-pip`,
`treasure-chest`, `ground-tile`); with nothing published it uses the bundled files, and the
browser console says so once per model. To manage them in Django instead:

```bash
cd lai
../.venv/bin/python manage.py ensure_asset_roles
../.venv/bin/python manage.py create_admin_account <you> --superuser   # once; asks for a password
../.venv/bin/python manage.py import_assets --from-bundled --ids npc-pip,treasure-chest,ground-tile
```

The import stores the files under `lai/.asset-storage/` as validated, unpublished versions. Then
open `http://127.0.0.1:8010/admin/`, go to **Asset library, Asset versions**, select the three
versions and run **Publish selected versions**. Leave the cove and enter it again: the models
now come from `/api/v1/asset-files/...` (the browser's network panel shows it).

To see a replacement, upload a new version of `treasure-chest` (**Add asset version**; it must
keep an `Open` clip), publish it, then **Make the selected version the default**, and re-enter
the cove. Full workflow and troubleshooting: `docs/ASSET_LIBRARY.md` section 19.

## What can go wrong

| You see | Likely cause |
|---|---|
| "This part of the island isn't open yet." | Step 2's publish not run, or the child id is not this parent's |
| "Please ask a grown-up to sign in again." | Django rejected the Cognito token: check step 3's three values |
| "We are still getting your island ready." | `POST /api/v1/me/` failed: check the Django console |
| Requests to `/api` return 502, or "We could not reach the island" | Django is not on the proxied port: compare the `[lai] dev API proxy` line with runserver's port (`DJANGO_DEV_PORT`) |
| "Parent sign-in is not available right now" | No Cognito pool configured: see the `[lai] dev Cognito` line and step 3 |
| A pink box where Pip or a model should be | That model failed from both Django and the bundle; the console warning says why (TR-7a) |
| `[assets] the asset library request failed (...)` | Not a publishing problem: the kind and status say which (401 sign-in, 404 child not in Django) |
| A newly published model does not show | It is not the default version yet, or you have not left and re-entered the cove |
