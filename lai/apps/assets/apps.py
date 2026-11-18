from django.apps import AppConfig


class AssetsConfig(AppConfig):
    name = "apps.assets"
    label = "assets"
    verbose_name = "Asset library"

    def ready(self):
        from . import optimize, signals  # noqa: F401  (delete guards)

        optimize.register()  # the optimizer's processor version for artifact results (ADR-070)
