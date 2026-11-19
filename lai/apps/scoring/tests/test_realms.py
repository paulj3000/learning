"""Realm compatibility adapters (GE-109): proven adventure and course completions, secret
pickups, realm milestones, and the content-drift guard. Real server flows wherever possible."""

import json
from pathlib import Path

import pytest

from apps.catalog.models import ItemDefinition, Quest
from apps.core.content_status import ContentStatus
from apps.education.models import ChallengeSpec
from apps.game_sessions import play
from apps.progression.services import record_world_change
from apps.quests.models import QuestProgress, QuestStatus
from apps.quests.services import start_quest
from apps.regions.models import AreaPuzzle, TreasureChest, WorldObjectPlacement
from apps.regions.pirates_leap_seed import (
    LEAP_CHEST_ID,
    LEAP_CHEST_KEY,
    LEAP_QUEST_ID,
    LEAP_SHELL_ID,
)
from apps.scoring import collectors, realms, reconcile
from apps.scoring.contracts import Currency, SourceKind, Trust
from apps.scoring.models import AwardLedgerEntry

from .test_collectors_and_reconcile import complete_quest, firepeak  # noqa: F401 - fixture

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

EXPORT = Path(__file__).resolve().parents[4] / "content" / "exported" / "quests.json"


def awards(child, kind):
    return list(AwardLedgerEntry.objects.filter(child=child, source_kind=kind))


def facts(child, kind):
    return [f for f in collectors.collect(child) if f.source_kind == kind]


def answer_leap_chest(treasure, child):
    """The crow's nest chest through the real play API. Its prerequisites are recorded the way
    the server records them, so only the chest itself is under test."""
    chest = TreasureChest.objects.get(region=treasure.region, entity_id=LEAP_CHEST_ID)
    # The `treasure` fixture publishes the cove's specs only; publish this chest's the same way.
    spec_ids = [
        chest.sprout_challenge_id,
        chest.pathfinder_challenge_id,
        chest.explorer_challenge_id,
    ]
    ChallengeSpec.objects.filter(pk__in=[i for i in spec_ids if i]).update(
        status=ContentStatus.PUBLISHED
    )
    session, _ = play.start_or_resume_region_session(child, treasure.region)
    for key in filter(None, [chest.required_world_change_key]):
        record_world_change(
            child,
            location_slug=treasure.region.location.slug,
            change_type="UNLOCK",
            change_key=key,
            source_session=session,
        )
    attempt, _ = play.issue_chest_challenge(session, chest, seed=11)
    return play.submit_chest_answer(child, attempt.pk, attempt.answer)


# --- Courses ----------------------------------------------------------------------------------


def test_a_forged_course_completion_awards_nothing(treasure, scoring):
    """A client can post the chest's world change and a quest state; neither is proof."""
    child = treasure.families.a1
    record_world_change(
        child, location_slug="pirate-builder-bay", change_type="UNLOCK", change_key=LEAP_CHEST_KEY
    )
    complete_quest(child, Quest.objects.get(slug=LEAP_QUEST_ID))
    reconcile.reconcile_child(child)
    assert facts(child, SourceKind.PLATFORM_COURSE) == []
    assert awards(child, SourceKind.PLATFORM_COURSE) == []


def test_the_server_graded_chest_proves_the_course_once(treasure, scoring):
    child = treasure.families.a1
    start_quest(child, Quest.objects.get(slug=LEAP_QUEST_ID))
    outcome = answer_leap_chest(treasure, child)
    assert outcome.correct
    progress = QuestProgress.objects.get(child=child, quest__slug=LEAP_QUEST_ID)
    assert progress.status == QuestStatus.COMPLETED  # the chest completes the quest

    [fact] = facts(child, SourceKind.PLATFORM_COURSE)
    assert (fact.source_ref, fact.trust, fact.scope_key) == (
        "pirates-leap",
        Trust.SERVER_BOUNDED,
        "treasure-rush-cove",
    )
    reconcile.reconcile_child(child)
    reconcile.reconcile_child(child)
    [course] = awards(child, SourceKind.PLATFORM_COURSE)
    assert (course.currency, course.amount) == (Currency.XP, 250)
    # The course replaces the quest award for the same accomplishment (dev suppress rule).
    quest_xp = [
        a for a in awards(child, SourceKind.QUEST_COMPLETED) if a.source_ref == LEAP_QUEST_ID
    ]
    assert quest_xp == []


def test_jump_and_course_claims_are_never_a_source(treasure, scoring):
    child = treasure.families.a1
    start_quest(child, Quest.objects.get(slug=LEAP_QUEST_ID))
    answer_leap_chest(treasure, child)
    assert facts(child, SourceKind.JUMP_CHALLENGE) == []
    assert all(f.trust >= Trust.SERVER_BOUNDED for f in collectors.collect(child))


# --- Secret pickups ---------------------------------------------------------------------------


def _collect(treasure, child, entity_id):
    session, _ = play.start_or_resume_region_session(child, treasure.region)
    placement = WorldObjectPlacement.objects.get(region=treasure.region, entity_id=entity_id)
    return play.collect_pickup(session, placement)


