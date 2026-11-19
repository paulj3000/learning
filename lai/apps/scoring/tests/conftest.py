"""Fixtures shared by the database-backed scoring suites."""

import pytest

from apps.scoring import fixtures, policies


@pytest.fixture
def enable_scoring(settings):
    """Turn the engine on, allowing the unapproved development fixture policy."""
    settings.LAI_SCORING_ENABLED = True
    settings.LAI_SCORING_ALLOW_UNAPPROVED = True


@pytest.fixture
def dev_policy(db):
    """An ACTIVE development fixture policy (does not turn the engine on)."""
    return policies.activate(fixtures.create_dev_policy())


@pytest.fixture
def scoring(enable_scoring, dev_policy):
    """The engine on, with the development policy active: ready to award."""
    return dev_policy


@pytest.fixture
def grant(scoring):
    """grant(child, ref, amount, currency, session=None) -> the new ledger entry, through
    `ledger.record_awards` (the only write path)."""
    from django.utils.timezone import now

    from apps.scoring import ledger
    from apps.scoring.contracts import Currency, ScoringFact, SourceKind, Trust, idempotency_key
    from apps.scoring.rules import AwardDecision

    def make(child, ref="q1", amount=50, currency=Currency.XP, session=None, scope="s"):
        fact = ScoringFact(
            SourceKind.QUEST_COMPLETED,
            ref,
            Trust.SERVER_BOUNDED,
            now(),
            scope_key=scope,
            session_id=session.pk if session else None,
        )
        decision = AwardDecision(
            "quest-completion",
            currency,
            amount,
            "g",
            idempotency_key(fact.source_kind, ref, currency, "g"),
        )
        created = ledger.record_awards(child, scoring, [ledger.Planned(fact, decision)])
        return created[0] if created else None

    return make
