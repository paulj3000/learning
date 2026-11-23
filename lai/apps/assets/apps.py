from django.apps import AppConfig


class AssetsConfig(AppConfig):
    name = "apps.assets"
    label = "assets"
    verbose_name = "Asset library"

    def ready(self):
        from . import signals  # noqa: F401  (delete guards)
        from .dependencies import retirement_guard
        from .services import register_retirement_guard

        # One guard asks every registered usage provider (LAI-07 W2, ASSET_LIBRARY.md s. 25).
        register_retirement_guard(retirement_guard)
