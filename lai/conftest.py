"""Shared pytest hooks and fixtures for the Django project.

The `cognito`, `families`, and token fixtures are the tenant-isolation harness (LAI-0403). Future
child-scoped endpoint tests should use them rather than build their own. Everything is synthetic:
keys are generated per test run, ids are random, and nothing contacts AWS.
"""

import os

import pytest


@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(config, items):
    _order_for_module_content(items)
    if config.pluginmanager.hasplugin("xdist"):
        _group_for_parallel_workers(items)
    _skip_without_postgres(items)


def _skip_without_postgres(items):
    """Tests marked `postgres` need the compose PostgreSQL (`make up`).

    They are skipped when it is unreachable, unless LAI_REQUIRE_POSTGRES=1 (`make py-test-db`),
    in which case an unreachable database fails them instead of hiding the gap.
    """
    if os.environ.get("LAI_REQUIRE_POSTGRES") == "1":
        return
    import socket

    port = int(os.environ.get("POSTGRES_PORT", "5432"))
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
        return
    except OSError:
        pass
    skip = pytest.mark.skip(reason="PostgreSQL not reachable on loopback; run `make up`")
    for item in items:
        if "postgres" in item.keywords:
            item.add_marker(skip)


# --- AWS isolation ---------------------------------------------------------------------------

# Ambient AWS settings that make botocore read the developer's real profile (SSO included) or the
# instance metadata service. An explicit profile also makes botocore ignore AWS_ACCESS_KEY_ID, so a
# test that sets fake keys could still sign with, or refresh, real SSO credentials (GE-090 P1).
AMBIENT_AWS_ENV = (
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
    "AWS_ROLE_ARN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
)


@pytest.fixture(autouse=True)
def isolated_aws_config(tmp_path_factory, monkeypatch):
    """Every Django test runs without the host's AWS profiles, credentials or metadata service.

    A test that needs credentials sets fake ones itself (`monkeypatch.setenv`), which then are the
    only ones botocore can find. Unit tests never reach real AWS (testing policy).
    """
    empty = tmp_path_factory.getbasetemp() / "aws-isolated"
    empty.mkdir(exist_ok=True)
    for name in AMBIENT_AWS_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", str(empty / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(empty / "credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")


# --- Cognito test double ---------------------------------------------------------------------


@pytest.fixture
def cognito_key():
    from apps.users.tests.helpers import KeyPair

    return KeyPair("kid-1")


@pytest.fixture
def cognito_network(cognito_key):
    from apps.users.tests.helpers import Network

    return Network(cognito_key)


@pytest.fixture
def cognito_revocation(monkeypatch):
    """The fake Cognito `GetUser` used by the recent sign-in guard (LAI-0209)."""
    from apps.users import recent_auth
    from apps.users.tests.helpers import FakeRevocationCheck

    check = FakeRevocationCheck()
    monkeypatch.setattr(recent_auth, "get_revocation_check", lambda: check)
    return check


@pytest.fixture
def cognito(settings, monkeypatch, cognito_key, cognito_network, cognito_revocation):
    """Configures a fake pool and routes key fetches to a local fake. Returns the key pair.

    Also replaces Cognito `GetUser` with `cognito_revocation`, so nothing contacts AWS.
    """
    from apps.users import authentication
    from apps.users.jwks import JwksCache
    from apps.users.tests.helpers import CLIENT_ID, ISSUER, POOL_ID, REGION

    settings.COGNITO_REGION = REGION
    settings.COGNITO_USER_POOL_ID = POOL_ID
    settings.COGNITO_ALLOWED_CLIENT_IDS = [CLIENT_ID]
    cache = JwksCache(f"{ISSUER}/.well-known/jwks.json", fetcher=cognito_network)
    monkeypatch.setattr(authentication, "get_jwks_cache", lambda issuer: cache)
    return cognito_key


@pytest.fixture
def token_for(cognito):
    """token_for(sub, **claim_overrides) -> a valid, locally signed access token."""
    from apps.users.tests.helpers import access_claims

    return lambda sub, **claims: cognito.sign(access_claims(sub, **claims))


