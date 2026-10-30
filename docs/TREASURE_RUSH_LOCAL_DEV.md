# Treasure Rush: running it locally

How to play Treasure Cove on your own machine against a local Django: PostgreSQL in Docker,
Django's `runserver`, and Vite proxying `/api` to it (TR-D14). Synthetic content and test
accounts only. Nothing here touches a deployed environment.

**Known gap, until the child-profile migration lands (LAI-0502 / LAI-0602).** Children are
still created in Amplify, so the child you pick in the app does not exist in Django. Step 7 is a
manual, local-only workaround that mirrors one test child into Django with the **same id**. Do
not use it for anything but synthetic local data; LAI-0602 replaces it.

## Prerequisites

- Docker (for PostgreSQL 16), Python 3.12+, Node 22+.
- An Amplify sandbox or dev environment you can sign in to with a **test** parent account, with
  one test child created through the app as usual. `amplify_outputs.json` from it is in the main
  checkout's root.

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

## 3. Cognito settings for Django

Django verifies the app's Cognito **access** tokens (ADR-024). Take the three values from
`amplify_outputs.json` (`auth.aws_region`, `auth.user_pool_id`, `auth.user_pool_client_id`) and
export them in the shell that runs Django:

```bash
export COGNITO_REGION=<auth.aws_region>
export COGNITO_USER_POOL_ID=<auth.user_pool_id>
export COGNITO_ALLOWED_CLIENT_IDS=<auth.user_pool_client_id>
```

ADR-024 gate A6 (verification against a real Cognito token) is still open: if every request is a
401, check these three values first.

## 4. Start Django

```bash
make runserver      # http://127.0.0.1:8000, settings config.settings.local
curl http://127.0.0.1:8000/api/v1/health/
```

## 5. Frontend environment

Create `react/.env.local` (Vite reads env files from `react/`; it is gitignored):

```bash
VITE_BACKEND=django
# Optional; this is the default. Must be a loopback origin.
DJANGO_DEV_PROXY_TARGET=http://127.0.0.1:8000
```

Leave `VITE_DJANGO_API_BASE` unset: the app calls `/api/...` on the Vite origin and Vite
forwards it to Django, so no CORS is needed.

## 6. Start the app and sign in

```bash
npm install         # repository root, once
npm run dev
```

Sign in as the test parent. The first Django request sets up the parent's Django account
automatically through `POST /api/v1/me/`; there is no separate step.

## 7. Mirror the test child into Django (interim, local only)

Open the child's island once and note the child id in the URL (`/island/<childId>`). Then, with
the same database:

```bash
cd lai
../.venv/bin/python manage.py shell -c "
from apps.users.models import ChildProfile, ParentAccount
parent = ParentAccount.objects.get()      # the one test parent step 6 created
child = ChildProfile(id='<childId>', parent=parent, nickname='Test', age_band='PATHFINDER',
                     avatar_key='FOX', reading_mode='READ_ALONG', session_minutes=10)
child.full_clean(); child.save(); print('ok', child.id)
"
```

Use the same age band as the Amplify child; it chooses the chest's challenge. If more than one
parent exists locally, select it by `cognito_sub` instead of `.get()`.

## 8. Play

Go to `/island/<childId>/explore/treasure-rush-cove`. Walk to Pirate Pip (E or Enter to talk),
accept the quest, find the chest, answer, and open the backpack (bottom right).

To start over, remove that child's progress (sessions, attempts, world changes, items, quests)
in the shell, or `make down && docker volume rm <project>_lai_pgdata` and repeat from step 1.

## What can go wrong

| You see | Likely cause |
|---|---|
| "This part of the island isn't open yet." | Step 2's publish not run, or step 7 not done for this child id |
| "Please ask a grown-up to sign in again." | Django rejected the token: step 3's values |
| "We are still getting your island ready." | `POST /api/v1/me/` failed: check the Django console |
| Requests to `/api` return Vite's 404 | `react/.env.local` missing `VITE_BACKEND=django`; restart `npm run dev` |
