from django.apps import AppConfig


class RegionsConfig(AppConfig):
    name = "apps.regions"
    label = "regions"
    verbose_name = "Seed-authored play regions (spatial; LAI-0805 pending)"

    def ready(self):
        from .authoring_kinds import register_kinds

        register_kinds()
