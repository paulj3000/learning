# LAI-LAMBDA-008 phase 1: a proxy over audio asset versions for background inspection, and its
# `inspect_audiofile` permission. No table.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("assets", "0002_asset_library_media_families"),
        ("audio", "0004_spatial_audio_settings"),
    ]

    operations = [
        migrations.CreateModel(
            name="AudioFile",
            fields=[],
            options={
                "verbose_name": "audio file",
                "verbose_name_plural": "audio files (inspection)",
                "permissions": [("inspect_audiofile", "Can inspect audio files in the background")],
                "proxy": True,
                "indexes": [],
                "constraints": [],
            },
            bases=("assets.assetversion",),
        ),
    ]
