from django.core.management.base import BaseCommand, CommandError

from apps.regions.north_pole_seed import SeedPrerequisiteMissing, seed_north_pole


class Command(BaseCommand):
    help = (
        "Create the North Pole 3D Area rows (DRAFT) that do not exist yet. Idempotent; never "
        "overwrites an administrator's edits. Run load_content first."
    )

    def handle(self, *args, **options):
        try:
            created = seed_north_pole()
        except SeedPrerequisiteMissing as error:
            raise CommandError(str(error)) from error
        for line in created:
            self.stdout.write(f"created {line}")
        self.stdout.write(f"{len(created)} row(s) created")
