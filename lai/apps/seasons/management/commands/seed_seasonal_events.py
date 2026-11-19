"""Create the starter seasonal events, create-only and idempotent (NP-023, ADR-081).

    python manage.py seed_seasonal_events

An existing event is never changed (staff own it after creation). The `christmas` event is
skipped with a message while the `north-pole` Realm does not exist; run it again after the North
Pole content is seeded. Not a migration: content is never forced by schema changes.
"""

from django.core.management.base import BaseCommand

from apps.catalog.models import World
from apps.seasons.models import Availability, SeasonalEvent, Theme


class Command(BaseCommand):
    help = "Create the Christmas at the North Pole seasonal event (create-only)."

    def handle(self, *args, **options):
        if SeasonalEvent.objects.filter(slug="christmas").exists():
            self.stdout.write("christmas: already exists, left unchanged")
            return
        realm = World.objects.filter(slug="north-pole").first()
        if realm is None:
            self.stdout.write("christmas: skipped, the north-pole Realm does not exist yet")
            return
        event = SeasonalEvent(
            slug="christmas",
            title="Christmas at the North Pole",
            theme=Theme.CHRISTMAS,
            availability=Availability.YEAR_ROUND,
            window_start_month=12,
            window_start_day=1,
            window_end_month=1,
            window_end_day=6,
            featured_in_window=True,
            active=True,
            completion_change_key="NORTH_POLE_ADVENTURE_COMPLETE",
            audio_cue_ids=["music.north_pole.village"],
            decoration_theme="winter",
        )
        event.full_clean()
        event.save()
        event.realms.add(realm)
        self.stdout.write("christmas: created")
