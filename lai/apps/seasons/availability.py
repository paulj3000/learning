"""Seasonal availability (NP-023, ADR-081). Pure rules over event rows.

Timezone: callers pass a `datetime.date`; the server default is `timezone.localdate()`, the
server's configured TIME_ZONE (not the child's device). A window is month/day inclusive at both
ends and may cross Dec 31. Feb 29 is a valid edge and is compared as the pair (2, 29); in a
non-leap year the date does not exist, so a window ending Feb 29 effectively ends Feb 28.

Rules:
- `in_window`: an event with no window is never "in window".
- A Place is hidden only when it belongs (directly, or through its Realm) to at least one ACTIVE
  WINDOW_ONLY event and the date is outside every such event's window. Year-round events and
  inactive events never hide anything. Hiding never touches saved progress.
- Season year: the year the window starts (a January date in a Dec-Jan window belongs to the
  previous year); an event with no window uses the calendar year.
"""

from __future__ import annotations

import datetime
from collections import defaultdict

from django.db.models import Q
from django.utils import timezone

from .models import Availability, SeasonalEvent


def _md(value: datetime.date) -> tuple[int, int]:
    return (value.month, value.day)


def crosses_new_year(event: SeasonalEvent) -> bool:
    if not event.has_window:
        return False
    return (event.window_end_month, event.window_end_day) < (
        event.window_start_month,
        event.window_start_day,
    )


def in_window(event: SeasonalEvent, date: datetime.date) -> bool:
    if not event.has_window:
        return False
    start = (event.window_start_month, event.window_start_day)
    end = (event.window_end_month, event.window_end_day)
    md = _md(date)
    if start <= end:
        return start <= md <= end
    return md >= start or md <= end


def season_year(event: SeasonalEvent, date: datetime.date) -> int:
    if crosses_new_year(event) and _md(date) <= (event.window_end_month, event.window_end_day):
        return date.year - 1
    return date.year


class SeasonalIndex:
    """Active events and what they link, loaded once (3 queries) so discovery stays flat."""

    def __init__(self, date: datetime.date | None = None):
        self.date = date or timezone.localdate()
        events = list(
            SeasonalEvent.objects.filter(active=True).prefetch_related("realms", "places")
        )
        self._by_world: dict[int, list[SeasonalEvent]] = defaultdict(list)
        self._by_place: dict[int, list[SeasonalEvent]] = defaultdict(list)
        for event in events:
            for world in event.realms.all():
                self._by_world[world.pk].append(event)
            for place in event.places.all():
                self._by_place[place.pk].append(event)

    def _events_for_place(self, place) -> list[SeasonalEvent]:
        found = {e.pk: e for e in self._by_world.get(place.world_id, [])}
        found.update({e.pk: e for e in self._by_place.get(place.pk, [])})
        return list(found.values())

    @staticmethod
    def _hidden(events: list[SeasonalEvent], date: datetime.date) -> bool:
        gated = [e for e in events if e.availability == Availability.WINDOW_ONLY]
        return bool(gated) and not any(in_window(e, date) for e in gated)

    def hidden_place_ids(self) -> set[int]:
        """Ids of Places hidden today, for a queryset exclude (one query)."""
        from apps.catalog.models import Location

        # A Place is hidden by its combined events (its own plus its Realm's), not either alone.
        candidates = Location.objects.filter(
            Q(world_id__in=self._by_world.keys()) | Q(pk__in=self._by_place.keys())
        ).only("pk", "world_id")
        return {p.pk for p in candidates if not self.place_visible(p)}

    def place_visible(self, place) -> bool:
        return not self._hidden(self._events_for_place(place), self.date)

    def world_visible(self, world) -> bool:
        return not self._hidden(self._by_world.get(world.pk, []), self.date)

    def info(self, row) -> dict | None:
        events = (
            self._events_for_place(row)
            if hasattr(row, "world_id")
            else list(self._by_world.get(row.pk, []))
        )
        if not events:
            return None
        # The event in its window first, then a featured one, then slug order.
        best = min(
            events,
            key=lambda e: (
                not in_window(e, self.date),
                not (e.featured_in_window and in_window(e, self.date)),
                e.slug,
            ),
        )
        inside = in_window(best, self.date)
        return {
            "slug": best.slug,
            "theme": best.theme,
            "featured": bool(best.featured_in_window and inside),
            "inWindow": inside,
        }


def is_place_visible(place, date: datetime.date | None = None) -> bool:
    return SeasonalIndex(date).place_visible(place)


def seasonal_info(world_or_place, date: datetime.date | None = None) -> dict | None:
    """`{slug, theme, featured, inWindow}` for the most relevant active event, or None."""
    return SeasonalIndex(date).info(world_or_place)