def test_a_pickup_that_grants_a_hidden_item_is_also_a_secret(treasure, scoring):
    child = treasure.families.a1
    placement = WorldObjectPlacement.objects.get(region=treasure.region, entity_id=LEAP_SHELL_ID)
    ItemDefinition.objects.filter(pk__in=placement.pickup_reward_rule.items.values("pk")).update(
        hidden=True, category="COLLECTIBLE"
    )
    _collect(treasure, child, LEAP_SHELL_ID)
    reconcile.reconcile_child(child)
    reconcile.reconcile_child(child)
    [secret] = awards(child, SourceKind.SECRET_DISCOVERED)
    assert (secret.currency, secret.amount) == (Currency.XP, 150)
    assert len(awards(child, SourceKind.PICKUP_COLLECTED)) == 1  # it stacks with the coins


def test_an_ordinary_pickup_is_not_a_secret(treasure, scoring):
    child = treasure.families.a1
    _collect(treasure, child, LEAP_SHELL_ID)
    assert facts(child, SourceKind.SECRET_DISCOVERED) == []


def test_a_forged_hidden_pickup_change_is_not_a_secret(treasure, scoring):
    child = treasure.families.a1
    record_world_change(
        child, location_slug="x", change_type="COLLECTIBLE_FOUND", change_key="NOT_AUTHORED"
    )
    assert facts(child, SourceKind.SECRET_DISCOVERED) == []


# --- Realm milestones -------------------------------------------------------------------------


def test_a_realm_milestone_needs_every_listed_adventure_and_pays_once(
    treasure, scoring, monkeypatch
):
    solo = (
        realms.RealmAdventure(
            "solo-realm",
            "pirates-leap",
            (LEAP_QUEST_ID,),
            "treasure-rush-cove",
            realms.Completion.COURSE,
        ),
        realms.RealmAdventure("solo-realm", "never", ("pips-missing-treasure",), "x"),
    )
    monkeypatch.setattr(realms, "REALM_ADVENTURES", solo)
    child = treasure.families.a1
    start_quest(child, Quest.objects.get(slug=LEAP_QUEST_ID))
    answer_leap_chest(treasure, child)
    assert facts(child, SourceKind.REALM_MILESTONE) == []  # one of two adventures done

    monkeypatch.setattr(realms, "REALM_ADVENTURES", solo[:1])
    [milestone] = facts(child, SourceKind.REALM_MILESTONE)
    assert milestone.source_ref == "solo-realm"
    reconcile.reconcile_child(child)
    reconcile.reconcile_child(child)
    assert len(awards(child, SourceKind.REALM_MILESTONE)) == 1


def test_proven_keys_come_only_from_server_records(treasure, scoring):
    child = treasure.families.a1
    record_world_change(child, location_slug="x", change_type="UNLOCK", change_key=LEAP_CHEST_KEY)
    assert LEAP_CHEST_KEY not in realms.proven_change_keys(child)
    start_quest(child, Quest.objects.get(slug=LEAP_QUEST_ID))
    answer_leap_chest(treasure, child)
    assert LEAP_CHEST_KEY in realms.proven_change_keys(child)


# --- Content drift ----------------------------------------------------------------------------


def _exported_quests() -> dict[str, dict]:
    data = json.loads(EXPORT.read_text())
    rows = data if isinstance(data, list) else data["quests"]
    return {row["id"]: row for row in rows}


@pytest.mark.parametrize("adventure", realms.REALM_ADVENTURES, ids=lambda a: a.ref)
def test_every_mapped_adventure_is_wholly_present_or_wholly_absent(adventure):
    """A partly exported adventure means a quest was renamed or removed: the mapping drifted."""
    exported = _exported_quests()
    present = [slug for slug in adventure.quests if slug in exported]
    if not present:
        pytest.skip(f"{adventure.realm}/{adventure.ref} content is not on this branch")
    assert present == list(adventure.quests)


@pytest.mark.parametrize("adventure", realms.REALM_ADVENTURES, ids=lambda a: a.ref)
def test_every_build_key_of_a_mapped_adventure_has_an_authored_server_source(
    adventure,
    treasure,
    firepeak,  # noqa: F811 - the shared fixture
):
    """Each key a mapped quest requires must be provable (a chest, puzzle or pickup authored on
    the server). Otherwise the adventure could never count, or would count on a bare change."""
    exported = _exported_quests()
    if not all(slug in exported for slug in adventure.quests):
        pytest.skip(f"{adventure.realm}/{adventure.ref} content is not on this branch")
    authored = (
        set(TreasureChest.objects.values_list("world_change_key", flat=True))
        | set(AreaPuzzle.objects.values_list("world_change_key", flat=True))
        | set(
            WorldObjectPlacement.objects.exclude(pickup_change_key="").values_list(
                "pickup_change_key", flat=True
            )
        )
    )
    for slug in adventure.quests:
        missing = realms.build_keys(Quest.objects.get(slug=slug).source) - authored
        assert not missing, f"{slug} needs keys with no server source: {sorted(missing)}"
