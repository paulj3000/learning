"""Create or reset the sound library's Django groups (SM-P2-08).

    python manage.py ensure_sound_roles

Idempotent, like `ensure_asset_roles`: each group ends with exactly these permissions.

- Sound editors: create and edit cues and assignments, preview audio, and read releases.
- Sound publishers: everything editors can, plus publish the library and roll it back.

Uploading and publishing the audio files themselves stays with the Asset Library groups.
"""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

EDITORS = "Sound editors"
PUBLISHERS = "Sound publishers"

EDITOR_PERMISSIONS = (
    "audio.view_soundcue",
    "audio.add_soundcue",
    "audio.change_soundcue",
    "audio.delete_soundcue",
    "audio.view_soundassignment",
    "audio.add_soundassignment",
    "audio.change_soundassignment",
    "audio.delete_soundassignment",
    "audio.view_soundrelease",
    # Choosing an audio asset and hearing it needs a read-only view of the Asset Library.
    "catalog.view_contentasset",
    "assets.view_assetversion",
)
PUBLISHER_PERMISSIONS = (
    *EDITOR_PERMISSIONS,
    "audio.publish_soundrelease",
    "audio.rollback_soundrelease",
)
ROLES = {EDITORS: EDITOR_PERMISSIONS, PUBLISHERS: PUBLISHER_PERMISSIONS}


def _permission(name: str) -> Permission:
    app_label, codename = name.split(".")
    try:
        return Permission.objects.get(content_type__app_label=app_label, codename=codename)
    except Permission.DoesNotExist:
        raise CommandError(f"Permission {name} does not exist; run migrate first.") from None


def ensure_sound_roles() -> dict[str, int]:
    counts = {}
    with transaction.atomic():
        for group_name, names in ROLES.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            group.permissions.set([_permission(name) for name in names])
            counts[group_name] = len(names)
    return counts


class Command(BaseCommand):
    help = "Create or reset the Sound editors and Sound publishers groups."

    def handle(self, *args, **options):
        for group, count in ensure_sound_roles().items():
            self.stdout.write(f"{group}: {count} permissions")
