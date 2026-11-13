from django.apps import AppConfig


class NpcsConfig(AppConfig):
    name = "apps.npcs"
    label = "npcs"
    verbose_name = "NPC Manager"

    def ready(self):
        # LAI-NPC-036: the asset library refuses to retire an asset or version a live NPC release
        # uses. Registered here so `apps.assets` never imports the NPC Manager.
        from apps.assets.services import register_retirement_guard

        from .dependencies import retirement_guard

        register_retirement_guard(retirement_guard)
