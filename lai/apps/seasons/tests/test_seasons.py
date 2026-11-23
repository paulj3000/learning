import datetime as dt
import io

import pytest
from django.contrib import admin
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.catalog.models import Location, World
from apps.progression.models import WorldChange
from apps.seasons import receivers
from apps.seasons.availability import SeasonalIndex, is_place_visible, seasonal_info
from apps.seasons.models import Availability, SeasonalCompletion, SeasonalEvent, Theme

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

D = dt.date
KEY = "SEASON_DONE"


def make(slug="xmas", **kw):
    fields = dict(
        title="Xmas",
        theme=Theme.CHRISTMAS,
        window_start_month=12,
        window_start_day=1,
        window_end_month=1,
        window_end_day=6,
    )
    fields.update(kw)
    return SeasonalEvent.objects.create(slug=slug, **fields)


@pytest.fixture
def bay(treasure):
    return Location.objects.get(slug="pirate-builder-bay")


@pytest.fixture
def home():
    return World.objects.get(slug="learning-adventure-island")


# --- model validation -----------------------------------------------------------------------


@pytest.mark.parametrize(
    "fields",
    [
        dict(window_start_month=2, window_start_day=30),
        dict(window_end_month=4, window_end_day=31),
        dict(window_end_month=None, window_end_day=None),
        dict(window_start_month=13),
        dict(audio_cue_ids=["Bad Cue"]),
        dict(
            availability=Availability.WINDOW_ONLY,
            window_start_month=None,
            window_start_day=None,
            window_end_month=None,
            window_end_day=None,
        ),
    ],
)
def test_invalid_events_are_rejected(fields):
    base = dict(
        slug="x",
        title="X",
        window_start_month=12,
        window_start_day=1,
        window_end_month=1,
        window_end_day=6,
    )
    base.update(fields)
    with pytest.raises(ValidationError):
        SeasonalEvent(**base).full_clean()


def test_valid_event_with_feb_29_passes_and_db_requires_all_or_none():
    SeasonalEvent(
        slug="ok",
        title="Ok",
        window_start_month=2,
        window_start_day=29,
        window_end_month=3,
        window_end_day=1,
        audio_cue_ids=["music.north_pole.village"],
    ).full_clean()
    with pytest.raises(IntegrityError), transaction.atomic():
        SeasonalEvent.objects.create(slug="half", title="H", window_start_month=1)


# --- visibility -------------------------------------------------------------------------------


def test_no_event_means_visible_and_no_seasonal(bay, home):
    assert is_place_visible(bay, D(2026, 7, 1))
    assert seasonal_info(bay, D(2026, 7, 1)) is None
    assert seasonal_info(home, D(2026, 7, 1)) is None


def test_window_only_place_hidden_outside_and_shown_inside(bay):
    make(availability=Availability.WINDOW_ONLY).places.add(bay)
    assert not is_place_visible(bay, D(2026, 7, 1))
    assert is_place_visible(bay, D(2026, 12, 25))
    assert is_place_visible(bay, D(2027, 1, 6))
    assert not is_place_visible(bay, D(2027, 1, 7))


def test_place_inherits_its_realm_event(bay, home):
    make(availability=Availability.WINDOW_ONLY).realms.add(home)
    assert not is_place_visible(bay, D(2026, 7, 1))
    assert is_place_visible(bay, D(2026, 12, 2))
    assert not SeasonalIndex(D(2026, 7, 1)).world_visible(home)


def test_year_round_and_inactive_events_never_hide(bay):
    make("a").places.add(bay)
    make("b", availability=Availability.WINDOW_ONLY, active=False).places.add(bay)
    assert is_place_visible(bay, D(2026, 7, 1))


def test_multiple_window_only_events_any_window_reveals(bay):
    make("a", availability=Availability.WINDOW_ONLY).places.add(bay)
    make(
        "b",
        availability=Availability.WINDOW_ONLY,
        window_start_month=10,
        window_start_day=1,
        window_end_month=10,
        window_end_day=31,
    ).places.add(bay)
    assert is_place_visible(bay, D(2026, 10, 15))
    assert is_place_visible(bay, D(2026, 12, 15))
    assert not is_place_visible(bay, D(2026, 8, 15))


