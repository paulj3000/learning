from django.core.management.base import BaseCommand, CommandError

from apps.regions.firepeak_heart_seed import SeedPrerequisiteMissing, seed_firepeak_heart


class Command(BaseCommand):
    help = (
        "Create the Heart of Firepeak 3D Area rows (DRAFT) that do not exist yet. Idempotent. "
        "Run load_content first."
    )

    def handle(self, *args, **options):
        try:
            created = seed_firepeak_heart()
        except SeedPrerequisiteMissing as error:
            raise CommandError(str(error)) from error
        for line in created:
            self.stdout.write(f"created {line}")
        self.stdout.write(f"{len(created)} row(s) created")
