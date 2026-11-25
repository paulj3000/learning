from django.apps import AppConfig


class RegionsConfig(AppConfig):
    name = "apps.regions"
    label = "regions"
    verbose_name = "Seed-authored play regions (spatial; LAI-0805 pending)"

    def ready(self):
        from .authoring_kinds import register_kinds

        register_kinds()
        from . import dependencies

        # Published 3D Area placements block retiring their asset (LAI-07 W2-3).
        dependencies.register()
