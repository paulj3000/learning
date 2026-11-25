"""LAI-07 W2-5: `usages_by_source` answers per source, in registration order, isolating failures."""

import pytest

from apps.assets import dependencies
from apps.assets.dependencies import SourceUsages, Usage
from apps.assets.tests.helpers import make_definition

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


@pytest.fixture
def registry(monkeypatch):
    monkeypatch.setattr(dependencies, "_PROVIDERS", {})
    return dependencies


def test_historical_defaults_to_false():
    assert Usage("npcs", "", "x").historical is False
    assert Usage("npcs", "", "x", historical=True).historical is True


def test_one_entry_per_source_in_registration_order(registry):
    asset = make_definition("palm")
    registry.register_usage_provider("b", lambda a, v: [Usage("b", "c", "B row")])
    registry.register_usage_provider("a", lambda a, v: [])
    registry.register_usage_provider(
        "c", lambda a, v: iter([Usage("c", "", "C1"), Usage("c", "", "C2")])
    )
    entries = registry.usages_by_source(asset)
    assert [e.source for e in entries] == ["b", "a", "c"]
    assert [[u.label for u in e.usages] for e in entries] == [["B row"], [], ["C1", "C2"]]
    assert not any(e.failed for e in entries)
    assert isinstance(entries[0], SourceUsages)


def test_a_failing_source_does_not_hide_the_others(registry, caplog):
    asset = make_definition("palm")

    def broken(a, v):
        raise RuntimeError("private detail")

    registry.register_usage_provider("ok1", lambda a, v: [Usage("ok1", "", "one")])
    registry.register_usage_provider("bad", broken)
    registry.register_usage_provider("ok2", lambda a, v: [Usage("ok2", "", "two")])
    entries = registry.usages_by_source(asset)
    assert [(e.source, e.failed) for e in entries] == [
        ("ok1", False),
        ("bad", True),
        ("ok2", False),
    ]
    assert entries[1].usages == ()
    assert [u.label for u in entries[2].usages] == ["two"]
    assert "private detail" not in caplog.text
    assert "source=bad" in caplog.text


def test_the_version_is_passed_through(registry):
    asset = make_definition("palm")
    seen = []
    registry.register_usage_provider("s", lambda a, v: seen.append(v) or [])
    registry.usages_by_source(asset, None)
    assert seen == [None]