@pytest.fixture
def api(token_for):
    """api(sub_or_parent=None, token=None) -> a test client that sends that identity's token."""
    from django.test import Client

    def make(identity=None, *, token=None):
        client = Client(raise_request_exception=False)
        if token is None and identity is not None:
            sub = getattr(identity, "cognito_sub", identity)
            token = token_for(sub)
        if token is not None:
            client.defaults["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        return client

    return make


# --- two families ----------------------------------------------------------------------------


@pytest.fixture
def families(db):
    """Two parents with two children each. Nicknames are distinctive so leaks are detectable."""
    from types import SimpleNamespace

    from apps.users import services
    from apps.users.models import ParentAccount

    def make(sub, names):
        parent = ParentAccount.objects.get_or_create_for_cognito(sub)
        base = {
            "age_band": "PATHFINDER",
            "avatar_key": "FOX",
            "reading_mode": "READ_ALONG",
            "interests": ["Secret-Interest"],
        }
        kids = [services.create_child_profile(parent, nickname=n, **base) for n in names]
        return parent, kids

    parent_a, (a1, a2) = make("sub-family-a", ["Zinnia-A1", "Zephyr-A2"])
    parent_b, (b1, b2) = make("sub-family-b", ["Quince-B1", "Quill-B2"])
    return SimpleNamespace(a=parent_a, a1=a1, a2=a2, b=parent_b, b1=b1, b2=b2)


@pytest.fixture
def content_catalog(db, tmp_path):
    """A small imported catalog: one location, two adventures, one quest spanning both."""
    from types import SimpleNamespace

    from apps.catalog.importer import import_content
    from apps.catalog.models import Adventure, Quest
    from apps.catalog.tests.helpers import base_collections, write_export

    collections = base_collections()
    collections["adventures.json"]["adventures"].append(
        {
            "slug": "stack-planks",
            "title": "Stack the Planks",
            "version": 2,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "stack",
            "steps": [
                {
                    "id": "stack",
                    "type": "ORDERING",
                    "objectiveIds": ["order-3"],
                    "presentation": {"kind": "complete", "text": "Stack"},
                    "transitions": [{"when": "always", "nextStepId": "complete"}],
                    "fallback": {"text": "Stack"},
                },
            ],
        }
    )
    collections["islands.json"]["islands"][0]["pack"]["adventureSlugs"].append("stack-planks")
    collections["quests.json"]["quests"][0]["stages"].append(
        {
            "id": "s2",
            "title": "Stack",
            "objectives": [
                {"id": "o2", "label": "Stack", "kind": "SOLVE", "adventureSlug": "stack-planks"}
            ],
        }
    )
    collections["quests.json"]["quests"][0]["stages"][0]["nextStageId"] = "s2"
    import_content(write_export(tmp_path / "catalog-v1", collections))
    return SimpleNamespace(
        collections=collections,
        bridge=Adventure.objects.get(slug="fix-bridge"),
        planks=Adventure.objects.get(slug="stack-planks"),
        quest=Quest.objects.get(slug="repair"),
        export_dir=tmp_path,
    )


# --- Module content baseline (test speed) ----------------------------------------------------

# Importing the real content export into an empty database takes about 3.5 seconds; importing it
# again over itself takes a few hundredths of a second. Fixtures such as `treasure` import it for
# every test, and each test's rollback throws the import away, so a module of 30 such tests spent
# almost two minutes importing. A module that opts in with
#
#     pytestmark = pytest.mark.usefixtures("module_content")
#
# imports once, inside an outer transaction that is rolled back when the module ends. Each test's
# own transaction nests inside it as a savepoint, so every test still starts from the same state,
# and the existing per-test `import_content()` calls stay correct and simply become cheap.
#
# `treasure` (and module fixtures built with `module_content.seed`) put the module on a baseline
# too, so every later test in that module sees the imported content, whether it asked for it or
# not. A test that needs the content absent says so with
#
#     @pytest.mark.without_module_content
#
# and runs after the module's other tests, with the baseline closed.
#
# A `transaction=True` test cannot run inside an outer transaction (it commits and then flushes
# the database). Before one runs, every open baseline is rolled back and stays closed; fixtures
# then fall back to seeding inside the test, exactly as before. pytest-django runs transactional
# tests after the others, so in practice a module's baseline serves all its other tests first.

_open_baselines = []
_setting_up = {}


def _is_transactional(item):
    """The same rule pytest-django uses to order transactional tests last."""
    from django.test import TestCase, TransactionTestCase
    from pytest_django.plugin import validate_django_db

    test_cls = getattr(item, "cls", None)
    if test_cls and issubclass(test_cls, TransactionTestCase):
        return not issubclass(test_cls, TestCase)
    marker = item.get_closest_marker("django_db")
    if marker:
        transaction, reset_sequences, *_ = validate_django_db(marker)
        if transaction or reset_sequences:
            return True
    fixtures = getattr(item, "fixturenames", ())
    return "transactional_db" in fixtures or "live_server" in fixtures


def _opts_out(item):
    return item.get_closest_marker("without_module_content") is not None


def _order_for_module_content(items):
    """Moves `without_module_content` tests after the rest of their module.

    Such a test closes the module's baseline, and the tests after it would then seed for
    themselves. Running it last keeps the baseline for the others. (pytest-django's own sort,
    which runs after this, keeps the order within a module.)
    """
    opted_out = [item for item in items if _opts_out(item)]
    if not opted_out:
        return
    rest = [item for item in items if not _opts_out(item)]
    last = {item.path: index for index, item in enumerate(rest)}
    trailing = {}
    for item in opted_out:
        trailing.setdefault(item.path, []).append(item)
    ordered = []
    for index, item in enumerate(rest):
        ordered.append(item)
        if last[item.path] == index:
            ordered.extend(trailing.pop(item.path, []))
    for remaining in trailing.values():
        ordered.extend(remaining)
    items[:] = ordered


def _group_for_parallel_workers(items):
    """`--dist loadgroup` groups: a module's tests on one worker, so it imports its baseline once.

    A module's transactional tests (and its `without_module_content` tests) form a separate group.
    A transactional test flushes the worker's database, migration-seeded rows included; serially
    pytest-django runs them after every other test, and a separate group, scheduled in collection
    order, keeps them after the ordinary groups on each worker too.
    """
    for item in items:
        path = item.nodeid.split("::", 1)[0]
        if _is_transactional(item):
            group = f"{path}#transactional"
        elif _opts_out(item):
            group = f"{path}#own"
        else:
            group = path
        item.add_marker(pytest.mark.xdist_group(group))


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item):
    """Runs before the item's fixtures: close the baselines a transactional test cannot share."""
    _setting_up["item"] = item
    if _open_baselines and (_is_transactional(item) or _opts_out(item)):
        for baseline in reversed(list(_open_baselines)):
            baseline.close()


