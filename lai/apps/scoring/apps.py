from django.apps import AppConfig


class ScoringConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.scoring"
    verbose_name = "Scoring and progression"

    def ready(self) -> None:
        from . import signals

        signals.connect()
