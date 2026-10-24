from django.core.management.base import BaseCommand, CommandError

from apps.core.content_loader import load_content
from apps.core.content_schema import ContentSchemaError


class Command(BaseCommand):
    help = "Load content/exported/*.json into the catalog tables. Idempotent."

    def handle(self, *args, **options):
        try:
            report = load_content()
        except ContentSchemaError as error:
            for line in error.errors[:20]:
                self.stderr.write(f"{error.file_name} {line}")
            raise CommandError(str(error)) from error
        for label in sorted(set(report.created) | set(report.updated)):
            self.stdout.write(
                f"{label}: {report.created.get(label, 0)} created, "
                f"{report.updated.get(label, 0)} updated"
            )