class ModuleContent:
    """One module's shared baseline. `active` is False when its tests seed for themselves."""

    def __init__(self, blocker):
        self._blocker = blocker
        self._atomic = None
        self._seeded = set()
        self.active = False

    def open(self):
        from django.db import transaction

        from apps.catalog.importer import import_content

        with self._blocker.unblock():
            self._atomic = transaction.atomic()
            self._atomic.__enter__()
            self.active = True
            _open_baselines.append(self)
            try:
                import_content()
                _clear_content_caches()
            except BaseException:
                self.close()
                raise

    def seed(self, key, build):
        """Runs `build()` once into the baseline (call it from a module-scoped fixture)."""
        if self.active and key not in self._seeded:
            with self._blocker.unblock():
                build()
                _clear_content_caches()
            self._seeded.add(key)
        return self

    def has(self, key):
        """Whether `key` is in the baseline. When it is not, the test fixture seeds it itself."""
        return self.active and key in self._seeded

    def close(self):
        from django.db import transaction

        if not self.active:
            return
        self.active = False
        self._seeded.clear()
        _open_baselines.remove(self)
        with self._blocker.unblock():
            transaction.set_rollback(True)
            self._atomic.__exit__(None, None, None)
        self._atomic = None
        _clear_content_caches()


def _clear_content_caches():
    """Process caches derived from catalog rows (rows and their ids change with the baseline)."""
    from apps.progression import stories

    stories.definitions.cache_clear()


@pytest.fixture(scope="module")
def module_content(django_db_setup, django_db_blocker):
    """The module's content baseline (see above). Opt in with `usefixtures("module_content")`."""
    baseline = ModuleContent(django_db_blocker)
    item = _setting_up["item"]
    if not (_is_transactional(item) or _opts_out(item)):
        baseline.open()
    yield baseline
    baseline.close()


# --- Treasure Rush content (TR-4, on the canonical catalog since POST-MERGE-03) --------------


def seed_treasure():
    """The real content export imported and the Treasure Cove seed published."""
    from apps.catalog.importer import import_content
    from apps.core.content_status import ContentStatus
    from apps.education.models import ChallengeSpec
    from apps.regions.models import WorldRegion
    from apps.regions.treasure_rush_seed import REGION_ID, seed_treasure_rush

    import_content()
    seed_treasure_rush()
    WorldRegion.objects.filter(region_id=REGION_ID).update(status=ContentStatus.PUBLISHED)
    ChallengeSpec.objects.filter(slug__startswith="treasure-cove-").update(
        status=ContentStatus.PUBLISHED
    )
    region = WorldRegion.objects.get(region_id=REGION_ID)
    region.launch_points.update(status=ContentStatus.PUBLISHED)  # the signpost (ADR-041)


@pytest.fixture(scope="module")
def treasure_content(module_content):
    """`seed_treasure()` once per module, into the module's content baseline."""
    return module_content.seed("treasure", seed_treasure)


@pytest.fixture
def treasure(treasure_content, families):
    """The real content export imported, the Treasure Cove seed published, and the two families.

    The `families` children are Pathfinders, so the chest's challenge is the Pathfinder spec
    (addition, four choices). The quest is catalog content and active on import. The content is
    seeded once per module (`treasure_content`); a transactional test seeds it for itself.
    """
    from types import SimpleNamespace

    from apps.catalog.models import Quest
    from apps.regions.models import WorldRegion
    from apps.regions.pips_treasure_seed import PIPS_QUEST_ID
    from apps.regions.treasure_rush_seed import CHEST_ID, REGION_ID

    if not treasure_content.has("treasure"):
        seed_treasure()
    region = WorldRegion.objects.get(region_id=REGION_ID)
    return SimpleNamespace(
        families=families,
        region=region,
        # The first of Pip's four chests (TR-14), and the quest the cove offers.
        chest=region.chests.get(entity_id=CHEST_ID),
        quest=Quest.objects.get(slug=PIPS_QUEST_ID),
    )
