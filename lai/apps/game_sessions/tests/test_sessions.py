import threading
from datetime import timedelta

import pytest
from django.contrib import admin
from django.db import IntegrityError, connection, transaction
from django.db.models import ProtectedError
from django.utils import timezone

from apps.catalog.importer import import_content
from apps.catalog.models import Adventure, ContentRelease, Location
from apps.catalog.tests.helpers import write_export
from apps.game_sessions import services
from apps.game_sessions.models import (
    AdventureAction,
    AdventureSession,
    CoopParticipant,
    CoopSession,
    Correctness,
    SessionStatus,
)
from apps.game_sessions.services import InvalidTransition, ProgressNotFound
from apps.users.scoping import ChildScopedMixin

pytestmark = [pytest.mark.postgres]


def attempt(child, session, step, next_step, correctness=Correctness.CORRECT, **extra):
    return services.record_step_attempt(
        child,
        session.pk,
        step_id=step,
        correctness=correctness,
        next_step_id=next_step,
        action_type="ANSWER",
        **extra,
    )


@pytest.mark.django_db
class TestCreatingAndAdvancing:
    def test_a_new_session_starts_at_the_entry_step_and_records_its_version_and_release(
        self, families, content_catalog
    ):
        session, created = services.start_or_resume_session(families.a1, content_catalog.bridge)

        assert created and session.status == SessionStatus.ACTIVE
        assert session.current_step_id == "count"
        assert session.template_version == 1
        assert session.content_release == ContentRelease.objects.get()
        assert session.completed_at is None

    def test_starting_again_resumes_the_active_session(self, families, content_catalog):
        first, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        again, created = services.start_or_resume_session(families.a1, content_catalog.bridge)
        assert again == first and created is False

    def test_an_attempt_moves_the_session_and_completes_the_step(self, families, content_catalog):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        later = session.started_at + timedelta(seconds=30)

        action = attempt(families.a1, session, "count", "done", hint_level=2, now=later)

        session.refresh_from_db()
        assert (session.current_step_id, session.last_activity_at) == ("done", later)
        assert (action.attempt_number, action.next_step_id, action.hint_level) == (1, "done", 2)
        assert services.completed_step_ids(families.a1, session.pk) == ["count"]

    def test_a_retry_numbers_attempts_and_does_not_complete_the_step(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)

        attempt(families.a1, session, "count", None, Correctness.INCORRECT)
        second = attempt(families.a1, session, "count", "done")

        assert second.attempt_number == 2
        assert services.completed_step_ids(families.a1, session.pk) == ["count"]
        assert session.actions.filter(next_step_id="").count() == 1

    def test_the_complete_transition_ends_on_the_reserved_step_id(self, families, content_catalog):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.planks)
        attempt(families.a1, session, "stack", "complete")
        session.refresh_from_db()
        assert session.current_step_id == "complete"

    def test_completing_a_session_is_final_and_a_later_start_begins_a_new_one(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        attempt(families.a1, session, "count", "done")

        done = services.complete_session(families.a1, session.pk)

        assert done.status == SessionStatus.COMPLETED and done.completed_at is not None
        with pytest.raises(InvalidTransition):
            attempt(families.a1, session, "done", "done")
        with pytest.raises(InvalidTransition):
            services.complete_session(families.a1, session.pk)
        replay, created = services.start_or_resume_session(families.a1, content_catalog.bridge)
        assert created and replay != session


@pytest.mark.django_db
class TestInvalidTransitions:
    def test_an_attempt_at_a_step_other_than_the_current_one_is_refused(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        with pytest.raises(InvalidTransition):
            attempt(families.a1, session, "done", "done")
        assert AdventureAction.objects.count() == 0

    def test_moving_to_a_step_the_adventure_does_not_have_is_refused(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        with pytest.raises(InvalidTransition):
            attempt(families.a1, session, "count", "stack")  # another adventure's step
        session.refresh_from_db()
        assert session.current_step_id == "count"

    def test_an_inactive_adventure_or_location_cannot_be_started_or_resumed(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        Location.objects.filter(slug="bay").update(active=False)
        with pytest.raises(InvalidTransition):
            services.start_or_resume_session(families.a1, Adventure.objects.get(slug="fix-bridge"))
        Location.objects.filter(slug="bay").update(active=True)
        Adventure.objects.filter(slug="fix-bridge").update(active=False)
        with pytest.raises(InvalidTransition):
            services.start_or_resume_session(families.a1, Adventure.objects.get(slug="fix-bridge"))
        assert AdventureSession.objects.get() == session

    def test_the_database_rejects_impossible_session_rows(self, families, content_catalog):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        for change in (
            {"status": SessionStatus.COMPLETED},  # completed without a completion time
            {"completed_at": timezone.now()},  # a completion time on an active session
            {"status": "FINISHED"},
            {"last_activity_at": session.started_at - timedelta(seconds=1)},
        ):
            with pytest.raises(IntegrityError), transaction.atomic():
                AdventureSession.objects.filter(pk=session.pk).update(**change)

    def test_the_database_rejects_impossible_attempts(self, families, content_catalog):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        base = dict(
            session=session,
            step_id="count",
            action_type="ANSWER",
            correctness=Correctness.CORRECT,
            created_at=timezone.now(),
        )
        for bad in (
            {"attempt_number": 0},
            {"attempt_number": 1, "hint_level": 6},
            {"attempt_number": 1, "correctness": "MAYBE"},
        ):
            with pytest.raises(IntegrityError), transaction.atomic():
                AdventureAction.objects.create(**{**base, **bad})


@pytest.mark.django_db
class TestDuplicatesAndChildren:
    def test_the_database_allows_one_active_session_per_child_and_adventure(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        with pytest.raises(IntegrityError), transaction.atomic():
            AdventureSession.objects.create(
                child=families.a1,
                adventure=session.adventure,
                template_version=1,
                content_release=session.content_release,
                status=SessionStatus.ACTIVE,
                current_step_id="count",
                started_at=session.started_at,
                last_activity_at=session.started_at,
            )

    def test_the_same_attempt_cannot_be_recorded_twice(self, families, content_catalog):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        action = attempt(families.a1, session, "count", None, Correctness.INCORRECT)
        with pytest.raises(IntegrityError), transaction.atomic():
            AdventureAction.objects.create(
                session=session,
                step_id="count",
                attempt_number=action.attempt_number,
                action_type="ANSWER",
                correctness=Correctness.CORRECT,
                created_at=timezone.now(),
            )

    def test_several_children_play_the_same_adventure_independently(
        self, families, content_catalog
    ):
        mine, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        sibling, _ = services.start_or_resume_session(families.a2, content_catalog.bridge)
        other_family, _ = services.start_or_resume_session(families.b1, content_catalog.bridge)

        attempt(families.a1, mine, "count", "done")

        assert len({mine.pk, sibling.pk, other_family.pk}) == 3
        sibling.refresh_from_db()
        assert sibling.current_step_id == "count"


@pytest.mark.django_db
class TestChildIsolation:
    def test_another_childs_session_is_not_found_for_every_operation(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        for intruder in (families.a2, families.b1):
            with pytest.raises(ProgressNotFound):
                attempt(intruder, session, "count", "done")
            with pytest.raises(ProgressNotFound):
                services.complete_session(intruder, session.pk)
            with pytest.raises(ProgressNotFound):
                services.completed_step_ids(intruder, session.pk)
        session.refresh_from_db()
        assert session.current_step_id == "count" and session.actions.count() == 0

    def test_the_child_scoped_mixin_filters_progress_to_its_child(self, families, content_catalog):
        services.start_or_resume_session(families.a1, content_catalog.bridge)
        services.start_or_resume_session(families.b1, content_catalog.bridge)
        view = ChildScopedMixin()
        view.child = families.b1
        assert {s.child_id for s in view.scoped(AdventureSession.objects.all())} == {families.b1.pk}
        assert AdventureSession.objects.for_child(families.a2).count() == 0

    def test_deleting_a_child_deletes_its_sessions_and_attempts_only(
        self, families, content_catalog
    ):
        mine, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        attempt(families.a1, mine, "count", "done")
        services.start_or_resume_session(families.b1, content_catalog.bridge)

        families.a1.delete()

        assert AdventureAction.objects.count() == 0
        assert list(AdventureSession.objects.values_list("child", flat=True)) == [families.b1.pk]

    def test_no_progress_model_is_exposed_on_the_admin(self):
        exposed = {model._meta.app_label for model in admin.site._registry}
        assert exposed == {"catalog", "users"}  # users: the admin-accounts proxy only


@pytest.mark.django_db
class TestContentReleases:
    def test_a_new_release_does_not_reset_or_rebind_progress(self, families, content_catalog):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
        attempt(families.a1, session, "count", "done")
        first_release = session.content_release

        changed = content_catalog.collections
        changed["adventures.json"]["adventures"][0]["title"] = "Fix the Moon Bridge"
        changed["adventures.json"]["adventures"][0]["version"] = 2
        import_content(write_export(content_catalog.export_dir / "v2", changed))

        session.refresh_from_db()
        assert session.content_release == first_release
        assert (session.template_version, session.current_step_id) == (1, "done")
        assert session.adventure.version == 2  # the catalog moved on; the session did not

    def test_progress_on_an_adventure_dropped_from_the_export_is_kept_and_can_continue(
        self, families, content_catalog
    ):
        session, _ = services.start_or_resume_session(families.a1, content_catalog.planks)
        smaller = content_catalog.collections
        smaller["adventures.json"]["adventures"] = [
            a for a in smaller["adventures.json"]["adventures"] if a["slug"] != "stack-planks"
        ]
        smaller["islands.json"]["islands"][0]["pack"]["adventureSlugs"].remove("stack-planks")
        quest = smaller["quests.json"]["quests"][0]
        quest["stages"] = quest["stages"][:1]
        import_content(write_export(content_catalog.export_dir / "v2", smaller))

        retained = Adventure.objects.get(slug="stack-planks")
        assert retained.last_seen_release != ContentRelease.objects.first()
        attempt(families.a1, session, "stack", "complete")
        assert services.complete_session(families.a1, session.pk).status == SessionStatus.COMPLETED

    def test_an_adventure_with_progress_cannot_be_deleted(self, families, content_catalog):
        services.start_or_resume_session(families.a1, content_catalog.bridge)
        with pytest.raises(ProtectedError):
            Adventure.objects.get(slug="fix-bridge").delete()


@pytest.mark.django_db
def test_a_failed_write_rolls_back_the_attempt_and_the_move(families, content_catalog, monkeypatch):
    session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)

    def broken_save(self, *args, **kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(AdventureSession, "save", broken_save)
    with pytest.raises(RuntimeError):
        attempt(families.a1, session, "count", "done")
    monkeypatch.undo()

    session.refresh_from_db()
    assert session.current_step_id == "count" and session.actions.count() == 0


@pytest.mark.django_db
def test_coop_participants_are_rows_and_a_child_joins_once(families, content_catalog):
    now = timezone.now()
    coop = CoopSession.objects.create(
        host_parent=families.a,
        adventure=content_catalog.bridge,
        template_version=1,
        status="ACTIVE",
        started_at=now,
        last_activity_at=now,
    )
    CoopParticipant.objects.create(coop_session=coop, child=families.a1)
    CoopParticipant.objects.create(coop_session=coop, child=families.a2)
    with pytest.raises(IntegrityError), transaction.atomic():
        CoopParticipant.objects.create(coop_session=coop, child=families.a1)
    assert coop.participants.count() == 2


@pytest.mark.django_db(transaction=True)
def test_concurrent_attempts_and_starts_never_duplicate(families, content_catalog):
    """Row locks serialise attempts; the one-active constraint settles concurrent starts."""
    session, _ = services.start_or_resume_session(families.a1, content_catalog.bridge)
    errors, starts = [], []
    barrier = threading.Barrier(2)

    def retry():
        try:
            barrier.wait()
            attempt(families.a1, session, "count", None, Correctness.INCORRECT)
        except Exception as error:  # surfaced through `errors`
            errors.append(error)
        finally:
            connection.close()

    def start():
        try:
            barrier.wait()
            starts.append(
                services.start_or_resume_session(families.a2, content_catalog.bridge)[0].pk
            )
        except Exception as error:
            errors.append(error)
        finally:
            connection.close()

    for target in (retry, start):
        threads = [threading.Thread(target=target) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    assert errors == []
    numbers = sorted(session.actions.values_list("attempt_number", flat=True))
    assert numbers == [1, 2]
    assert len(set(starts)) == 1
    assert AdventureSession.objects.for_child(families.a2).count() == 1
