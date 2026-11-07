"""SM-P5: a child's saved audio mix. Child-scoped, strict, defaults without a row."""

import json

import pytest

from apps.audio.models import ChildAudioSettings

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]


def url(child):
    return f"/api/v1/children/{child.pk}/audio/settings/"


def patch(client, child, body):
    return client.patch(url(child), data=json.dumps(body), content_type="application/json")


def test_before_any_save_the_calm_defaults_are_returned_without_a_row(api, families, cognito):
    response = api(families.a).get(url(families.a1))
    body = response.json()
    assert response.status_code == 200
    assert body["masterVolume"] == 1.0 and body["masterMuted"] is False
    assert body["reducedIntensity"] is False
    assert body["channels"]["music"] == {"volume": 0.5, "muted": False}
    assert body["channels"]["sfx"]["volume"] == 0.8
    assert set(body["channels"]) == {"music", "ambient", "sfx", "voice", "ui"}
    assert ChildAudioSettings.objects.count() == 0


def test_a_partial_update_changes_only_what_was_sent_and_persists(api, families, cognito):
    client = api(families.a)
    response = patch(client, families.a1, {"channels": {"music": {"volume": 0.2}}})
    assert response.status_code == 200
    patch(client, families.a1, {"masterMuted": True, "channels": {"music": {"muted": True}}})
    body = client.get(url(families.a1)).json()
    assert body["masterMuted"] is True
    # Muting keeps the remembered volume.
    assert body["channels"]["music"] == {"volume": 0.2, "muted": True}
    assert body["channels"]["voice"] == {"volume": 1.0, "muted": False}
    assert ChildAudioSettings.objects.count() == 1


def test_reduced_intensity_is_saved(api, families, cognito):
    client = api(families.a)
    patch(client, families.a1, {"reducedIntensity": True})
    assert client.get(url(families.a1)).json()["reducedIntensity"] is True


def test_each_child_has_their_own_mix(api, families, cognito):
    client = api(families.a)
    patch(client, families.a1, {"masterVolume": 0.1})
    assert client.get(url(families.a2)).json()["masterVolume"] == 1.0
    assert client.get(url(families.a1)).json()["masterVolume"] == 0.1


@pytest.mark.parametrize(
    "body",
    [
        {"masterVolume": 1.5},
        {"masterVolume": -0.1},
        {"masterVolume": "loud"},
        {"masterMuted": "maybe"},
        {"channels": {"music": {"volume": 2}}},
        {"channels": {"narrator": {"volume": 0.5}}},
        {"channels": {"music": {"gain": 0.5}}},
        {"surprise": True},
    ],
)
def test_invalid_updates_are_refused_and_save_nothing(api, families, cognito, body):
    response = patch(api(families.a), families.a1, body)
    assert response.status_code == 400
    assert ChildAudioSettings.objects.count() == 0


def test_another_familys_child_is_a_404_for_read_and_write(api, families, cognito):
    intruder = api(families.b)
    assert intruder.get(url(families.a1)).status_code == 404
    assert patch(intruder, families.a1, {"masterVolume": 0.0}).status_code == 404
    assert ChildAudioSettings.objects.count() == 0


def test_no_token_is_401_and_other_verbs_are_refused(api, families, cognito):
    assert api().get(url(families.a1)).status_code == 401
    assert patch(api(), families.a1, {"masterVolume": 0.0}).status_code == 401
    client = api(families.a)
    assert (
        client.post(url(families.a1), data="{}", content_type="application/json").status_code == 405
    )
    assert client.delete(url(families.a1)).status_code == 405


def test_the_database_refuses_an_out_of_range_volume(families):
    from django.db import IntegrityError, transaction

    with pytest.raises(IntegrityError), transaction.atomic():
        ChildAudioSettings.objects.create(child=families.a1, music_volume=3.0)


def test_one_row_per_child(families):
    from django.db import IntegrityError, transaction

    ChildAudioSettings.objects.create(child=families.a1)
    with pytest.raises(IntegrityError), transaction.atomic():
        ChildAudioSettings.objects.create(child=families.a1)
