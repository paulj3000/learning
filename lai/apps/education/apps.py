from django.apps import AppConfig


class EducationConfig(AppConfig):
    name = "apps.education"
    label = "education"
    verbose_name = "Skill evidence, progress and story artifacts"

    def ready(self):
        from .authoring_kinds import register_kinds

        register_kinds()
