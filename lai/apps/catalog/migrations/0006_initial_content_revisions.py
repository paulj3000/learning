"""Revision 1 for every existing catalog record (ADR-043, LAI-0810).

Each record's current content (`source`, which the last import wrote) becomes its first
published revision, origin IMPORT, tied to the release that wrote it. Export-owned, as before.
Reversible: the reverse clears the pointers and removes exactly these revisions.
"""

from django.db import migrations

KINDS = (
    ("World", "island", "slug"),
    ("Location", "place", "slug"),
    ("Adventure", "adventure", "slug"),
    ("AdventureStep", "adventure-step", "step_id"),
    ("Quest", "quest", "slug"),
    ("LearningObjective", "learning-objective", "code"),
    ("NpcDefinition", "npc", "npc_id"),
    ("CollectibleSet", "collectible-set", "set_id"),
    ("ItemDefinition", "item", "item_id"),
    ("RewardRule", "reward-rule", "rule_id"),
)
NOTE = "Initial version from the content import (ADR-043 migration)."


def forwards(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    Revision = apps.get_model("catalog", "ContentRevision")
    for model_name, kind, key_field in KINDS:
        model = apps.get_model("catalog", model_name)
        content_type, _ = ContentType.objects.get_or_create(
            app_label="catalog", model=model_name.lower()
        )
        for row in model.objects.filter(published_revision__isnull=True).iterator():
            published_at = row.last_seen_release.imported_at
            revision = Revision.objects.create(
                kind=kind,
                content_type=content_type,
                object_id=str(row.pk),
                record_key=str(getattr(row, key_field)),
                number=1,
                body=row.source,
                status="PUBLISHED",
                origin="IMPORT",
                content_release=row.last_seen_release,
                note=NOTE,
                created_at=published_at,
                published_at=published_at,
            )
            model.objects.filter(pk=row.pk).update(published_revision=revision)


def backwards(apps, schema_editor):
    Revision = apps.get_model("catalog", "ContentRevision")
    for model_name, _, _ in KINDS:
        apps.get_model("catalog", model_name).objects.update(published_revision=None)
    Revision.objects.filter(note=NOTE).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("catalog", "0005_content_revisions"),
        ("contenttypes", "0002_remove_content_type_name"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
