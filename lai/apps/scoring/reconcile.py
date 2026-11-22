"""Facts -> decisions -> ledger, for one child (GE-104, GE-109).

There is one path into the ledger, used for live play, backfill and repair alike:

    collect(child)  ->  decide(policy rules, fact)  ->  record_awards(...)

Because every award key comes from a stable source, running this any number of times, in any
order, after any outage, converges on the same ledger: that is what makes the backfill of
existing child progress safe and what makes a missed live hook harmless (the next run, or
`manage.py scoring_reconcile`, catches up). Live play schedules it after the gameplay
transaction commits (`signals.py`), so scoring can never slow down, fail or roll back play.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.db import transaction

from . import collectors, ledger, policies, rules
from .models import AwardLedgerEntry

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ReconcileResult:
    enabled: bool
    facts: int = 0
    new_entries: tuple[AwardLedgerEntry, ...] = ()


def plan(child, policy) -> tuple[int, list[ledger.Planned]]:
    specs = policy.rule_specs()
    facts = collectors.collect(child)
    planned = [
        ledger.Planned(fact=fact, decision=decision)
        for fact in facts
        for decision in rules.decide(specs, fact)
    ]
    return len(facts), planned


def reconcile_child(child, *, policy_key: str = policies.DEFAULT_KEY) -> ReconcileResult:
    policy = policies.awarding_policy(policy_key)
    if policy is None:
        return ReconcileResult(enabled=False)
    with transaction.atomic():
        fact_count, planned = plan(child, policy)
        created = ledger.record_awards(child, policy, planned)
    return ReconcileResult(enabled=True, facts=fact_count, new_entries=tuple(created))


# --- Live scheduling ----------------------------------------------------------------------------


def schedule(child_id) -> None:
    """Reconcile `child_id` after the current transaction commits; at once outside one.

    Not deduplicated within a request: reconciling is idempotent, and a dedupe set would have
    to survive rollbacks correctly (Django has no on-rollback hook), so a few redundant runs
    are the safer cost. A rolled-back transaction schedules nothing.
    """
    if not policies.engine_enabled() or child_id is None:
        return
    transaction.on_commit(lambda: _run(child_id))


def _run(child_id) -> None:
    from apps.users.services import child_profile_for_system

    try:
        child = child_profile_for_system(child_id)
        if child is not None:
            reconcile_child(child)
    except Exception as error:  # noqa: BLE001 - scoring never breaks play; the next run catches up
        # The type only: a message or traceback could carry an identifier (CLAUDE.md s.13).
        logger.warning("scoring reconcile deferred: %s", type(error).__name__)
