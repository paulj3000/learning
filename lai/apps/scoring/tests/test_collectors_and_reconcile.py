"""Collectors, the reconciler and the live hooks, driven by the real server flows (GE-104,
GE-109): chests, pickups, puzzles, quests, step answers, backfill and isolation."""

import uuid
from io import StringIO

import pytest
from django.core.management import CommandError, call_command
from django.utils.timezone import now

from apps.catalog.importer import import_content
from apps.catalog.models import ItemDefinition, Quest
from apps.core.content_status import ContentStatus
from apps.education.models import SkillProgress
from apps.game_sessions import play, services
from apps.game_sessions.models import AdventureAction, ChallengeAttempt
from apps.game_sessions.models import Correctness as Graded
from apps.inventory.models import GrantedRule, InventoryItem
from apps.progression.models import WorldChange
from apps.progression.services import record_world_change
from apps.quests.models import QuestProgress, QuestStatus
from apps.regions import firepeak_seed
from apps.regions.firepeak_seed import seed_firepeak
from apps.regions.models import AreaPuzzle, PlacementKind, WorldObjectPlacement, WorldRegion
from apps.regions.pips_treasure_seed import KEY_ENTITY_ID, KEY_FOUND_KEY
from apps.regions.treasure_rush_seed import REGION_ID
from apps.scoring import collectors, ledger, policies, reconcile, rules
from apps.scoring.contracts import Currency, SourceKind, Trust
from apps.scoring.models import AwardLedgerEntry, ProgressionProjection

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


# --- Helpers ----------------------------------------------------------------------------------


def entries(child, kind=None, currency=None):
    rows = AwardLedgerEntry.objects.filter(child=child)
    if kind:
        rows = rows.filter(source_kind=kind)
    if currency:
        rows = rows.filter(currency=currency)
    return list(rows)


def sync(child):
    return reconcile.reconcile_child(child)


def wrong_choice(attempt):
    return next(c for c in attempt.choices if c != attempt.answer)


def open_session(treasure, child=None):
    child = child or treasure.families.a1
    session, _ = play.start_or_resume_region_session(child, treasure.region)
    return child, session


def answer_chest(treasure, child=None, *, right=True, session=None, chest=None, seed=7):
    child, session = (child, session) if session else open_session(treasure, child)
    attempt, _ = play.issue_chest_challenge(session, chest or treasure.chest, seed=seed)
    value = attempt.answer if right else wrong_choice(attempt)
    return play.submit_chest_answer(child, attempt.pk, value)


def key_placement(treasure):
    return WorldObjectPlacement.objects.get(region=treasure.region, entity_id=KEY_ENTITY_ID)


def set_key_category(treasure, category):
    rule = key_placement(treasure).pickup_reward_rule
    ItemDefinition.objects.filter(pk__in=rule.items.values("pk")).update(category=category)


def pickup(treasure, child=None):
    child, session = open_session(treasure, child)
    return play.collect_pickup(session, key_placement(treasure))


def facts(child, kind):
    return [f for f in collectors.collect(child) if f.source_kind == kind]


def complete_quest(child, quest, *, at=None):
    at = at or now()
    return QuestProgress.objects.create(
        child=child,
        quest=quest,
        status=QuestStatus.COMPLETED,
        current_stage_id="s",
        started_at=at,
        last_updated_at=at,
        completed_at=at,
    )


@pytest.fixture
def firepeak(families):
    from apps.regions.firepeak_seed import REGION_ID as FP

    import_content()
    seed_firepeak()
    WorldRegion.objects.filter(region_id=FP).update(status=ContentStatus.PUBLISHED)
    AreaPuzzle.objects.filter(region__region_id=FP).update(status=ContentStatus.PUBLISHED)
    return WorldRegion.objects.get(region_id=FP)


# --- Learning challenges ----------------------------------------------------------------------


def test_a_correct_chest_answer_awards_learning_points_once(treasure, scoring):
    child = treasure.families.a1
    outcome = answer_chest(treasure)
    assert outcome.correct
    result = sync(child)
    assert result.enabled
    [award] = entries(child, SourceKind.LEARNING_CHALLENGE)
    assert (award.currency, award.amount) == (Currency.LEARNING_POINTS, 250)
    assert award.source_ref == f"{REGION_ID}/{treasure.chest.entity_id}"
    assert award.trust == Trust.SERVER_GRADED and award.scope_key == REGION_ID
    assert award.policy_version == scoring.version and award.session_id is not None
    # A repeat reconcile, and any further attempt on the same chest, pay nothing more.
    assert sync(child).new_entries == ()
    assert len(entries(child, SourceKind.LEARNING_CHALLENGE)) == 1


