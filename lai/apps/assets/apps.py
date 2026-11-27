from django.apps import AppConfig


class AssetsConfig(AppConfig):
    name = "apps.assets"
    label = "assets"
    verbose_name = "Asset library"

    def ready(self):
        from . import artifact_usage, optimize, signals  # noqa: F401  (delete guards)
        from .dependencies import retirement_guard
        from .services import register_retirement_guard

        optimize.register()  # the optimizer's processor version for artifact results (ADR-070)
        # One guard asks every registered usage provider (LAI-07 W2, ASSET_LIBRARY.md s. 25).
        register_retirement_guard(retirement_guard)
        artifact_usage.register()  # derived artifacts, informational only (W2-5)
        # LAI-ENV-02: materials are ADR-047 authorable content; textures they use are tracked.
        from . import material_usage, materials

        materials.register_kind()
        material_usage.register()
