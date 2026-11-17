# LAI-LAMBDA-008 phase 1: the `asset.process_audio` kind. Choices and the kind check constraint
# only; the integrator may fold this into one Wave 4 jobs migration.

from django.db import migrations, models

KINDS = [
    ("studio.generate_chunk", "Question Studio chunk"),
    ("speech.synthesize", "Shared speech clip"),
    ("asset.inspect", "Asset inspection"),
    ("asset.validate_model", "Model validation"),
    ("reference.checksum", "Reference checksum"),
    ("asset.process_audio", "Audio inspection"),
]


class Migration(migrations.Migration):
    dependencies = [
        ("jobs", "0003_contract_kinds"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="processingjob",
            name="jobs_kind_valid",
        ),
        migrations.AlterField(
            model_name="processingjob",
            name="kind",
            field=models.CharField(choices=KINDS, max_length=40),
        ),
        migrations.AddConstraint(
            model_name="processingjob",
            constraint=models.CheckConstraint(
                condition=models.Q(("kind__in", [kind for kind, _label in KINDS])),
                name="jobs_kind_valid",
            ),
        ),
    ]