def test_a_second_correct_answer_path_to_the_same_chest_pays_nothing(treasure, scoring):
    child = treasure.families.a1
    answer_chest(treasure)
    sync(child)
    # The chest is open: the server refuses a new attempt at it, and answering the same
    # attempt again is refused too, so there is no second path to a second award.
    _, session = open_session(treasure)
    with pytest.raises(play.ChestAlreadyOpen):
        play.issue_chest_challenge(session, treasure.chest, seed=9)
    attempt = ChallengeAttempt.objects.get(child=child)
    with pytest.raises(play.AttemptAlreadyAnswered):
        play.submit_chest_answer(child, attempt.pk, attempt.answer)
    sync(child)
    assert len(entries(child, SourceKind.LEARNING_CHALLENGE)) == 1
    assert ChallengeAttempt.objects.filter(child=child).count() == 1


def test_a_replay_chest_awards_nothing(treasure, scoring):
    from apps.regions.models import ChestPresentation

    child = treasure.families.a1
    replay = treasure.chest
    replay.presentation = ChestPresentation.REPLAY
    replay.save()
    outcome = answer_chest(treasure, chest=replay)
    assert outcome.correct
    sync(child)
    assert entries(child, SourceKind.LEARNING_CHALLENGE) == []
    assert facts(child, SourceKind.LEARNING_CHALLENGE) == []


def test_a_wrong_answer_then_a_right_one_only_ever_awards_positive_amounts(treasure, scoring):
    child, session = open_session(treasure)
    first, _ = play.issue_chest_challenge(session, treasure.chest, seed=3)
    assert not play.submit_chest_answer(child, first.pk, wrong_choice(first)).correct
    sync(child)
    assert entries(child, SourceKind.LEARNING_CHALLENGE) == []
    assert ProgressionProjection.objects.get(child=child).learning_points == 0
    second, _ = play.issue_chest_challenge(session, treasure.chest, seed=4)
    assert play.submit_chest_answer(child, second.pk, second.answer).correct
    sync(child)
    assert len(entries(child, SourceKind.LEARNING_CHALLENGE)) == 1
    assert all(e.amount > 0 and e.entry_kind == "AWARD" for e in entries(child))


def test_a_hinted_correct_step_answer_earns_the_same_as_an_unhinted_one(
    families, content_catalog, scoring
):
    # Real step adventure (`fix-bridge`, from the shared content_catalog fixture).
    plain, hinted = families.a1, families.a2
    session_plain, _ = services.start_or_resume_session(plain, content_catalog.bridge)
    session_hint, _ = services.start_or_resume_session(hinted, content_catalog.bridge)
    level, _ = services.request_hint(hinted, session_hint.pk, step_id="count", from_level=0)
    assert level >= 1
    answer = {"kind": "number-input", "value": 3}
    for child, session in ((plain, session_plain), (hinted, session_hint)):
        outcome = services.submit_answer(
            child, session.pk, step_id="count", answer=answer, request_id=uuid.uuid4()
        )
        assert outcome.correctness == "CORRECT"
    assert AdventureAction.objects.get(session=session_hint).hint_level >= 1
    assert AdventureAction.objects.get(session=session_plain).hint_level == 0
    sync(plain)
    sync(hinted)
    [a] = entries(plain, SourceKind.ANSWER_CORRECT)
    [b] = entries(hinted, SourceKind.ANSWER_CORRECT)
    assert (a.currency, a.amount) == (b.currency, b.amount) == (Currency.LEARNING_POINTS, 100)
    assert a.source_ref == b.source_ref == "fix-bridge/count"
    # The finished adventure is a separate once-per-adventure award.
    assert len(entries(plain, SourceKind.ADVENTURE_COMPLETED)) == 1


def test_an_answer_row_with_a_support_level_counts_the_same_as_none(
    families, content_catalog, scoring
):
    # Rows constructed directly, as the engine would write them (support level 0 and 4).
    child = families.a1
    for slug_session, level in ((content_catalog.bridge, 4),):
        session, _ = services.start_or_resume_session(child, slug_session)
        AdventureAction.objects.create(
            session=session,
            step_id="count",
            action_type="ANSWER",
            correctness=Graded.CORRECT,
            hint_level=level,
            attempt_number=1,
            created_at=now(),
        )
    sync(child)
    [award] = entries(child, SourceKind.ANSWER_CORRECT)
    assert award.amount == 100


