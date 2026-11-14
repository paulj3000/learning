"""The six avatar identities a parent can choose, as drafts with no model (LAI-JMP-01c).

Drafts serve the placeholder, so this changes nothing a child sees until staff assign a
published model and make an identity available. Reversing removes only rows still untouched.
"""

from django.db import migrations

IDENTITIES = {
    "FOX": "Fox",
    "OWL": "Owl",
    "OTTER": "Otter",
    "DRAGON": "Dragon",
    "ROBOT": "Robot",
    "MERMAID": "Mermaid",
}


def seed(apps, schema_editor):
    PlayerAvatar = apps.get_model("avatars", "PlayerAvatar")
    for key, name in IDENTITIES.items():
        PlayerAvatar.objects.get_or_create(avatar_key=key, defaults={"display_name": name})


def unseed(apps, schema_editor):
    PlayerAvatar = apps.get_model("avatars", "PlayerAvatar")
    PlayerAvatar.objects.filter(
        avatar_key__in=IDENTITIES, status="DRAFT", model_asset__isnull=True
    ).delete()


class Migration(migrations.Migration):
    dependencies = [("avatars", "0001_initial")]

    operations = [migrations.RunPython(seed, unseed)]
