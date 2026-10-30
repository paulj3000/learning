from django.apps import AppConfig


class AssetsConfig(AppConfig):
    name = "apps.assets"
    label = "assets"
    verbose_name = "Asset manager"

    def ready(self):
        from . import signals  # noqa: F401  (delete guards)