def test_an_incorrect_step_answer_awards_nothing(families, content_catalog, scoring):
    child = families.a1
    session, _ = services.start_or_resume_session(child, content_catalog.bridge)
    services.submit_answer(
        child,
        session.pk,
        step_id="count",
        answer={"kind": "number-input", "value": 9},
        request_id=uuid.uuid4(),
    )
    sync(child)
    assert entries(child, SourceKind.ANSWER_CORRECT) == []


def test_mastery_milestones_are_facts_and_kept(families, scoring):
    child = families.a1
    SkillProgress.objects.create(
        child=child,
        learning_objective_code="count-10",
        exposure_count=5,
        independent_success_count=5,
        consecutive_independent_correct=5,
        recent_level="MASTERED",
    )
    refs = {f.source_ref for f in facts(child, SourceKind.MASTERY_MILESTONE)}
    assert refs == {"count-10/PROFICIENT", "count-10/MASTERED"}
    sync(child)
    assert len(entries(child, SourceKind.MASTERY_MILESTONE)) == 2
    SkillProgress.objects.filter(child=child).update(recent_level="DEVELOPING")
    sync(child)
    assert len(entries(child, SourceKind.MASTERY_MILESTONE)) == 2  # never taken back


# --- Pickups ----------------------------------------------------------------------------------


def test_collecting_an_authored_collectible_pickup_gives_coins_once(treasure, scoring):
    child = treasure.families.a1
    set_key_category(treasure, "COLLECTIBLE")
    assert pickup(treasure).picked_up
    sync(child)
    [coin] = entries(child, SourceKind.PICKUP_COLLECTED)
    assert (coin.currency, coin.amount) == (Currency.COINS, 10)
    assert coin.source_ref == f"{REGION_ID}/{KEY_FOUND_KEY}" and coin.trust == Trust.SERVER_BOUNDED
    assert not pickup(treasure).picked_up
    sync(child)
    assert len(entries(child, SourceKind.PICKUP_COLLECTED)) == 1


def test_a_quest_item_pickup_earns_no_coins(treasure, scoring):
    child = treasure.families.a1
    set_key_category(treasure, "QUEST_ITEM")
    pickup(treasure)
    [fact] = facts(child, SourceKind.PICKUP_COLLECTED)
    assert fact.attributes == {"itemCategory": "QUEST_ITEM"}
    sync(child)
    assert entries(child, SourceKind.PICKUP_COLLECTED) == []
    assert ProgressionProjection.objects.get(child=child).coins == 0


def test_the_pickup_category_prefers_quest_item_then_keepsake_then_alphabetical():
    cat = collectors._category
    assert cat({"COLLECTIBLE", "QUEST_ITEM", "KEEPSAKE"}) == "QUEST_ITEM"
    assert cat({"COLLECTIBLE", "KEEPSAKE"}) == "KEEPSAKE"
    assert cat({"ZED", "COLLECTIBLE"}) == "COLLECTIBLE"
    assert cat(set()) == ""


def test_a_pickup_without_a_reward_rule_has_an_empty_category_and_earns_no_coins(treasure, scoring):
    child = treasure.families.a1
    pickup(treasure)
    WorldObjectPlacement.objects.filter(pk=key_placement(treasure).pk).update(
        pickup_reward_rule=None
    )
    [fact] = facts(child, SourceKind.PICKUP_COLLECTED)
    assert fact.attributes == {"itemCategory": ""}
    sync(child)
    assert entries(child, SourceKind.PICKUP_COLLECTED) == []


def test_a_forged_world_change_that_is_not_an_authored_pickup_gives_nothing(treasure, scoring, api):
    child = treasure.families.a1
    set_key_category(treasure, "COLLECTIBLE")
    record_world_change(
        child,
        location_slug="pirate-builder-bay",
        change_type="COLLECTIBLE_FOUND",
        change_key="FORGED_GOLD_MOUNTAIN",
    )
    # An authored key posted under the wrong change type is not a pickup either.
    record_world_change(
        child,
        location_slug="pirate-builder-bay",
        change_type="UNLOCK",
        change_key=KEY_FOUND_KEY,
    )
    assert facts(child, SourceKind.PICKUP_COLLECTED) == []
    sync(child)
    assert entries(child, SourceKind.PICKUP_COLLECTED) == []


