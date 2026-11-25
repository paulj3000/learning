from django.apps import AppConfig


class CatalogConfig(AppConfig):
    name = "apps.catalog"
    label = "catalog"
    verbose_name = "Game content catalog"

    def ready(self):
        from apps.assets.dependencies import CheckClass, register_usage_provider

        # Registers the catalog's authorable kinds (ADR-047).
        from . import authoring  # noqa: F401
        from .dependencies import SOURCE, catalog_usages

        # Shipped scenes that draw an asset: listed in Asset Library usage, never blocking (GE-247).
        # Informational (Agent 4, 2026-11-25): it never blocks, so a failed check cannot conceal an
        # active dependency; the failure is logged and staff are warned (ASSET_LIBRARY.md 25.9).
        register_usage_provider(SOURCE, catalog_usages, check_class=CheckClass.INFORMATIONAL)
