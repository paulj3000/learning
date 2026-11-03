"""Shared limits, kill switch, cost estimate and metric line (LAI-0708). No AWS."""

import json
import logging
from datetime import UTC, datetime, timedelta
from unittest import mock

import pytest
from django.db import DatabaseError

from apps.ai.models import AIInteractionAudit, AIServiceControl, AIUsageCounter
from apps.ai.services import usage
from apps.ai.services.costs import estimate_microusd

pytestmark = [pytest.mark.postgres]

TURN = {"intent": "HINT", "templateId": "bridge", "stepSummary": "counting planks"}
AT = datetime(2026, 11, 1, 10, 30, 15, tzinfo=UTC)


def post(api, parent, child, body=TURN, raw=None):
    return api(parent).post(
        f"/api/v1/children/{child.pk}/ai/companion-turns/",
        raw if raw is not None else json.dumps(body),
        content_type="application/json",
    )


@pytest.mark.django_db
class TestAdmission:
    def test_each_limit_denies_once_exhausted(self, families, settings):
        settings.LAI_AI_CHILD_TURNS_PER_DAY = 3
        for _ in range(3):
            admission = usage.admit(families.a1, at=AT)
            assert admission.allowed
            usage.release(families.a1, admission)  # as the pipeline does after each turn
        assert usage.admit(families.a1, at=AT).denial == "RATE_LIMITED"
        assert usage.admit(families.a2, at=AT).allowed  # a sibling has its own child budget

    def test_the_family_budget_spans_siblings(self, families, settings):
        settings.LAI_AI_FAMILY_TURNS_PER_DAY = 2
        assert usage.admit(families.a1, at=AT).allowed
        assert usage.admit(families.a2, at=AT).allowed
        assert not usage.admit(families.a1, at=AT).allowed
        assert usage.admit(families.b1, at=AT).allowed  # another family is unaffected

    def test_windows_roll_over(self, families, settings):
        settings.LAI_AI_CHILD_TURNS_PER_MINUTE = 1
        assert usage.admit(families.a1, at=AT).allowed
        assert not usage.admit(families.a1, at=AT).allowed
        assert usage.admit(families.a1, at=AT + timedelta(minutes=1)).allowed

    def test_a_session_has_its_own_daily_cap(self, families, settings):
        settings.LAI_AI_SESSION_TURNS_PER_DAY = 1
        assert usage.admit(families.a1, session_id="s1", at=AT).allowed
        assert not usage.admit(families.a1, session_id="s1", at=AT).allowed
        assert usage.admit(families.a1, session_id="s2", at=AT).allowed

    def test_concurrent_turns_are_capped_and_released(self, families, settings):
        settings.LAI_AI_CHILD_CONCURRENT_TURNS = 1
        first = usage.admit(families.a1, at=AT)
        assert first.allowed
        assert not usage.admit(families.a1, at=AT).allowed
        usage.release(families.a1, first)
        assert usage.admit(families.a1, at=AT).allowed

    def test_the_global_ceiling_stops_everyone(self, families, settings):
        settings.LAI_AI_GLOBAL_TURNS_PER_DAY = 1
        assert usage.admit(families.a1, at=AT).allowed
        assert not usage.admit(families.b1, at=AT).allowed

    def test_the_kill_switch_stops_model_calls(self, families):
        AIServiceControl.objects.create(pk=1, model_calls_enabled=False, reason="incident")
        usage.clear_control_cache()
        assert usage.admit(families.a1, at=AT).denial == "KILL_SWITCH"

    def test_a_broken_counter_store_fails_closed(self, families):
        with mock.patch.object(usage, "_bump", side_effect=DatabaseError):
            admission = usage.admit(families.a1, at=AT)
        assert (admission.allowed, admission.denial) == (False, "RATE_LIMIT_UNAVAILABLE")
        assert usage.admit(families.a1, at=AT).allowed  # the connection is still usable

    def test_old_windows_are_pruned_and_children_take_their_counters(self, families):
        usage.admit(families.a1, at=AT - timedelta(days=5))
        usage.admit(families.a1, at=AT.replace(second=0))  # second 0 prunes
        assert not AIUsageCounter.objects.filter(window_start__lt=AT - timedelta(days=2)).exists()
        from apps.users.deletion import delete_child_profile

        delete_child_profile(families.a, families.a1.pk)
        assert not AIUsageCounter.objects.filter(child_id=families.a1.pk).exists()


