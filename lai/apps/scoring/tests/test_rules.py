"""The pure scoring decision (GE-102, GE-105, GE-106, GE-107). No database."""

from datetime import UTC, datetime

import pytest

from apps.scoring import rules
from apps.scoring.contracts import (
    MINIMUM_AUTHORITATIVE_TRUST,
    Currency,
    ScoringFact,
    SourceKind,
    Trust,
    idempotency_key,
)
from apps.scoring.rules import RuleSpec, decide

AT = datetime(2026, 11, 18, tzinfo=UTC)


def fact(kind=SourceKind.QUEST_COMPLETED, ref="lost-map", trust=Trust.SERVER_BOUNDED, **attrs):
    return ScoringFact(kind, ref, trust, AT, attributes=attrs)


def rule(key, amount=10, currency=Currency.XP, kind=SourceKind.QUEST_COMPLETED, **kw):
    return RuleSpec(rule_key=key, source_kind=kind, currency=currency, amount=amount, **kw)


def test_a_matching_rule_awards_its_amount_with_a_source_key():
    [award] = decide([rule("quest", 250, stacking_group="quest")], fact())
    assert award.amount == 250 and award.currency == Currency.XP
    assert award.idempotency_key == "v1|QUEST_COMPLETED|lost-map|XP|quest"


def test_other_kinds_do_not_match():
    assert decide([rule("puzzle", kind=SourceKind.PUZZLE_SOLVED)], fact()) == []


def test_client_reported_facts_never_award_whatever_the_rule_says():
    loose = rule("quest", minimum_trust=Trust.CLIENT_REPORTED)
    assert decide([loose], fact(trust=Trust.CLIENT_REPORTED)) == []
    assert MINIMUM_AUTHORITATIVE_TRUST == Trust.SERVER_BOUNDED


def test_a_rule_can_demand_server_graded_facts():
    strict = rule("quest", minimum_trust=Trust.SERVER_GRADED)
    assert decide([strict], fact(trust=Trust.SERVER_BOUNDED)) == []
    assert decide([strict], fact(trust=Trust.SERVER_GRADED))


def test_within_a_group_the_most_specific_selector_wins_and_nothing_adds_up():
    rules_ = [
        rule("any", 100, stacking_group="q"),
        rule("prefix", 200, selector="lost-*", stacking_group="q"),
        rule("exact", 300, selector="lost-map", stacking_group="q"),
    ]
    assert [a.amount for a in decide(rules_, fact())] == [300]
    assert [a.amount for a in decide(rules_, fact(ref="lost-key"))] == [200]
    assert [a.amount for a in decide(rules_, fact(ref="found"))] == [100]


def test_a_longer_prefix_beats_a_shorter_one():
    rules_ = [
        rule("short", 1, selector="fire*", stacking_group="g"),
        rule("long", 2, selector="firepeak-*", stacking_group="g"),
    ]
    assert [a.rule_key for a in decide(rules_, fact(ref="firepeak-heart"))] == ["long"]


def test_priority_then_rule_key_break_ties_deterministically():
    rules_ = [rule("b", 1, stacking_group="g"), rule("a", 2, stacking_group="g")]
    assert [a.rule_key for a in decide(rules_, fact())] == ["a"]
    rules_ = [rule("b", 1, stacking_group="g", priority=5), rule("a", 2, stacking_group="g")]
    assert [a.rule_key for a in decide(rules_, fact())] == ["b"]


def test_different_groups_and_currencies_stack():
    rules_ = [
        rule("xp", 250, stacking_group="quest"),
        rule("coins", 5, currency=Currency.COINS, stacking_group="quest-coins"),
        rule("bonus", 50, stacking_group="quest-bonus"),
    ]
    awards = decide(rules_, fact())
    assert sorted((a.currency, a.amount) for a in awards) == [
        (Currency.COINS, 5),
        (Currency.XP, 50),
        (Currency.XP, 250),
    ]
    assert len({a.idempotency_key for a in awards}) == 3


def test_ungrouped_rules_are_each_their_own_group():
    awards = decide([rule("one", 1), rule("two", 2)], fact())
    assert sorted(a.amount for a in awards) == [1, 2]


def test_attribute_conditions_must_all_hold():
    keepsake = rule(
        "keepsake",
        kind=SourceKind.REWARD_RULE_GRANTED,
        attribute_equals={"itemCategory": "KEEPSAKE"},
    )
    granted = SourceKind.REWARD_RULE_GRANTED
    assert decide([keepsake], fact(kind=granted, ref="r", itemCategory="KEEPSAKE"))
    assert not decide([keepsake], fact(kind=granted, ref="r", itemCategory="COLLECTIBLE"))
    assert not decide([keepsake], fact(kind=granted, ref="r"))


