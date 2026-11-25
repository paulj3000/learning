from django.apps import AppConfig


class AudioConfig(AppConfig):
    name = "apps.audio"
    label = "audio"
    verbose_name = "Sound library"

    def ready(self):
        from . import dependencies, transcoding

        transcoding.register()
        # The LIVE sound release blocks retiring the audio it pins (LAI-07 W2-2).
        dependencies.register()
