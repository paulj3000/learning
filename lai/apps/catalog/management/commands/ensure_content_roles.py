"""Create or reset the content authoring Django groups (ADR-047-Q1, LAI-0801).

    python manage.py ensure_content_roles

Idempotent, like `ensure_asset_roles`: each group ends with exactly these permissions. One
administrator may be in both groups (ADR-047-Q1); the permissions stay separate so an approval
step can be introduced later without a migration. Superusers need no group.

- Content editors: start, edit and discard drafts; see every version.
- Content publishers: everything editors can, plus publish drafts and restore earlier versions.
- Content developers: everything editors can, plus edit a draft as raw JSON (debugging). The
  default editor is the structured form; raw JSON is a separate permission (LAI-0801).
"""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

EDITORS = "Content editors"
PUBLISHERS = "Content publishers"
EDITOR_PERMISSIONS = ("catalog.view_contentrevision", "catalog.edit_content_draft")
PUBLISHER_PERMISSIONS = (*EDITOR_PERMISSIONS, "catalog.publish_content")
DEVELOPERS = "Content developers"
DEVELOPER_PERMISSIONS = (*EDITOR_PERMISSIONS, "catalog.edit_content_json")
ROLES = {
    EDITORS: EDITOR_PERMISSIONS,
    PUBLISHERS: PUBLISHER_PERMISSIONS,
    DEVELOPERS: DEVELOPER_PERMISSIONS,
}


def _permission(name: str) -> Permission:
    app_label, codename = name.split(".")
    try:
        return Permission.objects.get(content_type__app_label=app_label, codename=codename)
    except Permission.DoesNotExist:
        raise CommandError(f"Permission {name} does not exist; run migrate first.") from None


def ensure_content_roles() -> dict[str, int]:
    counts = {}
    with transaction.atomic():
        for group_name, names in ROLES.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            group.permissions.set([_permission(name) for name in names])
            counts[group_name] = len(names)
    return counts


class Command(BaseCommand):
    help = "Create or reset the Content editors, publishers and developers groups (ADR-047)."

    def handle(self, *args, **options):
        for group, count in ensure_content_roles().items():
            self.stdout.write(f"{group}: {count} permissions")
