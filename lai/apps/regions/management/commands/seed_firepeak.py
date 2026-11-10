from django.core.management.base import BaseCommand, CommandError

from apps.regions.firepeak_seed import SeedPrerequisiteMissing, seed_firepeak


class Command(BaseCommand):
    help = "Create the Firepeak Volcano 3D Area rows (DRAFT) that do not exist yet. Idempotent."

    def handle(self, *args, **options):
        try:
            created = seed_firepeak()
        except SeedPrerequisiteMissing as error:
            raise CommandError(str(error)) from error
        for line in created:
            self.stdout.write(f"created {line}")
        self.stdout.write(f"{len(created)} row(s) created")
