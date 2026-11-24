from django.apps import AppConfig


class AvatarsConfig(AppConfig):
    name = "apps.avatars"
    label = "avatars"
    verbose_name = "Player avatars"

    def ready(self):
        # LAI-JMP-01c: the asset library refuses to retire a model an available player avatar is
        # served with. Since LAI-07 W2-4b this is a usage provider on the asset library's
        # registry (`apps.assets.dependencies`) instead of a separate retirement guard; it refuses
        # with the same code and wording. Registered here so `apps.assets` never imports this app.
        from .dependencies import register_usage_provider

        register_usage_provider()