def test_a_client_posted_unlock_world_change_awards_nothing(treasure, scoring, api):
    import json

    child = treasure.families.a1
    response = api(treasure.families.a).post(
        f"/api/v1/children/{child.pk}/world-changes/",
        json.dumps(
            {
                "locationSlug": "pirate-builder-bay",
                "changeType": "UNLOCK",
                "changeKey": "SOMETHING_GREAT",
            }
        ),
        content_type="application/json",
    )
    assert response.status_code in (200, 201), response.content
    assert WorldChange.objects.filter(child=child, change_key="SOMETHING_GREAT").exists()
    sync(child)
    assert entries(child) == []


def test_world_changes_alone_never_prove_a_chest_or_puzzle(treasure, scoring):
    child = treasure.families.a1
    record_world_change(
        child,
        location_slug="pirate-builder-bay",
        change_type="CHEST_OPENED",
        change_key=treasure.chest.world_change_key,
    )
    sync(child)
    assert entries(child, SourceKind.LEARNING_CHALLENGE) == []


# --- Exploration ------------------------------------------------------------------------------


def test_the_first_visit_to_a_region_awards_once_however_many_sessions_follow(treasure, scoring):
    child, session = open_session(treasure)
    sync(child)
    [visit] = entries(child, SourceKind.LOCATION_FIRST_VISIT)
    assert (visit.currency, visit.amount, visit.source_ref) == (Currency.XP, 50, REGION_ID)
    assert visit.session_id == session.pk
    play.end_session(session)
    for _ in range(2):
        again, _ = play.start_or_resume_region_session(child, treasure.region)
        play.end_session(again)
    assert child.pk and AwardLedgerEntry.objects.filter(child=child).count() >= 1
    sync(child)
    assert len(entries(child, SourceKind.LOCATION_FIRST_VISIT)) == 1


def test_puzzles_award_by_trust_tier(families, firepeak, scoring):
    child = families.a1
    session, _ = play.start_or_resume_region_session(child, firepeak)
    steps = [
        ("firepeak-telescope", {"observed": ["crater", "lava-flow", "steam-vent"]}),
        (
            "firepeak-crossing",
            {
                "placements": {
                    "firepeak-gap-near": "firepeak-stone-small",
                    "firepeak-gap-middle": "firepeak-stone-middle",
                    "firepeak-gap-far": "firepeak-stone-big",
                }
            },
        ),
        (
            "firepeak-steam",
            {"sequence": ["firepeak-valve-red", "firepeak-valve-blue", "firepeak-valve-green"]},
        ),
        ("firepeak-heart-crystal", {}),
        ("firepeak-return", {}),
    ]
    for puzzle_id, submission in steps:
        assert play.solve_puzzle(child, session.pk, puzzle_id, submission).correct, puzzle_id
    sync(child)
    awards = {e.source_ref: e for e in entries(child, SourceKind.PUZZLE_SOLVED)}
    region_id = firepeak_seed.REGION_ID
    assert set(awards) == {f"{region_id}/{p}" for p, _ in steps}
    for puzzle_id, _ in steps[:3]:  # graded kinds
        assert awards[f"{region_id}/{puzzle_id}"].trust == Trust.SERVER_GRADED
    for puzzle_id, _ in steps[3:]:  # COLLECT_OBJECT and RETURN_TO_NPC
        assert awards[f"{region_id}/{puzzle_id}"].trust == Trust.SERVER_BOUNDED
    assert {e.amount for e in awards.values()} == {150}
    # Solving again is a no-op for the ledger.
    assert play.solve_puzzle(child, session.pk, "firepeak-return", {}).already_solved
    assert sync(child).new_entries == ()


def test_a_wrong_puzzle_submission_awards_nothing(families, firepeak, scoring):
    child = families.a1
    session, _ = play.start_or_resume_region_session(child, firepeak)
    assert not play.solve_puzzle(
        child, session.pk, "firepeak-telescope", {"observed": ["crater"]}
    ).correct
    sync(child)
    assert entries(child, SourceKind.PUZZLE_SOLVED) == []


# --- Quests, rewards, discoveries -------------------------------------------------------------


def test_a_completed_quest_awards_once(treasure, scoring):
    child = treasure.families.a1
    complete_quest(child, treasure.quest)
    sync(child)
    [award] = entries(child, SourceKind.QUEST_COMPLETED)
    assert (award.currency, award.amount, award.source_ref) == (
        Currency.XP,
        250,
        treasure.quest.slug,
    )
    sync(child)
    assert len(entries(child, SourceKind.QUEST_COMPLETED)) == 1


