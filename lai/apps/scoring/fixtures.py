"""Provisional development economy (GE-100). NOT approved production values.

These are the GE-100 card's development fixtures, loaded as a policy flagged
`is_development_fixture`, which a database constraint keeps from ever being economy-approved,
so they can award only where `LAI_SCORING_ALLOW_UNAPPROVED` is set (local development, tests).

Each rule is its own stacking group, named for its purpose; keep the names across versions
(an award's key includes its group, so renaming a group would let earned awards repeat).
Jump challenges are listed so their value is visible and reviewable, but no collector produces
them (client-reported only), so they award nothing. Platform courses award only through a
server-proven course completion (realms.py), never through movement claims.
"""

from .contracts import Currency, SourceKind

DEV_POLICY_TITLE = "Development fixture economy (provisional, not approved)"

# Provisional thresholds: 10 levels, a top level, gentle early steps.
DEV_LEVEL_THRESHOLDS = [0, 500, 1500, 3000, 5000, 8000, 12000, 17000, 23000, 30000]

# Conditions on fact attributes, by rule key (see SCORING_CONTRACTS.md section 3).
DEV_RULE_ATTRIBUTES = {
    # Coins for treasure only: a quest item pickup (a key) or a keepsake earns no coins.
    "treasure-coin": {"itemCategory": "COLLECTIBLE"},
}

# (rule_key / stacking group, source kind, currency, amount)
DEV_RULES = [
    ("correct-answer", SourceKind.ANSWER_CORRECT, Currency.LEARNING_POINTS, 100),
    ("learning-challenge", SourceKind.LEARNING_CHALLENGE, Currency.LEARNING_POINTS, 250),
    ("mastery-milestone", SourceKind.MASTERY_MILESTONE, Currency.LEARNING_POINTS, 500),
    ("new-location", SourceKind.LOCATION_FIRST_VISIT, Currency.XP, 50),
    ("secret-discovery", SourceKind.SECRET_DISCOVERED, Currency.XP, 150),
    ("treasure-coin", SourceKind.PICKUP_COLLECTED, Currency.COINS, 10),
    ("jump-challenge", SourceKind.JUMP_CHALLENGE, Currency.XP, 100),
    ("platform-course", SourceKind.PLATFORM_COURSE, Currency.XP, 250),
    ("puzzle-completion", SourceKind.PUZZLE_SOLVED, Currency.XP, 150),
    ("quest-completion", SourceKind.QUEST_COMPLETED, Currency.XP, 250),
    ("adventure-completion", SourceKind.ADVENTURE_COMPLETED, Currency.XP, 500),
    ("realm-milestone", SourceKind.REALM_MILESTONE, Currency.XP, 1000),
    ("adventure-star", SourceKind.ADVENTURE_STAR, Currency.STAR, 1),
]


# Suppress rules: (rule_key, source kind, exact selector, the group it suppresses).
# `treasure-rush-cove` is the legacy Treasure Cove quest, still active so children who started
# it keep their progress; it completes on the same chest as Pip's quest, so without this one
# accomplishment would pay quest XP twice. Retiring the quest (active=False) is the owner's
# content decision (docs/engine/TREASURE_RUSH_SCORING_INVENTORY.md section 3.1).
#
# `pirates-leap` is the quest that records the Pirate's Leap course's completion. The course
# award (PLATFORM_COURSE, realms.py) replaces its quest award, so one accomplishment pays once.
DEV_SUPPRESSIONS = [
    (
        "legacy-treasure-rush-cove",
        SourceKind.QUEST_COMPLETED,
        "treasure-rush-cove",
        "quest-completion",
    ),
    (
        "course-quest-pirates-leap",
        SourceKind.QUEST_COMPLETED,
        "pirates-leap",
        "quest-completion",
    ),
]


def create_dev_policy(key: str = "default"):
    """A new DRAFT version holding the development fixture rules. Returns it."""
    from django.db import transaction

    from .models import AwardRule, ScoringPolicy

    with transaction.atomic():
        latest = (
            ScoringPolicy.objects.select_for_update().filter(key=key).order_by("-version").first()
        )
        policy = ScoringPolicy.objects.create(
            key=key,
            version=(latest.version + 1) if latest else 1,
            title=DEV_POLICY_TITLE,
            notes="GE-100 provisional development fixtures. Not approved economy values.",
            level_thresholds=list(DEV_LEVEL_THRESHOLDS),
            is_development_fixture=True,
        )
        for rule_key, kind, currency, amount in DEV_RULES:
            AwardRule.objects.create(
                policy=policy,
                rule_key=rule_key,
                source_kind=kind,
                currency=currency,
                amount=amount,
                stacking_group=rule_key,
                attribute_equals=dict(DEV_RULE_ATTRIBUTES.get(rule_key, {})),
            )
        for rule_key, kind, selector, group in DEV_SUPPRESSIONS:
            AwardRule.objects.create(
                policy=policy,
                rule_key=rule_key,
                source_kind=kind,
                selector=selector,
                currency=Currency.XP,
                amount=0,
                stacking_group=group,
                suppress=True,
            )
    return policy
