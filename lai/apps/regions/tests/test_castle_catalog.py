"""The Castle Director's revisioned event catalog (ADR-065, ADR-047).

Publication, immutability, superseding, retirement, permissions, the idempotent import that
never overwrites an administrator's edits, and the empty-catalog fallback.
"""

import copy

import pytest
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.test import Client
from django.urls import reverse

from apps.catalog import authoring
from apps.catalog.models import (
    ContentAuthority,
    ContentRevision,
    RevisionImmutable,
    RevisionOrigin,
    RevisionStatus,
)
from apps.regions import castle_events
from apps.regions.models import CastleEvent
from apps.users.models import ParentAccount

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]
BACKEND = "apps.users.backends.AdminPasswordBackend"
SEED_IDS = {event["id"] for event in castle_events.SEED_CATALOG}


def account(name, *groups, staff=True, superuser=False):
    user = ParentAccount.objects.create(
        cognito_sub=f"django-admin-only:{name}",
        admin_username=name,
        is_staff=staff,
        is_superuser=superuser,
    )
    for group in groups:
        user.groups.add(Group.objects.get(name=group))
    return user


@pytest.fixture
def roles(db):
    call_command("ensure_content_roles", stdout=None)


@pytest.fixture
def publisher(roles):
    return account("publisher", "Content publishers")


@pytest.fixture
def editor(roles):
    return account("editor", "Content editors")


@pytest.fixture
def imported(db):
    return castle_events.import_seed()


def row(event_id="quiet-story-hall"):
    return CastleEvent.objects.get(event_id=event_id)


def new_body(event_id="evening-glow", **changes):
    body = {
        "id": event_id,
        "room": "story-hall",
        "bands": ["SPROUT", "PATHFINDER", "EXPLORER"],
        "requires": [{"type": "ALWAYS"}],
        "repeat": {"maxShows": 3, "minVisitGap": 1},
        "weight": 2,
        "npcId": None,
        "lines": {
            "SPROUT": ["The window glows."],
            "PATHFINDER": ["The window glows with warm light."],
            "EXPLORER": ["The window glows with warm light and the shelves look golden."],
        },
        "visual": {"kind": "lantern-glow"},
        "fallback": False,
    }
    body.update(changes)
    return body


def new_event(event_id="evening-glow", **changes):
    return CastleEvent.objects.create(
        event_id=event_id, room="story-hall", source=new_body(event_id, **changes)
    )


# --- publication: draft, review, published, superseded ------------------------------------------


def test_a_new_event_is_not_shown_until_it_is_published(publisher):
    event = new_event()
    assert event.published_revision_id is None
    assert "evening-glow" not in {e["id"] for e in castle_events.catalog()}
    draft = authoring.create_draft(event, new_body(), user=publisher)
    assert draft.status == RevisionStatus.DRAFT and draft.created_by == publisher
    assert "evening-glow" not in {e["id"] for e in castle_events.catalog()}


def test_draft_review_publish_records_who_and_when(editor, publisher, imported):
    event = row()
    body = authoring.current_body(event)
    body["lines"]["PATHFINDER"] = ["The hearth crackles warmly in the Story Hall."]
    draft = authoring.create_draft(event, body, user=editor)
    assert draft.validation_report == []
    authoring.submit(draft, user=editor)
    draft.refresh_from_db()
    assert (draft.status, draft.submitted_by) == (RevisionStatus.SUBMITTED, editor)
    authoring.publish(draft, user=publisher)
    draft.refresh_from_db()
    event.refresh_from_db()
    assert draft.status == RevisionStatus.PUBLISHED
    assert (draft.published_by, draft.published_at is not None) == (publisher, True)
    assert event.published_revision_id == draft.pk
    assert event.authority == ContentAuthority.DJANGO
    served = {e["id"]: e for e in castle_events.catalog()}["quiet-story-hall"]
    assert served["lines"]["PATHFINDER"] == ["The hearth crackles warmly in the Story Hall."]
    assert served["version"] == draft.number and served["status"] == "PUBLISHED"


def test_an_editor_cannot_publish_and_a_non_staff_account_cannot_draft(editor, imported):
    event = row()
    draft = authoring.create_draft(event, authoring.current_body(event), user=editor)
    with pytest.raises(authoring.NotPermitted):
        authoring.publish(draft, user=editor)
    plain = account("plain", staff=False)
    with pytest.raises(authoring.NotPermitted):
        authoring.create_draft(event, authoring.current_body(event), user=plain)
    with pytest.raises(authoring.NotPermitted):
        authoring.create_draft(event, authoring.current_body(event), user=None)


