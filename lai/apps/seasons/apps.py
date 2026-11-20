from django.apps import AppConfig


class SeasonsConfig(AppConfig):
    name = "apps.seasons"
    label = "seasons"
    verbose_name = "Seasonal events"

    def ready(self):
        from . import receivers  # noqa: F401  (connects the WorldChange receiver)