def test_the_legacy_treasure_rush_quest_is_suppressed_by_the_dev_policy(treasure, scoring):
    child = treasure.families.a1
    legacy = Quest.objects.get(slug="treasure-rush-cove")
    rule = scoring.rules.get(rule_key="legacy-treasure-rush-cove")
    assert rule.suppress and rule.selector == "treasure-rush-cove"
    complete_quest(child, legacy)
    complete_quest(child, treasure.quest)
    # Both are facts; only the ordinary quest pays.
    assert {f.source_ref for f in facts(child, SourceKind.QUEST_COMPLETED)} == {
        "treasure-rush-cove",
        treasure.quest.slug,
    }
    sync(child)
    [award] = entries(child, SourceKind.QUEST_COMPLETED)
    assert (award.source_ref, award.amount) == (treasure.quest.slug, 250)
    assert sync(child).new_entries == ()


def test_an_active_quest_that_is_not_completed_awards_nothing(treasure, scoring):
    child = treasure.families.a1
    at = now()
    QuestProgress.objects.create(
        child=child,
        quest=treasure.quest,
        status=QuestStatus.ACTIVE,
        current_stage_id="s",
        started_at=at,
        last_updated_at=at,
    )
    sync(child)
    assert entries(child, SourceKind.QUEST_COMPLETED) == []


def test_an_inactive_quests_completion_yields_no_fact(treasure, scoring):
    child = treasure.families.a1
    complete_quest(child, treasure.quest)
    Quest.objects.filter(pk=treasure.quest.pk).update(active=False)
    assert facts(child, SourceKind.QUEST_COMPLETED) == []
    sync(child)
    assert entries(child, SourceKind.QUEST_COMPLETED) == []


def test_a_granted_rule_is_a_reward_rule_fact(treasure, scoring):
    child = treasure.families.a1
    rule = treasure.chest.reward_rule
    from apps.inventory.services import grant_reward_rule

    grant_reward_rule(child, rule)
    [fact] = facts(child, SourceKind.REWARD_RULE_GRANTED)
    assert fact.source_ref == rule.rule_id and fact.trust == Trust.SERVER_BOUNDED
    assert set(fact.attributes) == {"triggerType", "itemCategory"}
    # The development policy has no rule for it, so nothing is paid.
    sync(child)
    assert entries(child, SourceKind.REWARD_RULE_GRANTED) == []


def test_discoveries_come_only_from_the_servers_world_state(families, scoring):
    from apps.progression.models import WorldState

    child = families.a1
    assert facts(child, SourceKind.SECRET_DISCOVERED) == []
    WorldState.objects.create(
        child=child, discovered_objects=["hidden-cove", "hidden-cove"], updated_at=now()
    )
    [fact] = facts(child, SourceKind.SECRET_DISCOVERED)
    assert fact.source_ref == "hidden-cove" and fact.trust == Trust.SERVER_GRADED
    sync(child)
    [award] = entries(child, SourceKind.SECRET_DISCOVERED)
    assert award.amount == 150


# --- Stars ------------------------------------------------------------------------------------


def goal_counts(region):
    chests = region.chests.exclude(presentation="REPLAY").count()
    pickups = sum(p.is_pickup for p in region.placements.all())
    puzzles = region.puzzles.filter(status=ContentStatus.PUBLISHED).count()
    return chests + pickups + puzzles


def test_stars_follow_met_goals_and_are_never_lost_when_goals_are_added(treasure, scoring):
    child = treasure.families.a1
    region = treasure.region
    # Fixture data: make the cove's other chests practice-only so its goals are the one chest
    # and its three pickups.
    region.chests.exclude(pk=treasure.chest.pk).update(presentation="REPLAY")
    total = goal_counts(region)
    assert total == 4  # the chest and the cove's three pickups
    assert rules.stars_for(2, total) == 1
    answer_chest(treasure)
    pickup(treasure)
    sync(child)
    earned = rules.stars_for(2, total)
    assert len(entries(child, SourceKind.ADVENTURE_STAR)) == earned
    assert earned >= 1, "fixture should be able to earn a star from two goals"
    assert [e.source_ref for e in entries(child, SourceKind.ADVENTURE_STAR)] == [
        f"{REGION_ID}/{n}" for n in range(1, earned + 1)
    ]
    assert ProgressionProjection.objects.get(child=child).stars == earned
    # An author adds more goals: the fraction shrinks, the earned stars stay in the ledger.
    for n in range(total * 3):
        WorldObjectPlacement.objects.create(
            region=region,
            entity_id=f"extra-coin-{n}",
            kind=PlacementKind.COLLECTIBLE,
            label="Extra",
            x=1.0,
            z=1.0,
            pickup_change_key=f"EXTRA_{n}",
            placeholder_width=0.2,
            placeholder_height=0.2,
            placeholder_depth=0.2,
        )
    assert rules.stars_for(2, goal_counts(region)) < earned or earned == 1
    sync(child)
    assert len(entries(child, SourceKind.ADVENTURE_STAR)) == earned
    assert ProgressionProjection.objects.get(child=child).stars == earned