def test_a_published_version_is_immutable_and_the_next_one_supersedes_it(publisher, imported):
    event = row()
    first = event.published_revision
    body = authoring.current_body(event)
    body["weight"] = 3
    second = authoring.publish(authoring.create_draft(event, body, user=publisher), user=publisher)
    first.refresh_from_db()
    assert first.status == RevisionStatus.SUPERSEDED and second.status == RevisionStatus.PUBLISHED
    first.body = {"changed": True}
    with pytest.raises(RevisionImmutable):
        first.save()
    second.body = {"changed": True}
    with pytest.raises(RevisionImmutable):
        second.save()
    with pytest.raises(RevisionImmutable):
        second.delete()
    assert ContentRevision.objects.filter(kind="castle-event", record_key="quiet-story-hall").count() == 2
    # Only one published version at a time (a database constraint, ADR-047).
    assert (
        ContentRevision.objects.filter(
            kind="castle-event", record_key="quiet-story-hall", status=RevisionStatus.PUBLISHED
        ).count()
        == 1
    )


def test_rollback_restores_an_earlier_body_as_a_new_version(publisher, imported):
    event = row()
    original = copy.deepcopy(event.source)
    first = event.published_revision
    body = authoring.current_body(event)
    body["weight"] = 4
    authoring.publish(authoring.create_draft(event, body, user=publisher), user=publisher)
    restored = authoring.rollback(first, user=publisher)
    event.refresh_from_db()
    assert event.source == original and restored.origin == RevisionOrigin.ROLLBACK


@pytest.mark.parametrize(
    ("change", "fragment"),
    [
        ({"room": "no-such-room"}, "$.room"),
        ({"bands": []}, "$.bands"),
        ({"bands": ["TEEN"]}, "$.bands"),
        ({"requires": [{"type": "LOCAL_FLAG", "flag": "x"}]}, "not allowed"),
        ({"requires": [{"type": "WORLD_CHANGE"}]}, "needs a key"),
        ({"requires": [{"type": "RELATIONSHIP_AT_LEAST", "level": "FRIEND"}]}, "needs an npcId"),
        ({"requires": [{"type": "QUEST_STATUS", "quest": "q", "status": "DONE"}]}, "$.requires[0].status"),
        ({"repeat": {"maxShows": 0, "minVisitGap": 0}}, "maxShows"),
        ({"repeat": {"maxShows": None, "minVisitGap": -1}}, "minVisitGap"),
        ({"weight": 6}, "$.weight"),
        ({"npcId": "stranger"}, "$.npcId"),
        ({"visual": {"kind": "fireworks"}}, "$.visual.kind"),
        ({"fallback": True, "room": "ANY"}, "$.fallback"),
        ({"lines": {"SPROUT": ["x"]}}, "$.lines"),
        ({"lines": {"SPROUT": ["a" * 200], "PATHFINDER": ["b"], "EXPLORER": ["c"]}}, "longer than 120"),
        ({"lines": {"SPROUT": ["Come back tomorrow."], "PATHFINDER": ["b"], "EXPLORER": ["c"]}}, "pressure"),
        ({"lines": {"SPROUT": ["A — dash."], "PATHFINDER": ["b"], "EXPLORER": ["c"]}}, "em dash"),
        ({"lines": {"SPROUT": ["See http://x.example"], "PATHFINDER": ["b"], "EXPLORER": ["c"]}}, "plain text"),
        ({"surprise": 1}, "unknown keys"),
    ],
)
def test_an_invalid_body_is_refused_with_its_reason(publisher, change, fragment):
    event = new_event()
    draft = authoring.create_draft(event, new_body(**change), user=publisher)
    assert any(fragment in problem for problem in draft.validation_report), draft.validation_report
    with pytest.raises(authoring.PublishRefused):
        authoring.publish(draft, user=publisher)
    event.refresh_from_db()
    assert event.published_revision_id is None


def test_an_events_id_never_changes(publisher):
    event = new_event()
    draft = authoring.create_draft(event, new_body("another-id"), user=publisher)
    assert any("$.id" in p for p in draft.validation_report)


def test_the_only_band_lines_are_those_for_the_listed_bands(publisher):
    body = new_body(
        bands=["EXPLORER"], lines={"EXPLORER": ["The window glows with warm light."]}
    )
    event = new_event(**{k: body[k] for k in ("bands", "lines")})
    published = authoring.publish(authoring.create_draft(event, body, user=publisher), user=publisher)
    served = {e["id"]: e for e in castle_events.catalog() if e["id"] == "evening-glow"}
    assert published.status == RevisionStatus.PUBLISHED and served["evening-glow"]["bands"] == ["EXPLORER"]
    state = state_for("story-hall", "SPROUT")
    assert "evening-glow" not in [e["id"] for e in castle_events.eligible_events(castle_events.catalog(), state)]


