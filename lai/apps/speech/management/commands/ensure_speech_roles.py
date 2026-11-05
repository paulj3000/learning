"""Create or reset the staff group for spoken dialogue (SM-P8-03).

    python manage.py ensure_speech_roles

Idempotent. **Speech editors** may manage voice profiles and speech lines and view clips and
daily totals. There is no publish step: speech reaches children only through authorized requests.
"""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

EDITORS = "Speech editors"
PERMISSIONS = (
    "speech.view_voiceprofile",
    "speech.add_voiceprofile",
    "speech.change_voiceprofile",
    "speech.view_speechline",
    "speech.add_speechline",
    "speech.change_speechline",
    "speech.delete_speechline",
    "speech.view_speechclip",
    "speech.view_speechdailytotal",
)


class Command(BaseCommand):
    help = "Create or reset the Speech editors group."

    @transaction.atomic
    def handle(self, *args, **options):
        group, _ = Group.objects.get_or_create(name=EDITORS)
        found = []
        for label in PERMISSIONS:
            app, codename = label.split(".")
            try:
                found.append(Permission.objects.get(content_type__app_label=app, codename=codename))
            except Permission.DoesNotExist:
                raise CommandError(f"Missing permission {label}. Run migrate first.") from None
        group.permissions.set(found)
        self.stdout.write(f"{EDITORS}: {len(found)} permissions")
