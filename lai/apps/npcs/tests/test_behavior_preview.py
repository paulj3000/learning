"""Workstream D: behaviour profile admin and preview (LAI-NPC-019, LAI-NPC-025)."""

from __future__ import annotations

import pytest
from django.contrib.auth.models import Permission
from django.test import Client
from django.urls import reverse

from apps.npcs import preview_behavior
from apps.npcs.models import NpcBehaviorProfile
from apps.npcs.tests.helpers import make_behavior, make_character, make_placement, make_staff


def login(account) -> Client:
    client = Client()
    client.force_login(account, backend="apps.users.backends.AdminPasswordBackend")
    return client


# --- the plot (no database) ----------------------------------------------------------------------


def test_plot_parts_per_type():
    patrol = preview_behavior.plot_parts(
        "patrol",
        {"speed": 1, "waypoints": [{"x": 3, "z": 0, "pauseSeconds": 2}, {"x": 0, "z": 20}]},
    )
    assert patrol["bounds"] == 15.0
    assert patrol["closed"] is True and patrol["path_from_home"] is True
    assert [(p["x"], p["z"], p["pause"], p["outside"]) for p in patrol["points"]] == [
        (3.0, 0.0, 2.0, False),
        (0.0, 20.0, 0.0, True),
    ]
    assert preview_behavior.plot_parts("wander", {"radius": 4, "speed": 1})["radius"] == 4.0
    follow = preview_behavior.plot_parts("follow", {"stopDistance": 2, "speed": 1})
    assert follow["follow"] == {"stop": 2.0, "giveUp": 25.0}
    scripted = preview_behavior.plot_parts(
        "scripted",
        {"steps": [{"action": "wait", "seconds": 1}, {"action": "moveTo", "x": 1, "z": 2}]},
    )
    assert [p["index"] for p in scripted["points"]] == [1]
    assert preview_behavior.plot_parts("guide", {"speed": 1, "waypoints": []})["closed"] is False


def test_svg_marks_outside_points_and_is_accessible():
    svg = preview_behavior.svg_plot(
        "patrol",
        {"speed": 1, "boundsRadius": 5, "waypoints": [{"x": 1, "z": 1}, {"x": 9, "z": 0}]},
        title="Pip <patrol>",
    )
    assert svg.startswith("<svg") and svg.endswith("</svg>")
    assert 'role="img"' in svg and "<title" in svg
    assert "Pip &lt;patrol&gt;" in svg and "<patrol>" not in svg
    assert svg.count('data-part="point"') == 2
    assert svg.count('data-outside="true"') == 1
    assert 'data-part="bounds"' in svg and 'data-part="path"' in svg


def test_svg_tolerates_malformed_parameters():
    for parameters in ({"waypoints": "nope"}, {"radius": "big"}, {"steps": [None, 3]}):
        assert preview_behavior.svg_plot("wander", parameters).endswith("</svg>")


def test_reduced_motion_note_matches_the_react_controller():
    assert preview_behavior.REDUCED_MOTION_STILL == ("wander", "patrol")
    assert "stands still" in preview_behavior.reduced_motion_note("patrol")
    assert preview_behavior.reduced_motion_note("guide") == ""


# --- the admin -----------------------------------------------------------------------------------


@pytest.mark.django_db
def test_preview_page_shows_plot_problems_and_placements():
    profile = make_behavior(
        "cove-loop",
        "patrol",
        speed=1,
        boundsRadius=3,
        waypoints=[{"x": 1, "z": 0}, {"x": 5, "z": 0}],
    )
    make_placement(make_character(), "pip-spot", behavior=profile)
    client = login(make_staff(superuser=True))
    url = reverse("admin:npcs_npcbehaviorprofile_preview", args=[profile.pk])
    response = client.get(url)
    assert response.status_code == 200
    body = response.content.decode()
    assert "<svg" in body and 'data-outside="true"' in body
    assert "outside boundsRadius 3 m" in body
    assert "test-bay/pip-spot" in body
    assert "stands still" in body  # reduced-motion note for patrol
    change = client.get(reverse("admin:npcs_npcbehaviorprofile_change", args=[profile.pk]))
    assert url in change.content.decode()


@pytest.mark.django_db
def test_preview_needs_the_view_permission_and_a_real_profile():
    profile = make_behavior("idle-here")
    url = reverse("admin:npcs_npcbehaviorprofile_preview", args=[profile.pk])
    staff = make_staff("plain-staff")
    assert login(staff).get(url).status_code == 403
    staff.user_permissions.add(Permission.objects.get(codename="view_npcbehaviorprofile"))
    assert login(staff).get(url).status_code == 200
    missing = reverse("admin:npcs_npcbehaviorprofile_preview", args=[999999])
    assert login(staff).get(missing).status_code == 302
    assert Client().get(url).status_code == 302  # anonymous: to the admin login


def _post(client, data):
    payload = {"key": "new-one", "display_name": "New one", "notes": "", **data}
    return client.post(reverse("admin:npcs_npcbehaviorprofile_add"), payload)


@pytest.mark.django_db
def test_admin_form_refuses_schema_and_geometry_problems_and_saves_valid_ones():
    staff = make_staff(superuser=True)
    client = login(staff)
    bad_schema = _post(client, {"behavior_type": "wander", "parameters": '{"speed": 1}'})
    assert bad_schema.status_code == 200
    assert "wander needs: radius" in bad_schema.content.decode()
    far = _post(
        client,
        {
            "behavior_type": "patrol",
            "parameters": '{"speed": 1, "boundsRadius": 2, '
            '"waypoints": [{"x": 0, "z": 0}, {"x": 9, "z": 0}]}',
        },
    )
    assert far.status_code == 200
    assert "outside boundsRadius 2 m" in far.content.decode()
    assert not NpcBehaviorProfile.objects.filter(key="new-one").exists()
    ok = _post(client, {"behavior_type": "follow", "parameters": '{"stopDistance": 2, "speed": 2}'})
    assert ok.status_code == 302
    saved = NpcBehaviorProfile.objects.get(key="new-one")
    assert saved.created_by == staff and saved.updated_by == staff


@pytest.mark.django_db
def test_changelist_search_and_placement_count():
    profile = make_behavior("harbour-wander", "wander", radius=2, speed=1)
    make_placement(make_character(), "a", behavior=profile)
    make_behavior("other")
    client = login(make_staff(superuser=True))
    response = client.get(reverse("admin:npcs_npcbehaviorprofile_changelist"), {"q": "harbour"})
    assert response.status_code == 200
    body = response.content.decode()
    assert "harbour-wander" in body and ">other<" not in body