def test_the_key_ignores_policy_version_and_amount_so_retuning_never_pays_twice():
    old = decide([rule("quest", 100, stacking_group="quest")], fact())
    new = decide([rule("quest-v2", 999, stacking_group="quest")], fact())
    assert old[0].idempotency_key == new[0].idempotency_key


def test_a_long_ref_is_hashed_but_stays_stable():
    ref = "x" * 300
    key = idempotency_key(SourceKind.QUEST_COMPLETED, ref, Currency.XP, "g")
    assert len(key) <= 200 and key == idempotency_key(
        SourceKind.QUEST_COMPLETED, ref, Currency.XP, "g"
    )
    assert key != idempotency_key(SourceKind.QUEST_COMPLETED, ref + "y", Currency.XP, "g")


@pytest.mark.parametrize(
    ("spec", "problem"),
    [
        (rule("zero", 0), "amount"),
        (rule("huge", rules.MAX_AMOUNT + 1), "amount"),
        (rule("loose", minimum_trust=Trust.CLIENT_REPORTED), "client-reported"),
        (rule("mid", selector="a*b"), "'*'"),
        (rule("star", currency=Currency.STAR), "stars come only"),
    ],
)
def test_invalid_rules_are_reported(spec, problem):
    assert any(problem in p for p in rules.rule_problems(spec))


def test_no_rule_can_carry_a_negative_amount():
    assert rules.rule_problems(rule("negative", -100))


# --- Levels ---------------------------------------------------------------------------------------

THRESHOLDS = [0, 500, 1500]


@pytest.mark.parametrize(
    ("xp", "level", "floor", "nxt"),
    [
        (0, 1, 0, 500),
        (499, 1, 0, 500),
        (500, 2, 500, 1500),
        (1500, 3, 1500, None),
        (10**6, 3, 1500, None),
    ],
)
def test_levels_follow_the_thresholds_and_have_a_top(xp, level, floor, nxt):
    progress = rules.level_for(xp, THRESHOLDS)
    assert (progress.level, progress.level_floor_xp, progress.next_level_xp) == (level, floor, nxt)


def test_negative_xp_is_floored_at_level_one():
    assert rules.level_for(-50, THRESHOLDS).level == 1


@pytest.mark.parametrize(
    "thresholds", [[], [10, 20], [0, 500, 500], [0, 500, 100], [0, -1], [0, 1.5]]
)
def test_bad_thresholds_are_reported(thresholds):
    assert rules.threshold_problems(thresholds)


def test_good_thresholds_have_no_problems():
    assert rules.threshold_problems([0, 500, 1500]) == []


# --- Stars ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("met", "total", "stars"),
    [
        (0, 0, 0),
        (0, 5, 0),
        (1, 5, 0),
        (2, 5, 1),
        (4, 5, 2),
        (5, 5, 3),
        (1, 3, 1),
        (2, 3, 2),
        (9, 3, 3),
    ],
)
def test_stars_count_goals_done_and_three_needs_all(met, total, stars):
    assert rules.stars_for(met, total) == stars


def test_the_decision_has_no_time_hint_or_attempt_inputs():
    """Child-friendly by construction: nothing about speed, hints, attempts or falls reaches it."""
    fields = set(ScoringFact.__dataclass_fields__)
    assert fields == {
        "source_kind",
        "source_ref",
        "trust",
        "occurred_at",
        "scope_key",
        "session_id",
        "attributes",
    }


# --- Suppression ----------------------------------------------------------------------------------


def test_an_exact_suppress_rule_stops_its_group_paying_for_that_source_only():
    rules_ = [
        rule("quest", 250, stacking_group="quest-completion"),
        rule(
            "legacy",
            0,
            selector="treasure-rush-cove",
            stacking_group="quest-completion",
            suppress=True,
        ),
    ]
    assert decide(rules_, fact(ref="treasure-rush-cove")) == []
    assert [a.amount for a in decide(rules_, fact(ref="pips-treasure"))] == [250]


def test_suppression_leaves_other_groups_paying():
    rules_ = [
        rule("quest", 250, stacking_group="quest-completion"),
        rule("coins", 5, currency=Currency.COINS, stacking_group="quest-coins"),
        rule("legacy", 0, selector="old", stacking_group="quest-completion", suppress=True),
    ]
    assert [(a.currency, a.amount) for a in decide(rules_, fact(ref="old"))] == [
        (Currency.COINS, 5)
    ]


def test_a_suppress_rule_needs_no_amount_but_a_paying_rule_does():
    assert rules.rule_problems(rule("legacy", 0, suppress=True)) == []
    assert rules.rule_problems(rule("zero", 0))
