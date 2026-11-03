"""A disposable local Django for the Playwright acceptance suites (react/e2e/acceptance).

    python tests/e2e/django_server.py

Never deployed and never imported by `lai/`. It refuses to run unless the database is the
loopback docker-compose PostgreSQL and its name starts with `lai_e2e`, because it drops and
recreates that database on every start so each run begins from the same state:

1. migrate, `load_content`, `seed_treasure_rush`, `publish_treasure_rush`, `ensure_asset_roles`;
2. synthetic staff accounts and the Studio groups suggested in docs/AI_QUESTION_STUDIO.md
   section 10 (passwords are synthetic, local, and printed nowhere but this file);
3. a locally generated RSA key stands in for Cognito's signing key: the JWKS cache for the
   configured issuer is replaced in-process (no production code reads this), and the private key
   is written to the state directory so the browser tests can mint access and ID tokens;
4. `runserver` on loopback without the reloader.

Settings are `config.settings.local` driven by environment variables: fake AI provider, inline
Studio runs, in-memory asset storage, Django asset delivery. Nothing reaches AWS.
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LAI = ROOT / "lai"
STATE_DIR = Path(os.environ.get("LAI_E2E_STATE_DIR", ROOT / "react" / "test-results" / ".e2e"))
PORT = os.environ.get("LAI_E2E_DJANGO_PORT", "8765")

E2E_ENV = {
    "DJANGO_SETTINGS_MODULE": "config.settings.local",
    "DJANGO_DEBUG": "true",
    "POSTGRES_DB": "lai_e2e",
    "COGNITO_REGION": "us-east-1",
    "COGNITO_USER_POOL_ID": "us-east-1_E2Elocal",
    "COGNITO_ALLOWED_CLIENT_IDS": "e2elocalclient",
    "LAI_AI_PROVIDER": "fake",
    "LAI_STUDIO_RUN_MODE": "inline",
    "LAI_ASSET_STORAGE": "memory",
    "LAI_ASSET_DELIVERY": "django",
    # Small enough that the oversized-upload test needs only a few megabytes.
    "LAI_ASSET_MAX_UPLOAD_BYTES": str(2 * 1024 * 1024),
    "DJANGO_LOG_LEVEL": "WARNING",
}

STAFF_PASSWORD = "e2e-Local-Only-Passw0rd!"  # noqa: S105 - synthetic, loopback database only
STUDIO_GROUPS = {
    "Question authors": (
        "add_generationbatch",
        "view_generationbatch",
        "view_question",
        "add_question",
        "change_question",
    ),
    "Question reviewers": (
        "view_question",
        "change_question",
        "approve_question",
        "view_questionrevision",
    ),
    "Question publishers": (
        "view_question",
        "change_question",
        "approve_question",
        "view_questionrevision",
        "publish_question",
        "retire_revision",
    ),
    "Pool managers": ("view_questionpool", "add_questionpool", "change_questionpool"),
}
# username -> (superuser, groups)
STAFF = {
    "e2e-super": (True, ()),
    "e2e-author": (False, ("Question authors",)),
    "e2e-reviewer": (False, ("Question reviewers",)),
    "e2e-publisher": (False, ("Question publishers", "Pool managers")),
    "e2e-asset-editor": (False, ("Asset editors",)),
    "e2e-asset-publisher": (False, ("Asset publishers",)),
    "e2e-no-perms": (False, ()),
}


def configure_environment() -> None:
    for name, value in E2E_ENV.items():
        os.environ[name] = value
    os.environ.setdefault("POSTGRES_PORT", "5432")
    sys.path.insert(0, str(LAI))


def recreate_database() -> None:
    import psycopg

    name = os.environ["POSTGRES_DB"]
    if not name.startswith("lai_e2e"):
        raise SystemExit("The e2e server only recreates a database named lai_e2e*.")
    with psycopg.connect(
        host="127.0.0.1",
        port=int(os.environ["POSTGRES_PORT"]),
        user=os.environ.get("POSTGRES_USER", "lai"),
        password=os.environ.get("POSTGRES_PASSWORD", "local-dev-only-password"),
        dbname="postgres",
        autocommit=True,
    ) as connection:
        connection.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        connection.execute(f'CREATE DATABASE "{name}"')


def write_signing_key() -> dict:
    """A fresh RSA key per run: Django trusts its public half, the tests sign with the rest."""
    import jwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    public.update({"kid": "e2e-local-key", "alg": "RS256", "use": "sig"})
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    issuer = (
        f"https://cognito-idp.{os.environ['COGNITO_REGION']}.amazonaws.com/"
        f"{os.environ['COGNITO_USER_POOL_ID']}"
    )
    state = {
        "issuer": issuer,
        "kid": public["kid"],
        "clientId": os.environ["COGNITO_ALLOWED_CLIENT_IDS"],
        "region": os.environ["COGNITO_REGION"],
        "userPoolId": os.environ["COGNITO_USER_POOL_ID"],
        "privateKeyPem": pem.decode(),
        "djangoOrigin": f"http://127.0.0.1:{PORT}",
        "staffPassword": STAFF_PASSWORD,
    }
    (STATE_DIR / "cognito.json").write_text(json.dumps(state))
    return {"keys": [public]}


def guard_loopback() -> None:
    from django.conf import settings

    database = settings.DATABASES["default"]
    if database["HOST"] not in {"127.0.0.1", "localhost", "::1"} or not settings.DEBUG:
        raise SystemExit("The e2e server runs only with DEBUG on a loopback database.")


def seed() -> None:
    from django.contrib.auth.models import Group, Permission
    from django.core.management import call_command

    from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

    call_command("migrate", verbosity=0)
    call_command("load_content", verbosity=0)
    call_command("seed_treasure_rush", verbosity=0)
    call_command("publish_treasure_rush", verbosity=0)
    call_command("ensure_asset_roles", verbosity=0)
    for name, codenames in STUDIO_GROUPS.items():
        group, _ = Group.objects.get_or_create(name=name)
        group.permissions.set(
            Permission.objects.filter(
                content_type__app_label="question_studio", codename__in=codenames
            )
        )
    for username, (superuser, groups) in STAFF.items():
        account = ParentAccount(
            cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{username}",
            admin_username=username,
            is_staff=True,
            is_superuser=superuser,
            is_active=True,
        )
        account.set_password(STAFF_PASSWORD)
        account.save()
        account.groups.set(Group.objects.filter(name__in=groups))


def trust_local_signing_key(jwks: dict) -> None:
    from apps.users import authentication
    from apps.users.jwks import JwksCache

    body = json.dumps(jwks).encode()
    cache = JwksCache("https://e2e.invalid/jwks.json", fetcher=lambda _url, _timeout: body)
    authentication._cache_for = lambda _issuer: cache


def main() -> None:
    configure_environment()
    recreate_database()
    jwks = write_signing_key()
    import django

    django.setup()
    guard_loopback()
    seed()
    trust_local_signing_key(jwks)
    from django.core.management import call_command

    print(f"e2e Django ready on 127.0.0.1:{PORT}", flush=True)
    call_command("runserver", f"127.0.0.1:{PORT}", use_reloader=False, verbosity=1)


if __name__ == "__main__":
    main()
