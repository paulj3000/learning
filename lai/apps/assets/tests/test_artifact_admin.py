"""Derived artifacts in Django Admin and the private delivery rules (ADR-066)."""

import time

import pytest
from django.core import signing
from django.test import Client
from django.urls import get_resolver, reverse

from apps.assets.delivery import SALT
from apps.assets.models import ArtifactState, AssetVersion, DerivedArtifact
from apps.assets.storage import get_storage

from .artifact_helpers import (
    OGG,
    deliver,
    make_job,
    real_artifact,
    recorded,
    user_with,
    write,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

LIST = "/admin/assets/derivedartifact/"


def login(user):
    client = Client()
    client.force_login(user, backend="apps.users.backends.AdminPasswordBackend")
    return client


def viewer():
    return login(user_with("view_derivedartifact"))


def post_action(client, action, *artifacts):
    return client.post(
        LIST,
        {"action": action, "_selected_action": [str(a.pk) for a in artifacts], "index": 0},
        follow=True,
    )


def test_staff_with_view_see_the_list_filters_and_detail():
    _v, job, artifact = recorded()
    client = viewer()
    page = client.get(LIST)
    assert page.status_code == 200
    text = page.content.decode()
    assert "audio.transcoded" in text and "opus" in text and "lai.test_transcoder" in text
    assert client.get(f"{LIST}?state=pending_review&role=audio.transcoded").status_code == 200
    detail = client.get(f"{LIST}{artifact.pk}/change/")
    assert detail.status_code == 200
    html = detail.content.decode()
    assert artifact.sha256 in html and str(job.pk) in html
    assert "<audio controls" in html and f"/{artifact.pk}/media/" in html


def test_an_image_artifact_previews_as_an_image():
    from .artifact_helpers import PNG, source_version

    version = source_version()
    job = make_job(version, kind="asset.convert_image", profile=("image-webp", 1))
    deliver(
        job,
        [write(job, "thumb-256", PNG, ext="png", role="image.thumbnail", content_type="image/png")],
    )
    artifact = DerivedArtifact.objects.get(job_id_text=job.pk)
    html = viewer().get(f"{LIST}{artifact.pk}/change/").content.decode()
    assert "<img" in html and "Derived artifact preview" in html


def test_everyone_else_is_refused():
    _v, _j, artifact = recorded()
    assert Client().get(LIST).status_code == 302  # to the admin login
    assert login(user_with()).get(LIST).status_code == 403
    assert Client().get(f"{LIST}{artifact.pk}/media/").status_code == 403


def test_there_is_no_add_change_or_delete_in_the_ui():
    _v, _j, artifact = recorded()
    full = login(
        user_with(
            "view_derivedartifact",
            "review_derivedartifact",
            "promote_derivedartifact",
            "add_derivedartifact",
            "change_derivedartifact",
            "delete_derivedartifact",
        )
    )
    assert full.get(f"{LIST}add/").status_code == 403
    assert full.post(f"{LIST}{artifact.pk}/change/", {"state": "accepted"}).status_code == 403
    assert full.post(f"{LIST}{artifact.pk}/delete/", {"post": "yes"}).status_code == 403
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW


def test_metadata_and_keys_are_escaped():
    _v, _j, artifact = recorded()
    DerivedArtifact.objects.filter(pk=artifact.pk).update(
        metadata={"note": "<script>alert(1)</script>", "x": '"><img src=x onerror=1>'},
        processor_id="<b>evil</b>",
    )
    html = viewer().get(f"{LIST}{artifact.pk}/change/").content.decode()
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html
    assert "<b>evil</b>" not in html and "&lt;b&gt;evil" in html
    assert "<img src=x" not in html


def test_media_view_streams_verified_bytes_with_locked_down_headers():
    _v, _j, artifact = recorded()
    response = viewer().get(f"{LIST}{artifact.pk}/media/")
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == OGG
    assert response["Content-Type"] == "audio/ogg"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Content-Security-Policy"] == "default-src 'none'; sandbox"
    assert "no-store" in response["Cache-Control"] and "private" in response["Cache-Control"]
    assert response["Content-Disposition"].startswith("inline")


def test_media_view_refuses_a_changed_object_and_wrong_methods():
    _v, _j, artifact = recorded()
    client = viewer()
    assert client.post(f"{LIST}{artifact.pk}/media/").status_code == 405
    storage = get_storage()
    storage.objects[artifact.storage_key] = (b"tampered",) + storage.objects[artifact.storage_key][
        1:
    ]
    response = client.get(f"{LIST}{artifact.pk}/media/")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "artifact_changed"


def test_media_view_after_removal_is_not_found():
    _v, _j, artifact = recorded()
    DerivedArtifact.objects.filter(pk=artifact.pk).update(state="expired")
    assert viewer().get(f"{LIST}{artifact.pk}/media/").status_code == 404


def test_a_non_previewable_type_is_an_attachment():
    version = real_artifact()[0]
    job = make_job(version)
    deliver(
        job,
        [
            write(
                job,
                "report",
                b'{"a": 1}',
                ext="json",
                role="audio.report",
                content_type="application/json",
            )
        ],
    )
    artifact = DerivedArtifact.objects.get(job_id_text=job.pk)
    response = viewer().get(f"{LIST}{artifact.pk}/media/")
    assert response["Content-Disposition"].startswith("attachment")
    assert response["Content-Type"] == "application/octet-stream"


def test_review_actions_need_the_review_permission_and_are_logged():
    from django.contrib.admin.models import LogEntry

    _v, _j, artifact = recorded()
    outsider = login(user_with("view_derivedartifact"))
    post_action(outsider, "accept_selected", artifact)
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW
    reviewer = login(user_with("view_derivedartifact", "review_derivedartifact"))
    post_action(reviewer, "accept_selected", artifact)
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.ACCEPTED
    post_action(reviewer, "reject_selected", artifact)
    post_action(reviewer, "hold_selected", artifact)
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.REJECTED and artifact.retention_hold is True
    assert LogEntry.objects.filter(object_id=str(artifact.pk)).count() >= 3


def test_promote_action_is_a_separate_permission_and_never_publishes():
    _source, artifact = real_artifact(seconds=2)
    reviewer = login(user_with("view_derivedartifact", "review_derivedartifact"))
    post_action(reviewer, "promote_selected", artifact)
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PENDING_REVIEW  # review is not promotion
    promoter = login(user_with("view_derivedartifact", "promote_derivedartifact"))
    page = post_action(promoter, "promote_selected", artifact)
    artifact.refresh_from_db()
    assert artifact.state == ArtifactState.PROMOTED
    assert artifact.promoted_version.status == "VALIDATED"
    assert "Promoted" in page.content.decode()


def test_a_refused_promotion_is_shown_without_an_em_dash():
    _source, artifact = real_artifact(seconds=2)
    promoter = login(user_with("view_derivedartifact", "promote_derivedartifact"))
    post_action(promoter, "promote_selected", artifact)
    page = post_action(promoter, "promote_selected", artifact)
    text = page.content.decode()
    assert "already promoted" in text and "—" not in text


def test_the_role_groups_carry_the_new_permissions():
    from django.contrib.auth.models import Group
    from django.core.management import call_command

    call_command("ensure_asset_roles", verbosity=0)

    def granted(name):
        return set(Group.objects.get(name=name).permissions.values_list("codename", flat=True))

    editors, publishers = granted("Asset editors"), granted("Asset publishers")
    assert {"view_derivedartifact", "review_derivedartifact", "capture_derivedartifact"} <= editors
    assert "promote_derivedartifact" not in editors
    assert "promote_derivedartifact" in publishers


# --- private delivery --------------------------------------------------------------------------


def test_no_public_route_serves_an_artifact():
    _v, _j, artifact = recorded()
    client = Client()
    token = signing.dumps({"v": str(artifact.pk), "e": int(time.time()) + 600}, salt=SALT)
    for url in (
        f"/api/v1/asset-files/{token}/audio.ogg",
        f"/api/v1/derived-artifacts/{artifact.pk}/",
        f"/derived-artifacts/{artifact.pk}/",
        f"/{artifact.storage_key}",
    ):
        assert client.get(url).status_code in (401, 403, 404)


def test_artifact_routes_exist_only_under_admin():
    names = [
        str(pattern.pattern)
        for pattern in get_resolver().url_patterns
        if "artifact" in str(pattern.pattern).lower()
    ]
    assert names == []
    assert reverse("admin:assets_derivedartifact_media", args=[_uuid()]).startswith("/admin/")


def _uuid():
    import uuid

    return uuid.uuid4()


def test_artifacts_are_never_resolved_or_presigned(monkeypatch):
    from apps.assets import resolver

    _v, _j, artifact = recorded()

    def forbidden(*args, **kwargs):
        raise AssertionError("an artifact must never get a presigned or public URL")

    monkeypatch.setattr(type(get_storage()), "presigned_url", forbidden)
    assert viewer().get(f"{LIST}{artifact.pk}/media/").status_code == 200
    assert not hasattr(resolver, "derived_artifact")
    assert not AssetVersion.objects.filter(storage_key=artifact.storage_key).exists()


def test_artifact_keys_are_outside_every_delivery_prefix():
    from apps.assets import formats

    _v, _j, artifact = recorded()
    assert not artifact.storage_key.startswith(formats.KEY_PREFIXES)
    assert artifact.storage_key.startswith("processing/artifacts/")