@pytest.mark.django_db
class TestPipeline:
    def test_denied_turns_never_call_the_model_and_are_not_generations(
        self, families, api, fake_model, settings
    ):
        settings.LAI_AI_CHILD_TURNS_PER_MINUTE = 1
        fake = fake_model()
        first = post(api, families.a, families.a1).json()
        second = post(api, families.a, families.a1).json()
        assert (first["source"], second["source"]) == ("AI", "FALLBACK")
        assert len(fake.requests) == 1
        statuses = sorted(AIInteractionAudit.objects.values_list("validation_status", flat=True))
        assert statuses == ["RATE_LIMITED", "VALID"]
        assert "RATE_LIMITED" not in json.dumps(second)  # internal state is not exposed

    def test_the_kill_switch_keeps_gameplay_going_with_authored_lines(
        self, families, api, fake_model
    ):
        AIServiceControl.objects.create(pk=1, model_calls_enabled=False)
        usage.clear_control_cache()
        fake = fake_model()
        body = post(api, families.a, families.a1).json()
        assert body["source"] == "FALLBACK" and fake.requests == []
        row = AIInteractionAudit.objects.get()
        assert (row.validation_status, row.failure_category) == ("RATE_LIMITED", "KILL_SWITCH")

    def test_an_oversized_request_is_refused_before_parsing(self, families, api, fake_model):
        fake = fake_model()
        raw = json.dumps({**TURN, "padding": "x" * 9000})
        assert post(api, families.a, families.a1, raw=raw).status_code == 400
        assert fake.requests == []

    def test_cost_is_estimated_only_from_configured_prices(
        self, families, api, fake_model, settings
    ):
        fake_model()
        post(api, families.a, families.a1)
        assert AIInteractionAudit.objects.get().estimated_cost_microusd is None
        settings.LAI_AI_PRICE_INPUT_PER_MTOK_USD = 1.0
        settings.LAI_AI_PRICE_OUTPUT_PER_MTOK_USD = 5.0
        post(api, families.a, families.a2)
        row = AIInteractionAudit.objects.for_child(families.a2).get()
        assert row.estimated_cost_microusd == 10 * 1 + 20 * 5  # fake: 10 in, 20 out

    def test_the_metric_line_is_positional_and_carries_no_ids(
        self, families, api, fake_model, caplog
    ):
        fake_model()
        with caplog.at_level(logging.INFO, logger="lai.ai"):
            post(api, families.a, families.a1)
        (line,) = [r.getMessage() for r in caplog.records if r.getMessage().startswith("ai.turn")]
        fields = line.split()
        assert fields[:5] == ["ai.turn", "v1", "generateCompanionTurn", "AI", "VALID"]
        assert len(fields) == 15
        assert fields[10:13] == [fields[10], "10", "20"] and fields[-1] == "ok"
        assert str(families.a1.pk) not in line and "Zinnia" not in line


def test_estimates_never_invent_usage(settings):
    settings.LAI_AI_PRICE_INPUT_PER_MTOK_USD = 1.0
    settings.LAI_AI_PRICE_OUTPUT_PER_MTOK_USD = 5.0
    assert estimate_microusd(None, 5) is None
    assert estimate_microusd(1000, 1000) == 6000


@pytest.mark.django_db(transaction=True)
def test_concurrent_workers_share_one_limit(families, settings):
    """Real parallel transactions: 12 simultaneous turns, a limit of 5, exactly 5 admitted."""
    import threading

    from django.db import connection

    settings.LAI_AI_CHILD_TURNS_PER_MINUTE = 5
    settings.LAI_AI_CHILD_CONCURRENT_TURNS = 10
    barrier = threading.Barrier(12)
    results = []

    def run():
        try:
            barrier.wait()
            results.append(usage.admit(families.a1, at=AT).allowed)
        except Exception as error:  # noqa: BLE001
            results.append(error)
        finally:
            connection.close()

    threads = [threading.Thread(target=run) for _ in range(12)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert results.count(True) == 5 and results.count(False) == 7, results
