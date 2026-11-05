"""Conversation state service (LAI-NPC-017): bounded memory, release changes, concurrency."""

import threading

import pytest
from django.db import connection

from apps.npcs import dialogue, published, state
from apps.npcs.models import NpcConversationState
from apps.npcs.publishing import publish

from .helpers import make_character, make_dialogue, make_placement, make_staff


@pytest.fixture
def world(db):
    character = make_character("pip-test")
    make_placement(character)
    make_dialogue(character)
    publish(make_staff())
    release = published.current()
    return release, release.character("pip-test")


@pytest.mark.postgres
@pytest.mark.django_db
def test_seen_dialogues_are_bounded_and_deduplicated(world, families):
    release, character = world
    child = families.a1
    NpcConversationState.objects.create(
        child=child,
        npc_id="pip-test",
        seen_dialogue_keys=[f"d{i}" for i in range(state.MAX_SEEN_DIALOGUES)],
    )
    state.start(child, release, character, "on_interact")
    state.start(child, release, character, "on_interact")
    row = NpcConversationState.objects.get(child=child)
    assert len(row.seen_dialogue_keys) == state.MAX_SEEN_DIALOGUES
    assert row.seen_dialogue_keys[-1] == "hello" and row.seen_dialogue_keys.count("hello") == 1
    assert "d0" not in row.seen_dialogue_keys and row.visit_count == 2


@pytest.mark.postgres
@pytest.mark.django_db
def test_act_errors(world, families):
    release, character = world
    child = families.a1
    with pytest.raises(state.ConversationNotFound):
        state.act(child, release, character, "00000000-0000-0000-0000-000000000000", "end")
    started = state.start(child, release, character, "on_interact")
    with pytest.raises(dialogue.InvalidChoice):
        state.act(child, release, character, started.conversation_id, "teleport")
    NpcConversationState.objects.filter(child=child).update(release_number=release.number + 7)
    with pytest.raises(state.ConversationEnded):
        state.act(child, release, character, started.conversation_id, "end")
    assert NpcConversationState.objects.get(child=child).node_key == ""  # closed and committed


@pytest.mark.postgres
@pytest.mark.django_db(transaction=True)
def test_concurrent_starts_and_choices_keep_one_consistent_row(world, families):
    release, character = world
    child = families.a1
    errors: list[BaseException] = []
    results: list = []

    def run(fn):
        try:
            results.append(fn())
        except BaseException as error:  # noqa: BLE001 - reported below
            errors.append(error)
        finally:
            connection.close()

    starts = [
        threading.Thread(
            target=run, args=(lambda: state.start(child, release, character, "on_interact"),)
        )
        for _ in range(6)
    ]
    for t in starts:
        t.start()
    for t in starts:
        t.join()
    assert not errors
    row = NpcConversationState.objects.get(child=child)
    assert row.visit_count == 6
    current = str(row.conversation_id)

    results.clear()
    choices = [
        threading.Thread(
            target=run,
            args=(lambda: state.act(child, release, character, current, "choose", "wave-back"),),
        )
        for _ in range(4)
    ]
    for t in choices:
        t.start()
    for t in choices:
        t.join()
    # Exactly one choice moved the cursor; the others found the node had changed.
    assert len(results) == 1 and len(errors) == 3
    assert all(isinstance(e, dialogue.InvalidChoice) for e in errors)
    assert NpcConversationState.objects.get(child=child).node_key == "bye"
