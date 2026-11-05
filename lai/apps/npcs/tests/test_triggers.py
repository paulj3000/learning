"""The trigger registry (LAI-NPC-013)."""

import pytest

from apps.npcs import triggers
from apps.npcs.vocabulary import TRIGGERS


def test_every_trigger_is_documented_with_an_existing_source():
    assert set(triggers.TRIGGER_SOURCES) == set(TRIGGERS)
    for source in triggers.TRIGGER_SOURCES.values():
        assert source.kind in {"engine", "play"} and source.signal and source.note
    engine = {k for k, s in triggers.TRIGGER_SOURCES.items() if s.kind == "engine"}
    assert engine == {"on_spawn", "on_player_near", "on_interact"}


@pytest.mark.parametrize("value", list(TRIGGERS))
def test_known_triggers_validate(value):
    assert triggers.validate_trigger(value) == value


@pytest.mark.parametrize("value", ["", "on_dance", "ON_INTERACT", None, 3, ["on_spawn"]])
def test_unknown_triggers_are_refused(value):
    with pytest.raises(triggers.InvalidTrigger):
        triggers.validate_trigger(value)
