"""Revision 1 of every existing 3D Area's copy (ADR-043, LAI-0810). Origin SEED. Reversible."""

from django.db import migrations
from django.utils.timezone import now

NOTE = "Initial version from the seed (ADR-043 migration)."


def forwards(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    Revision = apps.get_model("catalog", "ContentRevision")
    Region = apps.get_model("regions", "WorldRegion")
    content_type, _ = ContentType.objects.get_or_create(app_label="regions", model="worldregion")
    at = now()
    for region in Region.objects.filter(published_revision__isnull=True):
        scene = region.scene if isinstance(region.scene, dict) else {}
        body = {
            "regionId": region.region_id,
            "title": region.title,
            "copy": dict(scene.get("copy", {})),
            "environment": dict(scene.get("environment", {})),
        }
        revision = Revision.objects.create(
            kind="area-copy",
            content_type=content_type,
            object_id=str(region.pk),
            record_key=region.region_id,
            number=1,
            body=body,
            status="PUBLISHED",
            origin="SEED",
            note=NOTE,
            created_at=at,
            published_at=at,
        )
        Region.objects.filter(pk=region.pk).update(published_revision=revision)


def backwards(apps, schema_editor):
    apps.get_model("regions", "WorldRegion").objects.update(published_revision=None)
    apps.get_model("catalog", "ContentRevision").objects.filter(note=NOTE).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("regions", "0003_authored_content"),
        ("catalog", "0006_initial_content_revisions"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