def test_stars_never_exceed_the_maximum(treasure, scoring):
    child = treasure.families.a1
    answer_chest(treasure)
    sync(child)
    assert len(entries(child, SourceKind.ADVENTURE_STAR)) <= rules.MAX_STARS


# --- Exclusion --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "key, excluded",
    [
        ("playground", True),
        ("playground-nursery", True),
        ("dev-cove", True),
        ("test-area", True),
        ("engine-playground-1", True),
        ("treasure-rush-cove", False),
        ("a-dev-cove", False),
        ("", False),
    ],
)
def test_is_excluded_prefixes(key, excluded):
    assert collectors.is_excluded(key) is excluded


def test_configured_prefixes_extend_the_defaults(settings):
    settings.LAI_SCORING_EXCLUDED_SCOPE_PREFIXES = ["sandbox-"]
    assert collectors.is_excluded("sandbox-1") and collectors.is_excluded("playground")
    assert not collectors.is_excluded("treasure-rush-cove")


@pytest.mark.parametrize("region_id", ["playground-island", "dev-cove"])
def test_activity_in_an_excluded_region_yields_no_facts(treasure, scoring, region_id):
    child, session = open_session(treasure)
    answer_chest(treasure, session=session, child=child)
    pickup(treasure)
    complete_quest(child, treasure.quest)  # the quest slug is not excluded, only the region is
    assert any(f.scope_key == REGION_ID for f in collectors.collect(child))
    from apps.game_sessions.models import AdventureSession

    AdventureSession.objects.filter(child=child).update(region_id=region_id)
    ChallengeAttempt.objects.filter(child=child).update(region_id=region_id)
    scoped = [f for f in collectors.collect(child) if f.source_kind != SourceKind.QUEST_COMPLETED]
    assert [f for f in scoped if f.scope_key == region_id] == []
    assert not [
        f
        for f in scoped
        if f.source_kind in (SourceKind.LEARNING_CHALLENGE, SourceKind.LOCATION_FIRST_VISIT)
    ]


def test_an_excluded_adventure_slug_yields_no_answer_facts(families, content_catalog, scoring):
    from apps.catalog.models import Adventure

    child = families.a1
    Adventure.objects.filter(pk=content_catalog.bridge.pk).update(slug="dev-bridge")
    adventure = Adventure.objects.get(slug="dev-bridge")
    session, _ = services.start_or_resume_session(child, adventure)
    AdventureAction.objects.create(
        session=session,
        step_id="count",
        action_type="ANSWER",
        correctness=Graded.CORRECT,
        attempt_number=1,
        created_at=now(),
    )
    assert facts(child, SourceKind.ANSWER_CORRECT) == []


# --- Policy gate, backfill, versions ----------------------------------------------------------


def test_reconcile_does_nothing_while_the_engine_is_off(treasure, dev_policy):
    child = treasure.families.a1
    answer_chest(treasure)
    result = sync(child)
    assert result.enabled is False and result.new_entries == ()
    assert not AwardLedgerEntry.objects.exists()


def test_the_reconcile_command_refuses_while_off(treasure, dev_policy):
    with pytest.raises(CommandError):
        call_command("scoring_reconcile")


