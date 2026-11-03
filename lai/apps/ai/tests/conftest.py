"""Fixtures for the AI tests. Nothing here reaches AWS: the model is always `FakeModelClient`."""

import pytest

from apps.ai.providers import override_model_client
from apps.ai.providers.fake import FakeModelClient


@pytest.fixture(autouse=True)
def _fresh_rate_limit_counters():
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def fake_model():
    """fake_model(*scripted, **kwargs) installs and returns a FakeModelClient."""
    installed = []

    def install(*responses, **kwargs):
        client = FakeModelClient(responses, **kwargs)
        context = override_model_client(client)
        context.__enter__()
        installed.append(context)
        return client

    yield install
    for context in reversed(installed):
        context.__exit__(None, None, None)


AI_STEPS = [
    {
        "id": "count",
        "type": "NUMBER_INPUT",
        "objectiveIds": ["counting-sets"],
        "presentation": {
            "kind": "number-input",
            "prompt": "How many planks are missing?",
            "correctValue": 4,
        },
        "transitions": [
            {"when": "correct", "nextStepId": "pick"},
            {"when": "incorrect", "nextStepId": "count"},
        ],
        "hintPolicy": {"ladder": ["Look again", "Count the gaps", "There are 4 gaps"]},
        "fallback": {"text": "Count"},
    },
    {
        "id": "pick",
        "type": "CREATIVE_CHOICE",
        "objectiveIds": [],
        "presentation": {
            "kind": "creative-choice",
            "prompt": "Who sails the ship?",
            "options": [{"id": "knight", "label": "Knight"}, {"id": "wizard", "label": "Wizard"}],
        },
        "transitions": [{"when": "always", "nextStepId": "complete"}],
        "fallback": {"text": "Pick"},
    },
]


@pytest.fixture
def ai_catalog(db, tmp_path):
    """One adventure, `ai-bridge`, with a hinted counting step and a creative choice step."""
    from apps.catalog.importer import import_content
    from apps.catalog.tests.helpers import base_collections, write_export

    collections = base_collections()
    collections["adventures.json"]["adventures"] = [
        {
            "slug": "ai-bridge",
            "title": "Bridge",
            "version": 1,
            "locationSlug": "bay",
            "ageBands": ["PATHFINDER"],
            "entryStepId": "count",
            "steps": AI_STEPS,
        }
    ]
    collections["islands.json"]["islands"][0]["pack"]["adventureSlugs"] = ["ai-bridge"]
    collections["quests.json"]["quests"][0]["stages"][0]["objectives"][0]["adventureSlug"] = (
        "ai-bridge"
    )
    import_content(write_export(tmp_path / "ai-v1", collections))
    return collections


@pytest.fixture
def start_session():
    from apps.catalog.models import Adventure
    from apps.game_sessions import services

    def start(child, slug="ai-bridge"):
        return services.start_or_resume_session(child, Adventure.objects.get(slug=slug))[0]

    return start
