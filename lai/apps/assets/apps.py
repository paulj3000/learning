from django.apps import AppConfig


class AssetsConfig(AppConfig):
    name = "apps.assets"
    label = "assets"
    verbose_name = "Asset library"

    def ready(self):
        from apps.jobs.hooks import register_completion_hook

        from . import signals  # noqa: F401  (delete guards)
        from .completion import apply_model_validation
        from .processing import MODEL_VALIDATION_JOB_TYPE, SUBJECT_TYPE

        # WAVE3_INTERFACES section 3: explicit, and a second ready() is a no-op (same callable).
        register_completion_hook(MODEL_VALIDATION_JOB_TYPE, SUBJECT_TYPE, apply_model_validation)