def test_backfill_awards_existing_records_once_and_preserves_child_data(
    treasure, dev_policy, settings
):
    child = treasure.families.a1
    # Existing progress, recorded while scoring is OFF.
    answer_chest(treasure)
    pickup(treasure)
    complete_quest(child, treasure.quest)
    assert not AwardLedgerEntry.objects.exists()
    assert not ProgressionProjection.objects.exists()
    before = {
        "inventory": InventoryItem.objects.filter(child=child).count(),
        "granted": GrantedRule.objects.filter(child=child).count(),
        "quests": QuestProgress.objects.filter(child=child).count(),
        "changes": WorldChange.objects.filter(child=child).count(),
    }
    assert all(before.values())

    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True
    dry = StringIO()
    call_command("scoring_reconcile", "--dry-run", stdout=dry)
    assert "would consider" in dry.getvalue() and not AwardLedgerEntry.objects.exists()

    first = StringIO()
    call_command("scoring_reconcile", stdout=first)
    assert "0 award(s)" not in first.getvalue()
    assert AwardLedgerEntry.objects.filter(child=child).exists()
    count = AwardLedgerEntry.objects.count()
    second = StringIO()
    call_command("scoring_reconcile", stdout=second)
    assert "0 award(s)" in second.getvalue()
    assert AwardLedgerEntry.objects.count() == count
    assert before == {
        "inventory": InventoryItem.objects.filter(child=child).count(),
        "granted": GrantedRule.objects.filter(child=child).count(),
        "quests": QuestProgress.objects.filter(child=child).count(),
        "changes": WorldChange.objects.filter(child=child).count(),
    }
    # One child can be targeted.
    single = StringIO()
    call_command("scoring_reconcile", "--child", str(child.pk), stdout=single)
    assert "1 children" in single.getvalue()


def test_reconciling_one_child_never_touches_another_familys_child(treasure, dev_policy, settings):
    """GE-090-D1: `--child` reaches the child through the users service and reconciles only that
    child; another family's child with its own records is left alone."""
    mine, theirs = treasure.families.a1, treasure.families.b1
    complete_quest(mine, treasure.quest)
    complete_quest(theirs, treasure.quest)
    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True
    out = StringIO()
    call_command("scoring_reconcile", "--child", str(mine.pk), stdout=out)
    assert "1 children" in out.getvalue()
    assert AwardLedgerEntry.objects.filter(child=mine).exists()
    assert not AwardLedgerEntry.objects.filter(child=theirs).exists()
    assert not ProgressionProjection.objects.filter(child=theirs).exists()


def test_an_unknown_child_reconciles_nothing(treasure, scoring):
    known = treasure.families.a1
    complete_quest(known, treasure.quest)  # real, unreconciled records exist
    out = StringIO()
    call_command("scoring_reconcile", "--child", str(uuid.uuid4()), stdout=out)
    assert "0 children" in out.getvalue()
    reconcile._run(uuid.uuid4())  # the on-commit job: an unknown id is a quiet no-op
    # Neither path reconciled anyone else: the known child's records are still unpaid.
    assert not AwardLedgerEntry.objects.exists()
    assert not ProgressionProjection.objects.exists()


def projection_state(child):
    return ProgressionProjection.objects.filter(child=child).values(*PROJECTION_TOTALS).get()


PROJECTION_TOTALS = ("xp", "learning_points", "coins", "stars", "entry_count", "last_entry_at")


def test_verify_projections_reports_each_child_without_crossing_families(treasure, scoring):
    """Both families have real ledgers and projections; only `mine` is wrong. The rebuild repairs
    `mine` from its own ledger and leaves `theirs` exactly as it was."""
    mine, theirs = treasure.families.a1, treasure.families.b1
    complete_quest(mine, treasure.quest)
    answer_chest(treasure, mine)  # `mine` earns more, so a rebuild from the wrong ledger shows
    complete_quest(theirs, treasure.quest)
    sync(mine)
    sync(theirs)
    assert ledger.ledger_totals(mine)["xp"] != ledger.ledger_totals(theirs)["xp"]
    theirs_ledger = list(AwardLedgerEntry.objects.filter(child=theirs).values_list("pk", flat=True))
    assert theirs_ledger  # `theirs` really has scoring state to protect
    theirs_before = projection_state(theirs)
    ProgressionProjection.objects.filter(child=mine).update(xp=987654)  # a deliberate mismatch
    out = StringIO()
    call_command("scoring_verify_projections", "--rebuild", stdout=out)
    assert "1 mismatched" in out.getvalue()
    assert projection_state(theirs) == theirs_before
    assert (
        list(AwardLedgerEntry.objects.filter(child=theirs).values_list("pk", flat=True))
        == theirs_ledger
    )
    assert projection_state(mine)["xp"] == ledger.ledger_totals(mine)["xp"] != 987654
    check = StringIO()
    call_command("scoring_verify_projections", stdout=check)
    assert "0 mismatched" in check.getvalue()


