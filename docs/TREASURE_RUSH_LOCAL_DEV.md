# Treasure Rush: running it locally

How to play Treasure Cove on your own machine against a local Django: PostgreSQL in Docker,
Django's `runserver`, and Vite proxying `/api` to it (TR-D14). Synthetic content and test
accounts only. Nothing here touches a deployed environment.

**Sign-in.** Local development signs in with Django by default (`AUTH_PROVIDER=django`, ADR-038):
no AWS account, Cognito pool, Amplify sandbox or AWS credentials are needed. To test against a
real Cognito pool instead, see "Using Cognito locally" at the end.

**Profiles live in Django (LAI-CHILD-001, ADR-039).** With `VITE_BACKEND=django` the parent
dashboard lists, creates, edits and deactivates children through Django, under either sign-in, so
you can add a child in the app and pick it from the dashboard. Not available yet in this mode:
profile photos (LAI-1103), deleting a child or the account (LAI-0209; turn the profile off
instead), and the Amplify-backed extras (companion name, Amplify backpack items, the older
Amplify adventures), which do not know a Django child. Treasure Rush runs entirely on Django.

## Prerequisites

- Docker (for PostgreSQL 16), Python 3.12+, Node 22+.

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

## 3. Accounts: a local parent with a child, and an admin

```bash
cd lai
../.venv/bin/python manage.py create_local_parent dev-parent      # add children in the app
# or, to skip the form: create_local_parent dev-parent --child Tester --age-band PATHFINDER
../.venv/bin/python manage.py create_admin_account dev-admin --superuser   # optional, Django Admin
```

Each command asks for a password twice (12+ characters, not common; nothing is stored in the
repository). `create_local_parent` prints the new account id (and, with `--child`, the child's
id). It works only with `AUTH_PROVIDER=django` (the local default). The parent is an ordinary
`ParentAccount` with no admin rights; the admin account signs in to Django Admin only and cannot
sign in to the app. Staff can inspect parents and children read-only in Django Admin
(**Users > Parent accounts / Child profiles**; ADR-039). Forgot the password:
`create_local_parent dev-parent --reset-password`.

## 4. Start Django

```bash
make runserver      # http://127.0.0.1:8000, settings config.settings.local, AUTH_PROVIDER=django
curl http://127.0.0.1:8000/api/v1/health/
```

`DJANGO_DEBUG=true` (the local default) is what makes `django` the default provider. With
`DJANGO_DEBUG=false` you must set `AUTH_PROVIDER` explicitly, and an unknown value stops Django at
start-up.

## 5. Frontend environment

Create `react/.env.local` (Vite reads env files from `react/`; it is gitignored). A template is in
`react/.env.example`:

```bash
VITE_BACKEND=django
VITE_AUTH_PROVIDER=django
# Optional; this is the default. Must be a loopback origin.
DJANGO_DEV_PROXY_TARGET=http://127.0.0.1:8000
```

Leave `VITE_DJANGO_API_BASE` unset: the app calls `/api/...` on the Vite origin and Vite
forwards it to Django, so the session cookie is same-origin and no CORS is needed.
`VITE_AUTH_PROVIDER=django` works only under `npm run dev`; `npm run build` refuses it.

## 6. Start the app, sign in and play

```bash
npm install         # repository root, once
npm run dev
```

Open the app, choose **Sign in**, and use the `dev-parent` username and password from step 3. On
the dashboard choose **Add a child profile**, save it, edit it if you like, then play as that
child and open `/island/<childId>/explore/treasure-rush-cove` (the id is in the address bar). Walk to Pirate
Pip (E or Enter to talk), accept the quest, find the chest, answer, and open the backpack (bottom
right).

## 7. Sign out

Use **Sign out** in the account menu. The Django session is ended (`POST /api/v1/auth/logout/`);
any later API call answers 401 until you sign in again.

To start over, remove that child's progress (sessions, attempts, world changes, items, quests)
in the shell, or `make down && docker volume rm <project>_lai_pgdata` and repeat from step 1.