# --- retirement --------------------------------------------------------------------------------


def state_for(room, band="PATHFINDER", **extra):
    return {
        "ageBand": band,
        "roomId": room,
        "conditions": {"worldChanges": [], "questStatuses": {}, "relationshipLevels": {}},
        "shownCounts": {},
        "lastShownVisit": {},
        "currentVisitIndex": 5,
        **extra,
    }


def test_a_retired_event_is_never_eligible_or_the_default(publisher, imported):
    state = state_for("story-hall")
    events = castle_events.catalog()
    assert "quiet-story-hall" in [e["id"] for e in castle_events.eligible_events(events, state)]
    authoring.set_active(row("quiet-story-hall"), False, user=publisher)
    authoring.set_active(row("quill-hums-in-hall"), False, user=publisher)
    authoring.set_active(row("lanterns-glow-brighter"), False, user=publisher)
    events = castle_events.catalog()
    assert {"quiet-story-hall", "quill-hums-in-hall", "lanterns-glow-brighter"}.isdisjoint(
        e["id"] for e in events
    )
    assert castle_events.default_event(events, state) is None  # never a retired fallback
    authoring.set_active(row("quiet-story-hall"), True, user=publisher)
    assert castle_events.default_event(castle_events.catalog(), state)["id"] == "quiet-story-hall"


def test_retiring_needs_the_publish_permission_and_is_logged(editor, publisher, imported):
    with pytest.raises(authoring.NotPermitted):
        authoring.set_active(row(), False, user=editor)
    authoring.set_active(row(), False, user=publisher)
    from django.contrib.admin.models import LogEntry

    assert LogEntry.objects.filter(user_id=publisher.pk, change_message__startswith="Retired").exists()


def test_retiring_every_published_event_does_not_bring_the_seed_back(publisher, imported):
    for event in CastleEvent.objects.all():
        authoring.set_active(event, False, user=publisher)
    assert castle_events.catalog() == ()


def test_a_draft_only_event_is_never_eligible(publisher, imported):
    event = new_event()
    authoring.create_draft(event, new_body(), user=publisher)
    assert "evening-glow" not in {e["id"] for e in castle_events.catalog()}


# --- the empty catalog -------------------------------------------------------------------------


def test_with_nothing_published_the_seed_is_served_so_the_castle_still_works(db):
    assert not CastleEvent.objects.exists()
    assert castle_events.catalog() is castle_events.SEED_CATALOG
    new_event()  # a draft-only row does not make the catalog empty
    assert castle_events.catalog() is castle_events.SEED_CATALOG
    state = state_for("story-hall")
    assert castle_events.default_event(castle_events.catalog(), state) is not None


# --- the import --------------------------------------------------------------------------------


def test_the_import_creates_every_seed_event_as_a_published_version(imported):
    assert imported["created"] == len(SEED_IDS)
    assert set(CastleEvent.objects.values_list("event_id", flat=True)) == SEED_IDS
    for event in CastleEvent.objects.select_related("published_revision"):
        assert event.published_revision.status == RevisionStatus.PUBLISHED
        assert event.published_revision.origin == RevisionOrigin.IMPORT
        assert event.authority == ContentAuthority.EXPORT
    served = {e["id"]: e for e in castle_events.catalog()}
    assert served.keys() == SEED_IDS
    for seed in castle_events.SEED_CATALOG:  # the same events, field for field
        assert served[seed["id"]] == {**seed, "version": 1}


def test_a_second_import_changes_nothing(imported):
    before = list(ContentRevision.objects.values_list("pk", flat=True))
    again = castle_events.import_seed()
    assert again == {"created": 0, "updated": 0, "unchanged": len(SEED_IDS), "drafted": 0, "skipped": 0}
    assert list(ContentRevision.objects.values_list("pk", flat=True)) == before