def test_a_new_policy_version_does_not_pay_earned_sources_again(treasure, scoring):
    child = treasure.families.a1
    answer_chest(treasure)
    sync(child)
    [first] = entries(child, SourceKind.LEARNING_CHALLENGE)
    totals = ProgressionProjection.objects.get(child=child)
    lp = totals.learning_points
    draft = policies.clone_to_draft(scoring)
    rule = draft.rules.get(rule_key="learning-challenge")
    rule.amount = 999
    rule.save()
    rule = draft.rules.get(rule_key="quest-completion")
    rule.amount = 777
    rule.save()
    v2 = policies.activate(draft)
    assert v2.version == 2
    assert sync(child).new_entries == ()
    assert ProgressionProjection.objects.get(child=child).learning_points == lp
    [still] = entries(child, SourceKind.LEARNING_CHALLENGE)
    assert still.pk == first.pk and still.amount == 250 and still.policy_version == 1
    # A source earned after the change pays under the new version.
    complete_quest(child, treasure.quest)
    [fresh] = sync(child).new_entries
    assert (fresh.amount, fresh.policy_version) == (777, 2)


# --- Live path --------------------------------------------------------------------------------


def test_live_play_reconciles_after_commit_through_signals(
    treasure, scoring, django_capture_on_commit_callbacks
):
    child = treasure.families.a1
    assert not AwardLedgerEntry.objects.exists()
    with django_capture_on_commit_callbacks(execute=True) as callbacks:
        answer_chest(treasure)
    assert callbacks
    assert len(entries(child, SourceKind.LEARNING_CHALLENGE)) == 1
    assert len(entries(child, SourceKind.LOCATION_FIRST_VISIT)) == 1
    assert ProgressionProjection.objects.get(child=child).learning_points == 250


def test_a_signal_failure_never_breaks_play(
    treasure, scoring, django_capture_on_commit_callbacks, monkeypatch
):
    def boom(child):
        raise RuntimeError("scoring down")

    monkeypatch.setattr(reconcile, "reconcile_child", boom)
    with django_capture_on_commit_callbacks(execute=True):
        outcome = answer_chest(treasure)
    assert outcome.correct
    assert not AwardLedgerEntry.objects.exists()
    monkeypatch.undo()
    assert len(sync(treasure.families.a1).new_entries) >= 1  # the next run catches up


def test_nothing_is_scheduled_while_scoring_is_off(
    treasure, django_capture_on_commit_callbacks, monkeypatch
):
    ran = []
    monkeypatch.setattr(reconcile, "_run", lambda child_id: ran.append(child_id))
    with django_capture_on_commit_callbacks(execute=True):
        answer_chest(treasure)
    assert ran == []
    assert not AwardLedgerEntry.objects.exists()


def test_the_signal_schedules_a_run_per_write_while_on(
    treasure, scoring, django_capture_on_commit_callbacks, monkeypatch
):
    ran = []
    monkeypatch.setattr(reconcile, "_run", lambda child_id: ran.append(child_id))
    with django_capture_on_commit_callbacks(execute=True):
        answer_chest(treasure)
    assert ran and set(ran) == {treasure.families.a1.pk}


def test_a_rolled_back_transaction_schedules_nothing(
    treasure, scoring, django_capture_on_commit_callbacks, monkeypatch
):
    from django.db import transaction

    ran = []
    monkeypatch.setattr(reconcile, "_run", lambda child_id: ran.append(child_id))

    class Abort(Exception):
        pass

    with django_capture_on_commit_callbacks(execute=True):
        with pytest.raises(Abort), transaction.atomic():
            open_session(treasure)
            raise Abort
    assert ran == []


# --- Isolation --------------------------------------------------------------------------------


def test_one_childs_activity_never_creates_entries_for_another(treasure, scoring):
    f = treasure.families
    answer_chest(treasure, f.a1)
    pickup(treasure, f.a1)
    complete_quest(f.a1, treasure.quest)
    for child in (f.a1, f.a2, f.b1, f.b2):
        sync(child)
    assert entries(f.a1)
    for other in (f.a2, f.b1, f.b2):
        assert entries(other) == []
        assert not ProgressionProjection.objects.filter(child=other).exists()
    for entry in AwardLedgerEntry.objects.all():
        assert entry.child_id == f.a1.pk
        if entry.session_id:
            assert entry.session.child_id == f.a1.pk
