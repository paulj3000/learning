from django.apps import AppConfig


class NpcsConfig(AppConfig):
    name = "apps.npcs"
    label = "npcs"
    verbose_name = "NPC Manager"

    def ready(self):
        # LAI-NPC-036: the asset library refuses to retire an asset or version a live NPC release
        # uses. Since LAI-07 W2-4b this is a usage provider on the asset library's registry
        # (`apps.assets.dependencies`) instead of a separate retirement guard; it refuses with the
        # same code and wording. Registered here so `apps.assets` never imports the NPC Manager.
        from .dependencies import register_usage_provider

        register_usage_provider()
