from django.apps import AppConfig


class CatalogConfig(AppConfig):
    name = "apps.catalog"
    label = "catalog"
    verbose_name = "Game content catalog"

    def ready(self):
        # Registers the catalog's authorable kinds (ADR-047).
        from . import authoring  # noqa: F401
