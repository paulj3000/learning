"""Concurrent requests (TR-4): real parallel transactions against PostgreSQL.

`transaction=True` so each thread commits on its own connection, as two simultaneous HTTP
requests would. The row locks and unique constraints decide the outcome, not timing.
"""

import threading

import pytest
from django.db import connection

from apps.game_sessions.models import AdventureSession
from apps.game_sessions.services import (
    AttemptAlreadyAnswered,
    issue_chest_challenge,
    start_or_resume_region_session,
    submit_chest_answer,
)
from apps.inventory.models import GrantedRewardRule, InventoryItem
from apps.inventory.services import grant_reward_rule
from apps.progression.models import WorldChange

pytestmark = [pytest.mark.postgres, pytest.mark.django_db(transaction=True)]


def race(work, count=2):
    """Run `work()` on `count` threads released together; return results or exceptions."""
    barrier = threading.Barrier(count)
    results: list[object] = []

    def run():
        try:
            barrier.wait()
            results.append(work())
        except Exception as error:  # noqa: BLE001 - the race outcome is the assertion
            results.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    return results


def test_two_submissions_of_one_answer_open_the_chest_once(treasure):
    child = treasure.families.a1
    session, _ = start_or_resume_region_session(child, treasure.region)
    attempt, _ = issue_chest_challenge(session, treasure.chest, seed=5)

    results = race(lambda: submit_chest_answer(child, attempt.pk, attempt.answer))

    refused = [r for r in results if isinstance(r, AttemptAlreadyAnswered)]
    opened = [r for r in results if getattr(r, "chest_opened", False)]
    assert len(opened) == 1 and len(refused) == 1, results
    assert WorldChange.objects.filter(child=child).count() == 1
    assert InventoryItem.objects.filter(child=child).count() == 1


def test_two_grants_of_one_rule_grant_once(treasure):
    child = treasure.families.a1
    rule = treasure.chest.reward_rule

    results = race(lambda: grant_reward_rule(child, rule))

    assert sorted(r.granted for r in results) == [False, True], results
    assert GrantedRewardRule.objects.filter(child=child).count() == 1
    assert InventoryItem.objects.filter(child=child).count() == 1


def test_two_starts_make_one_session(treasure):
    child = treasure.families.a1
    results = race(lambda: start_or_resume_region_session(child, treasure.region)[0].pk)
    assert len(set(results)) == 1, results
    assert AdventureSession.objects.filter(child=child).count() == 1
