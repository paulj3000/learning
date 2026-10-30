"""Create or reset the asset manager's Django groups (LAI-2200 AM-5, ADR-035).

    python manage.py ensure_asset_roles

Idempotent: each group ends with exactly the permissions listed here, so re-running it after a
release also removes anything granted by hand. Add a staff account to a group on the Admin
accounts page (superusers only). Superusers need no group.

- Asset editors: create definitions, edit their display details, upload versions, delete
  never-published versions, and see everything.
- Asset publishers: everything editors can, plus publish, choose the default, and retire.
"""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

EDITORS = "Asset editors"
PUBLISHERS = "Asset publishers"

EDITOR_PERMISSIONS = (
    "catalog.view_contentasset",
    "catalog.add_contentasset",
    "catalog.change_contentasset",
    "assets.view_assetversion",
    "assets.add_assetversion",
    "assets.change_assetversion",
    "assets.delete_assetversion",
)
PUBLISHER_PERMISSIONS = (
    *EDITOR_PERMISSIONS,
    "assets.publish_assetversion",
    "assets.retire_assetversion",
)
ROLES = {EDITORS: EDITOR_PERMISSIONS, PUBLISHERS: PUBLISHER_PERMISSIONS}


def _permission(name: str) -> Permission:
    app_label, codename = name.split(".")
    try:
        return Permission.objects.get(content_type__app_label=app_label, codename=codename)
    except Permission.DoesNotExist:
        raise CommandError(f"Permission {name} does not exist; run migrate first.") from None


def ensure_asset_roles() -> dict[str, int]:
    counts = {}
    with transaction.atomic():
        for group_name, names in ROLES.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            group.permissions.set([_permission(name) for name in names])
            counts[group_name] = len(names)
    return counts


class Command(BaseCommand):
    help = "Create or reset the Asset editors and Asset publishers groups."

    def handle(self, *args, **options):
        for group, count in ensure_asset_roles().items():
            self.stdout.write(f"{group}: {count} permissions")
