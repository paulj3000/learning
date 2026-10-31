# Treasure Rush: running it locally

How to play Treasure Cove on your own machine against a local Django: PostgreSQL in Docker,
Django's `runserver`, and Vite proxying `/api` to it (TR-D14). Synthetic content and test
accounts only. Nothing here touches a deployed environment.

**Sign-in.** Amazon Cognito, as in every environment (ADR-040). You need a test Cognito pool
(an Amplify sandbox or dev environment) and a **test** parent account in it. Django Admin keeps
its own staff sign-in (step 3).

**Profiles live in Django (LAI-CHILD-001, ADR-039).** With `VITE_BACKEND=django` the parent
dashboard lists, creates, edits and deactivates children through Django, so you add a child in the
app and pick it from the dashboard. Not available yet in this mode: profile photos (LAI-1103),
deleting a child or the account (LAI-0209; turn the profile off instead), and the Amplify-backed
extras (companion name, Amplify backpack items, the older Amplify adventures), which do not know a
Django child. Treasure Rush runs entirely on Django.

## Prerequisites

- Docker (for PostgreSQL 16), Python 3.12+, Node 22+.
- An Amplify sandbox or dev environment you can sign in to with a **test** parent account.
  `amplify_outputs.json` from it is in the main checkout's root.

## 1. Python environment and database

From the repository root:

```bash
make py-install     # creates .venv and installs requirements-dev.txt
make up             # PostgreSQL 16 on 127.0.0.1:5432 (set POSTGRES_PORT if 5432 is taken)
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

Django verifies the app's Cognito **access** tokens (ADR-024, ADR-040). Take the three values from
`amplify_outputs.json` (`auth.aws_region`, `auth.user_pool_id`, `auth.user_pool_client_id`) and
export them in the shell that runs Django (template: `lai/.env.example`):

```bash
export COGNITO_REGION=<auth.aws_region>
export COGNITO_USER_POOL_ID=<auth.user_pool_id>
export COGNITO_ALLOWED_CLIENT_IDS=<auth.user_pool_client_id>
```

Without all three every API request is rejected (fail closed). ADR-024 gate A6 (verification
against a real Cognito token) is still open: if every request is a 401, check these values first.

For Django Admin (optional):

```bash
cd lai
../.venv/bin/python manage.py create_admin_account dev-admin --superuser
```

It asks for a password twice (12+ characters, not common; nothing is stored in the repository).
The admin account signs in to Django Admin only; its session never authenticates the app's API.
Staff can inspect parents and children read-only in Django Admin
(**Users > Parent accounts / Child profiles**; ADR-039).

## 4. Start Django

```bash
make runserver      # http://127.0.0.1:8000, settings config.settings.local
curl http://127.0.0.1:8000/api/v1/health/
```

## 5. Frontend environment

Create `react/.env.local` (Vite reads env files from `react/`; it is gitignored). A template is in
`react/.env.example`:

```bash
VITE_BACKEND=django
# Optional; this is the default. Must be a loopback origin.
DJANGO_DEV_PROXY_TARGET=http://127.0.0.1:8000
```

Leave `VITE_DJANGO_API_BASE` unset: the app calls `/api/...` on the Vite origin and Vite
forwards it to Django, so no CORS is needed.

## 6. Start the app, sign in and play

```bash
npm install         # repository root, once
npm run dev
```

Sign in as the test parent with the Amplify form. The first Django request sets up the parent's
Django account through `POST /api/v1/me/`; there is no separate step. On the dashboard choose
**Add a child profile**, save it, then play as that child and open
`/island/<childId>/explore/treasure-rush-cove` (the id is in the address bar). Walk to Pirate Pip
(E or Enter to talk), accept the quest, find the chest, answer, and open the backpack (bottom
right).

To bring over test children that already exist in that Amplify sandbox, export them and use
`manage.py import_amplify_profiles` (docs/platform/AMPLIFY_PROFILE_IMPORT.md), which keeps their
ids.

## 7. Sign out

Use **Sign out** in the account menu (Amplify Auth). Any later API call answers 401 until you sign
in again.

To start over, remove that child's progress (sessions, attempts, world changes, items, quests)
in the shell, or `make down && docker volume rm <project>_lai_pgdata` and repeat from step 1.

## 8. Checking the API by hand (optional)

Every request needs a Cognito **access** token for the test parent (not the ID token):

```bash
base=http://127.0.0.1:8000/api/v1
read -rs TOKEN    # paste the access token
curl -s -H "Authorization: Bearer $TOKEN" $base/children/    # the parent's children, ids included
```

## 9. Models from the asset manager (TR-10)

With `VITE_BACKEND=django` the cove already asks Django for its three models (`npc-pip`,
`treasure-chest`, `ground-tile`); with nothing published it uses the bundled files, and the
browser console says so once per model. To manage them in Django instead:

```bash
cd lai
../.venv/bin/python manage.py ensure_asset_roles
../.venv/bin/python manage.py create_admin_account <you> --superuser   # once; asks for a password
../.venv/bin/python manage.py import_assets --from-bundled --ids npc-pip,treasure-chest,ground-tile
```

The import stores the files under `lai/.asset-storage/` as validated, unpublished versions. Then
open `http://127.0.0.1:8000/admin/`, go to **Asset manager, Asset versions**, select the three
versions and run **Publish selected versions**. Leave the cove and enter it again: the models
now come from `/api/v1/asset-files/...` (the browser's network panel shows it).

To see a replacement, upload a new version of `treasure-chest` (**Add asset version**; it must
keep an `Open` clip), publish it, then **Make the selected version the default**, and re-enter
the cove. Full workflow and troubleshooting: `docs/ASSET_MANAGER.md` section 19.

## What can go wrong

| You see | Likely cause |
|---|---|
| "This part of the island isn't open yet." | Step 2's publish not run, or the child id is not this parent's |
| "Please ask a grown-up to sign in again." | Django rejected the Cognito token: check step 3's three values |
| "We are still getting your island ready." | `POST /api/v1/me/` failed: check the Django console |
| Requests to `/api` return Vite's 404 | `react/.env.local` missing `VITE_BACKEND=django`; restart `npm run dev` |
| A pink box where Pip or a model should be | That model failed from both Django and the bundle; the console warning says why (TR-7a) |
| `[assets] the asset manager request failed (...)` | Not a publishing problem: the kind and status say which (401 sign-in, 404 child not in Django) |
| A newly published model does not show | It is not the default version yet, or you have not left and re-entered the cove |
