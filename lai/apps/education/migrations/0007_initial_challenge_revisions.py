"""Revision 1 for every existing challenge spec (ADR-043, LAI-0810). Origin SEED: the Treasure
Rush seed authored them. Reversible."""

from django.db import migrations
from django.utils.timezone import now

NOTE = "Initial version from the seed (ADR-043 migration)."
FIELDS = {
    "title": "title",
    "ageBand": "age_band",
    "skillId": "skill_id",
    "minValue": "min_value",
    "maxValue": "max_value",
    "responseMode": "response_mode",
    "choiceCount": "choice_count",
}


def forwards(apps, schema_editor):
    ContentType = apps.get_model("contenttypes", "ContentType")
    Revision = apps.get_model("catalog", "ContentRevision")
    Spec = apps.get_model("education", "ChallengeSpec")
    content_type, _ = ContentType.objects.get_or_create(
        app_label="education", model="challengespec"
    )
    at = now()
    for spec in Spec.objects.filter(published_revision__isnull=True):
        body = {"slug": spec.slug, **{key: getattr(spec, name) for key, name in FIELDS.items()}}
        revision = Revision.objects.create(
            kind="challenge-spec",
            content_type=content_type,
            object_id=str(spec.pk),
            record_key=spec.slug,
            number=1,
            body=body,
            status="PUBLISHED",
            origin="SEED",
            note=NOTE,
            created_at=at,
            published_at=at,
        )
        Spec.objects.filter(pk=spec.pk).update(published_revision=revision)


def backwards(apps, schema_editor):
    apps.get_model("education", "ChallengeSpec").objects.update(published_revision=None)
    apps.get_model("catalog", "ContentRevision").objects.filter(note=NOTE).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("education", "0006_authored_content"),
        ("catalog", "0006_initial_content_revisions"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
