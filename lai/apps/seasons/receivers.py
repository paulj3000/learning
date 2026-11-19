"""Record `SeasonalCompletion` when an event's completion world change arrives (NP-023)."""

import logging

from django.db import transaction
from django.db.models import Q
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.catalog.models import Location
from apps.progression.models import WorldChange

from .availability import season_year
from .models import SeasonalCompletion, SeasonalEvent

logger = logging.getLogger(__name__)


def record_completions(change: WorldChange) -> int:
    """Idempotent. Returns how many completion rows were created."""
    location = Location.objects.filter(slug=change.location_slug).first()
    if location is None:
        return 0
    events = SeasonalEvent.objects.filter(
        active=True, completion_change_key=change.change_key
    ).filter(Q(realms=location.world_id) | Q(places=location.pk))
    created = 0
    when = change.created_at
    for event in events.distinct():
        _row, made = SeasonalCompletion.objects.get_or_create(
            child_id=change.child_id,
            event=event,
            season_year=season_year(event, timezone.localtime(when).date()),
            defaults={"completed_at": when},
        )
        created += made
    return created


@receiver(post_save, sender=WorldChange, dispatch_uid="seasons_record_completion")
def on_world_change(sender, instance, created, raw=False, **kwargs):
    if not created or raw:
        return
    try:
        with transaction.atomic():
            record_completions(instance)
    except Exception as error:  # never break the world change that caused this
        # Type only: no child id, slug, key or message text (they may carry child data).
        logger.error("Seasonal completion was not recorded (%s).", type(error).__name__)
