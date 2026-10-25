"""Shared pytest hooks and fixtures for the Django project.

The `cognito`, `families`, and token fixtures are the tenant-isolation harness (LAI-0403). Future
child-scoped endpoint tests should use them rather than build their own. Everything is synthetic:
keys are generated per test run, ids are random, and nothing contacts AWS.
"""

import os

import pytest


def pytest_collection_modifyitems(config, items):
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
def cognito(settings, monkeypatch, cognito_key, cognito_network):
    """Configures a fake pool and routes key fetches to a local fake. Returns the key pair."""
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
            "session_minutes": 10,
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


# --- Treasure Rush content (TR-4, on the canonical catalog since POST-MERGE-03) --------------


@pytest.fixture
def treasure(families):
    """The real content export imported, the Treasure Cove seed published, and the two families.

    The `families` children are Pathfinders, so the chest's challenge is the Pathfinder spec
    (addition, four choices). The quest is catalog content and active on import.
    """
    from types import SimpleNamespace

    from apps.catalog.importer import import_content
    from apps.catalog.models import Quest
    from apps.core.content_status import ContentStatus
    from apps.education.models import ChallengeSpec
    from apps.regions.models import WorldRegion
    from apps.regions.treasure_rush_seed import QUEST_ID, REGION_ID, seed_treasure_rush

    import_content()
    seed_treasure_rush()
    WorldRegion.objects.filter(region_id=REGION_ID).update(status=ContentStatus.PUBLISHED)
    ChallengeSpec.objects.filter(slug__startswith="treasure-cove-").update(
        status=ContentStatus.PUBLISHED
    )
    region = WorldRegion.objects.get(region_id=REGION_ID)
    return SimpleNamespace(
        families=families,
        region=region,
        chest=region.chests.get(),
        quest=Quest.objects.get(slug=QUEST_ID),
    )
