"""Create or reset the NPC Manager's Django groups (LAI-NPC-005, ADR-050).

    python manage.py ensure_npc_roles

Idempotent, like `ensure_asset_roles`: each group ends with exactly the permissions listed here,
so re-running it also removes anything granted by hand. Add a staff account to a group on the
Admin accounts page (superusers only). Superusers need no group.

- NPC editors: author characters (including creating a Django-only NPC), model variants and their
  extras, placements and dialogue trees; change a character's status (Draft, Ready, Retired);
  view releases, validate the draft and read the asset dependency report; preview models through
  the asset library. They cannot publish, roll back or retire a release. Characters are retired
  through their status, never deleted.
- NPC publishers: everything editors can, plus publish a release (`publish_npcrelease`) and roll
  back or retire one (`rollback_npcrelease`).

Editors also author behaviour profiles (LAI-NPC-019) and draft personas (LAI-NPC-031); approving
or retiring a persona needs `publish_npcrelease`, so only publishers can do it. Voice profiles stay
with the speech app's own roles; editors may view them to pick one.
"""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

EDITORS = "NPC editors"
PUBLISHERS = "NPC publishers"

# Versioned or shared rows: authored and changed, never deleted (retired or superseded instead).
_PROFILES = ("npcbehaviorprofile", "npcpersona")
_AUTHORING = (
    "npcmodelvariant",
    "npcvariantasset",
    "npcplacement",
    "npcdialogue",
    "npcdialoguenode",
    "npcdialoguechoice",
)

EDITOR_PERMISSIONS = (
    "npcs.view_npccharacter",
    "npcs.add_npccharacter",
    "npcs.change_npccharacter",
    *(f"npcs.{action}_{model}" for model in _AUTHORING for action in ("view", "add", "change")),
    *(f"npcs.delete_{model}" for model in _AUTHORING),
    *(f"npcs.{action}_{model}" for model in _PROFILES for action in ("view", "add", "change")),
    "npcs.view_npcrelease",
    "speech.view_voiceprofile",
    # Read-only asset library access: pick assets and open the existing previews.
    "catalog.view_contentasset",
    "assets.view_assetversion",
)
PUBLISHER_PERMISSIONS = (
    *EDITOR_PERMISSIONS,
    "npcs.publish_npcrelease",
    "npcs.rollback_npcrelease",
)
ROLES = {EDITORS: EDITOR_PERMISSIONS, PUBLISHERS: PUBLISHER_PERMISSIONS}


def _permission(name: str) -> Permission:
    app_label, codename = name.split(".")
    try:
        return Permission.objects.get(content_type__app_label=app_label, codename=codename)
    except Permission.DoesNotExist:
        raise CommandError(f"Permission {name} does not exist; run migrate first.") from None


def ensure_npc_roles() -> dict[str, int]:
    counts = {}
    with transaction.atomic():
        for group_name, names in ROLES.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            group.permissions.set([_permission(name) for name in names])
            counts[group_name] = len(names)
    return counts


class Command(BaseCommand):
    help = "Create or reset the NPC editors and NPC publishers groups."

    def handle(self, *args, **options):
        for group, count in ensure_npc_roles().items():
            self.stdout.write(f"{group}: {count} permissions")