def test_seasonal_info_shape(bay, home):
    make(featured_in_window=True).realms.add(home)
    inside = seasonal_info(home, D(2026, 12, 20))
    assert inside == {"slug": "xmas", "theme": "CHRISTMAS", "featured": True, "inWindow": True}
    outside = seasonal_info(bay, D(2026, 6, 1))
    assert outside == {"slug": "xmas", "theme": "CHRISTMAS", "featured": False, "inWindow": False}


# --- completion receiver -----------------------------------------------------------------------


def change(child, key=KEY, slug="pirate-builder-bay", when=None):
    return WorldChange.objects.create(
        child=child,
        location_slug=slug,
        change_type="X",
        change_key=key,
        created_at=when or timezone.now(),
    )


def test_receiver_records_once_per_season_year_and_ignores_other_keys(treasure, bay):
    child = treasure.families.a1
    make(completion_change_key=KEY).places.add(bay)
    change(child, "OTHER")
    assert SeasonalCompletion.objects.count() == 0
    wc = change(child)
    assert SeasonalCompletion.objects.for_child(child).count() == 1
    receivers.record_completions(wc)  # idempotent
    assert SeasonalCompletion.objects.count() == 1
    other = treasure.families.b1
    change(other)
    assert SeasonalCompletion.objects.for_child(other).count() == 1


def test_receiver_uses_season_year_for_january(treasure, bay):
    make(completion_change_key=KEY).places.add(bay)
    when = dt.datetime(2027, 1, 3, 12, tzinfo=dt.UTC)
    change(treasure.families.a1, when=when)
    assert SeasonalCompletion.objects.get().season_year == 2026


def test_receiver_ignores_inactive_unlinked_and_unknown_location(treasure, bay, home):
    child = treasure.families.a1
    make("off", completion_change_key=KEY, active=False).places.add(bay)
    make("unlinked", completion_change_key=KEY)
    change(child)
    change(child, slug="no-such-place")
    assert SeasonalCompletion.objects.count() == 0


def test_receiver_via_realm_and_never_raises(treasure, home, monkeypatch, caplog):
    make(completion_change_key=KEY).realms.add(home)
    change(treasure.families.a1)
    assert SeasonalCompletion.objects.count() == 1

    def boom(_):
        raise RuntimeError("Zinnia-A1 secret")

    monkeypatch.setattr(receivers, "record_completions", boom)
    change(treasure.families.a2)  # must not raise
    assert "Zinnia" not in caplog.text and "secret" not in caplog.text


# --- discovery + ownership ----------------------------------------------------------------------


def islands(client, child):
    body = client.get(f"/api/v1/children/{child.pk}/islands/").json()
    return {i["islandId"]: i for i in body["islands"]}


def test_islands_api_hides_and_marks(treasure, api, bay, home, monkeypatch):
    a, child = api(treasure.families.a), treasure.families.a1
    base = islands(a, child)
    assert all(i["seasonal"] is None for i in base.values())
    assert all(p["seasonal"] is None for i in base.values() for p in i["places"])

    today = timezone.localdate()
    ev = make(featured_in_window=True)
    ev.window_start_month, ev.window_start_day = today.month, today.day
    ev.window_end_month, ev.window_end_day = today.month, today.day
    ev.save()
    ev.realms.add(home)
    body = islands(a, child)
    assert body[home.slug]["seasonal"]["featured"] is True
    assert body[home.slug]["seasonal"]["inWindow"] is True

    # Outside the window and WINDOW_ONLY: the Place is gone for everyone, saves untouched.
    tomorrow = today + dt.timedelta(days=40)
    ev.window_start_month = ev.window_end_month = tomorrow.month
    ev.window_start_day = ev.window_end_day = tomorrow.day
    ev.availability = Availability.WINDOW_ONLY
    ev.save()
    ev.realms.clear()
    ev.places.add(bay)
    body = islands(a, child)
    assert "pirate-builder-bay" not in {p["placeId"] for p in body[home.slug]["places"]}
    regions = a.get(f"/api/v1/children/{child.pk}/regions/")
    assert regions.status_code == 200
    assert all(r["location"]["slug"] != "pirate-builder-bay" for r in regions.json()["regions"])