def test_an_import_never_overwrites_an_administrators_edit(publisher, imported, monkeypatch):
    event = row()
    body = authoring.current_body(event)
    body["lines"]["SPROUT"] = ["The fire hums."]
    authoring.publish(authoring.create_draft(event, body, user=publisher), user=publisher)
    edited = copy.deepcopy(row().source)
    assert edited["lines"]["SPROUT"] == ["The fire hums."]
    # The seed changes in code, and the import runs again.
    changed = [
        {**e, "weight": 5} if e["id"] == "quiet-story-hall" else e
        for e in castle_events.SEED_CATALOG
    ]
    monkeypatch.setattr(castle_events, "SEED_CATALOG", tuple(changed))
    result = castle_events.import_seed()
    assert result["drafted"] == 1 and result["updated"] == 0
    assert row().source == edited
    event.refresh_from_db()
    assert event.authority == ContentAuthority.DJANGO
    kept = ContentRevision.objects.filter(
        kind="castle-event", record_key="quiet-story-hall", status=RevisionStatus.DRAFT
    )
    assert kept.count() == 1 and kept.get().body["weight"] == 5
    # And a repeat adds no second draft.
    assert castle_events.import_seed()["drafted"] == 0
    assert kept.count() == 1


def test_an_import_follows_a_changed_seed_for_an_unedited_event(imported, monkeypatch):
    changed = [
        {**e, "weight": 3} if e["id"] == "quiet-story-hall" else e
        for e in castle_events.SEED_CATALOG
    ]
    monkeypatch.setattr(castle_events, "SEED_CATALOG", tuple(changed))
    assert castle_events.import_seed()["updated"] == 1
    assert row().source["weight"] == 3 and row().published_revision.number == 2


def test_an_import_never_restores_a_retired_event_or_touches_a_draft_only_one(publisher, imported):
    authoring.set_active(row(), False, user=publisher)
    new_event("quiet-story-hall-copy")
    castle_events.import_seed()
    assert row().active is False
    assert "quiet-story-hall" not in {e["id"] for e in castle_events.catalog()}


def test_the_management_command_reports_and_is_idempotent(db, capsys):
    call_command("import_castle_events")
    call_command("import_castle_events")
    out = capsys.readouterr().out.splitlines()
    assert out[0].startswith(f"created {len(SEED_IDS)}") and f"unchanged {len(SEED_IDS)}" in out[1]


def test_every_seed_event_passes_the_authoring_rules():
    for event in castle_events.SEED_CATALOG:
        assert castle_events.body_problems(castle_events.body_of(event)) == [], event["id"]


# --- Django Admin ------------------------------------------------------------------------------


def client_for(user):
    client = Client()
    client.force_login(user, backend=BACKEND)
    return client


def test_a_non_staff_account_is_refused_the_castle_event_pages(roles, imported):
    plain = account("plain", staff=False)
    for name, args in (
        ("admin:regions_castleevent_changelist", []),
        ("admin:regions_castleevent_add", []),
        ("admin:regions_castleevent_change", [row().pk]),
    ):
        response = client_for(plain).get(reverse(name, args=args))
        assert response.status_code in (302, 403), name
        assert response.status_code != 200
    assert Client().get(reverse("admin:regions_castleevent_changelist")).status_code == 302


def test_staff_in_the_content_groups_may_view_and_editors_may_add(editor, publisher, imported):
    for user in (editor, publisher):
        page = client_for(user).get(reverse("admin:regions_castleevent_changelist"))
        assert page.status_code == 200 and b"quiet-story-hall" in page.content
        change = client_for(user).get(reverse("admin:regions_castleevent_change", args=[row().pk]))
        assert change.status_code == 200
        assert client_for(user).get(reverse("admin:regions_castleevent_add")).status_code == 200
    viewer = account("viewer")  # staff with no content permission
    assert client_for(viewer).get(reverse("admin:regions_castleevent_add")).status_code == 403
    assert client_for(viewer).get(reverse("admin:regions_castleevent_changelist")).status_code == 200


def test_adding_an_event_in_the_admin_starts_unpublished_and_empty(publisher):
    response = client_for(publisher).post(
        reverse("admin:regions_castleevent_add"), {"event_id": "dawn-light"}
    )
    assert response.status_code == 302
    event = CastleEvent.objects.get(event_id="dawn-light")
    assert event.published_revision_id is None and event.source["id"] == "dawn-light"
    assert castle_events.body_problems(event.source)  # needs real content before publishing
    assert "dawn-light" not in {e["id"] for e in castle_events.catalog()}


def test_the_retire_action_follows_the_publish_permission(editor, publisher, imported):
    url = reverse("admin:regions_castleevent_changelist")
    data = {"action": "retire_events", "_selected_action": [str(row().pk)]}
    client_for(editor).post(url, data)
    assert row().active is True
    client_for(publisher).post(url, data)
    assert row().active is False
