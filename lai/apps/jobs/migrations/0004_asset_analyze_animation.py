# LAI-LAMBDA-009: the `asset.analyze_animation` contract kind (choices and the kind check only).
# Self-contained so the Wave 4 integrator can fold it into one migration with the other kinds.

from django.db import migrations, models


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
            field=models.CharField(
                choices=[
                    ("studio.generate_chunk", "Question Studio chunk"),
                    ("speech.synthesize", "Shared speech clip"),
                    ("asset.inspect", "Asset inspection"),
                    ("asset.validate_model", "Model validation"),
                    ("reference.checksum", "Reference checksum"),
                    ("asset.analyze_animation", "Animation inspection"),
                ],
                max_length=40,
            ),
        ),
        migrations.AddConstraint(
            model_name="processingjob",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    (
                        "kind__in",
                        [
                            "studio.generate_chunk",
                            "speech.synthesize",
                            "asset.inspect",
                            "asset.validate_model",
                            "reference.checksum",
                            "asset.analyze_animation",
                        ],
                    )
                ),
                name="jobs_kind_valid",
            ),
        ),
    ]