def test_another_parent_cannot_read_islands_and_no_completion_endpoint(treasure, api, bay):
    make(completion_change_key=KEY).places.add(bay)
    change(treasure.families.a1)
    b = api(treasure.families.b)
    assert b.get(f"/api/v1/children/{treasure.families.a1.pk}/islands/").status_code in (403, 404)


# --- admin + seed -------------------------------------------------------------------------------


def test_admin_registration_and_actions():
    assert SeasonalEvent in admin.site._registry
    assert SeasonalCompletion not in admin.site._registry
    model_admin = admin.site._registry[SeasonalEvent]
    assert {"activate", "deactivate"} <= set(model_admin.actions)
    assert "created_at" in model_admin.readonly_fields


def test_seed_command_is_idempotent_and_skips_without_realm(treasure):
    # The real content export now carries the north-pole Realm; move it aside so the first run
    # sees a database without it, as on a branch that has not imported North Pole yet.
    World.objects.filter(slug="north-pole").update(slug="north-pole-not-imported")
    out = io.StringIO()
    call_command("seed_seasonal_events", stdout=out)
    assert "skipped" in out.getvalue()
    realm = World.objects.get(slug="learning-adventure-island")
    realm.slug = "north-pole"
    realm.save()
    call_command("seed_seasonal_events", stdout=io.StringIO())
    call_command("seed_seasonal_events", stdout=io.StringIO())
    event = SeasonalEvent.objects.get(slug="christmas")
    assert event.theme == Theme.CHRISTMAS and event.realms.get() == realm
    assert event.audio_cue_ids == ["music.north_pole.village"]
    assert SeasonalEvent.objects.count() == 1


# --- server-side gating and saves (ADR-081 acceptance, LAI 03 review 2026-11-23) ------------------


def _window(event, day):
    event.window_start_month = event.window_end_month = day.month
    event.window_start_day = event.window_end_day = day.day
    event.save()


def test_launch_outside_the_window_is_refused_and_saves_survive(treasure, api, bay):
    """Hiding is enforced by the server's launch check, not only by discovery, and never removes
    a world change, an inventory item or a seasonal completion; back in the window it all returns."""
    from apps.inventory.models import InventoryItem

    child, client = treasure.families.a1, api(treasure.families.a)
    url = f"/api/v1/children/{child.pk}/game-launches/"
    today = timezone.localdate()
    event = make(completion_change_key=KEY, availability=Availability.WINDOW_ONLY)
    _window(event, today)
    event.places.add(bay)

    assert client.post(url, {"regionId": "treasure-rush-cove"}, "application/json").status_code == 201
    change(child)
    saved = (
        set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True)),
        set(InventoryItem.objects.filter(child=child).values_list("pk", flat=True)),
        SeasonalCompletion.objects.for_child(child).count(),
    )
    assert saved[2] == 1

    _window(event, today + dt.timedelta(days=40))
    refused = client.post(url, {"regionId": "treasure-rush-cove"}, "application/json")
    assert refused.status_code == 404
    assert (
        set(WorldChange.objects.filter(child=child).values_list("change_key", flat=True)),
        set(InventoryItem.objects.filter(child=child).values_list("pk", flat=True)),
        SeasonalCompletion.objects.for_child(child).count(),
    ) == saved

    _window(event, today)
    assert client.post(url, {"regionId": "treasure-rush-cove"}, "application/json").status_code == 201
    assert SeasonalCompletion.objects.for_child(child).count() == 1


def test_the_window_opens_on_the_server_date_in_the_configured_time_zone(bay, monkeypatch):
    """The default date is `timezone.localdate()` (settings.TIME_ZONE, "UTC"), not the device's.
    23:30 UTC on Nov 30 is still Nov 30 in UTC but already Dec 1 in Auckland."""
    make(availability=Availability.WINDOW_ONLY).places.add(bay)
    instant = dt.datetime(2026, 11, 30, 23, 30, tzinfo=dt.UTC)
    monkeypatch.setattr(timezone, "now", lambda: instant)
    with timezone.override("UTC"):
        assert not is_place_visible(bay)
    with timezone.override("Pacific/Auckland"):
        assert is_place_visible(bay)