## 8. Checking the API by hand (optional)

```bash
jar=$(mktemp); base=http://127.0.0.1:8000/api/v1
token=$(curl -s -c "$jar" -b "$jar" $base/auth/csrf/ | python3 -c 'import json,sys; print(json.load(sys.stdin)["csrfToken"])')
read -rs PW; curl -s -c "$jar" -b "$jar" -H "X-CSRFToken: $token" -H 'Content-Type: application/json' \
  -H 'Origin: http://127.0.0.1:8000' -d "{\"username\":\"dev-parent\",\"password\":\"$PW\"}" $base/auth/login/
curl -s -b "$jar" $base/children/            # the parent's children, ids included
```

Login rotates the CSRF token: fetch `auth/csrf/` again before the next POST.

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

## Using Cognito locally (optional)

To exercise the production authentication path against a real (test) Cognito pool:

1. Have an Amplify sandbox or dev environment you can sign in to with a **test** parent, and its
   `amplify_outputs.json` in the main checkout's root.
2. Start Django with Cognito selected, taking the three values from `amplify_outputs.json`
   (`auth.aws_region`, `auth.user_pool_id`, `auth.user_pool_client_id`):

   ```bash
   export AUTH_PROVIDER=cognito
   export COGNITO_REGION=<auth.aws_region>
   export COGNITO_USER_POOL_ID=<auth.user_pool_id>
   export COGNITO_ALLOWED_CLIENT_IDS=<auth.user_pool_client_id>
   make runserver
   ```

3. In `react/.env.local`, set `VITE_AUTH_PROVIDER=cognito` (or remove the line) and restart
   `npm run dev`. Sign in as the test parent; the first Django request sets up the parent's
   Django account through `POST /api/v1/me/`.
4. Children are Django profiles in this mode too: add them from the dashboard. To bring over
   test children that already exist in that Amplify sandbox, export them and use
   `manage.py import_amplify_profiles` (docs/platform/AMPLIFY_PROFILE_IMPORT.md), which keeps
   their ids.

ADR-024 gate A6 (verification against a real Cognito token) is still open: if every request is a
401, check the three Cognito values first. In this mode the local sign-in routes answer 404 and a
Django session never authenticates the API.

## What can go wrong

| You see | Likely cause |
|---|---|
| "This part of the island isn't open yet." | Step 2's publish not run, or the child id is not this parent's (Cognito mode: the mirror step not done) |
| The sign-in page asks for an email address | `VITE_AUTH_PROVIDER=django` missing from `react/.env.local`; restart `npm run dev` |
| "That username and password did not match." | Wrong password, or the account was made in another database: `create_local_parent --reset-password` |
| "The local server could not be reached." | Django is not running, or it runs with `AUTH_PROVIDER=cognito` (the local sign-in routes are 404 then) |
| `npm run dev` stops with `VITE_AUTH_PROVIDER=django needs VITE_BACKEND=django` | Add `VITE_BACKEND=django` to `react/.env.local` |
| 403 `csrf_failed` on a POST from your own script | Send `X-CSRFToken` from `GET /api/v1/auth/csrf/` (fetch it again after login) and an `Origin` matching the host |
| "Please ask a grown-up to sign in again." | Django rejected the credential: in Django mode, sign in again; in Cognito mode, check the three Cognito values |
| "We are still getting your island ready." | `POST /api/v1/me/` failed: check the Django console |
| Requests to `/api` return Vite's 404 | `react/.env.local` missing `VITE_BACKEND=django`; restart `npm run dev` |
| A pink box where Pip or a model should be | That model failed from both Django and the bundle; the console warning says why (TR-7a) |
| `[assets] the asset manager request failed (...)` | Not a publishing problem: the kind and status say which (401 sign-in, 404 child not in Django) |
| A newly published model does not show | It is not the default version yet, or you have not left and re-entered the cove |
