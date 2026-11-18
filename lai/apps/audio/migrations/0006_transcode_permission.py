# The `transcode_audiofile` permission on the audio file proxy (ADR-067). No table.
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("audio", "0005_audio_file_proxy")]

    operations = [
        migrations.AlterModelOptions(
            name="audiofile",
            options={
                "permissions": [
                    ("inspect_audiofile", "Can inspect audio files in the background"),
                    (
                        "transcode_audiofile",
                        "Can transcode and normalise audio files in the background (outputs are "
                        "previews for review; nothing is published)",
                    ),
                ],
                "verbose_name": "audio file",
                "verbose_name_plural": "audio files (inspection)",
            },
        ),
    ]
