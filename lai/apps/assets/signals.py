"""Delete guards that also cover queryset deletes, which skip `Model.delete` (LAI-2200)."""

from django.db.models.signals import pre_delete
from django.dispatch import receiver

from .models import AssetVersion, ImmutableVersion


@receiver(pre_delete, sender=AssetVersion)
def refuse_deleting_a_published_version(sender, instance, **kwargs):
    if instance.was_published:
        raise ImmutableVersion("A version that was published is never deleted; retire it instead.")
