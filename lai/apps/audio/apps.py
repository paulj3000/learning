from django.apps import AppConfig


class AudioConfig(AppConfig):
    name = "apps.audio"
    label = "audio"
    verbose_name = "Sound library"

    def ready(self):
        from . import transcoding

        transcoding.register()
