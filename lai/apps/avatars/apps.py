from django.apps import AppConfig


class AvatarsConfig(AppConfig):
    name = "apps.avatars"
    label = "avatars"
    verbose_name = "Player avatars"

    def ready(self):
        # LAI-JMP-01c: the asset library refuses to retire a model an available player avatar is
        # served with. Registered here so `apps.assets` never imports this app.
        from apps.assets.services import register_retirement_guard

        from .dependencies import retirement_guard

        register_retirement_guard(retirement_guard)
