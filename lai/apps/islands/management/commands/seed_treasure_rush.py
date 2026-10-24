from django.core.management.base import BaseCommand, CommandError

from apps.islands.treasure_rush_seed import SeedPrerequisiteMissing, seed_treasure_rush


class Command(BaseCommand):
    help = "Create the starter Treasure Rush rows (DRAFT) that do not exist yet. Idempotent."

    def handle(self, *args, **options):
        try:
            created = seed_treasure_rush()
        except SeedPrerequisiteMissing as error:
            raise CommandError(str(error)) from error
        for line in created:
            self.stdout.write(f"created {line}")
        self.stdout.write(f"{len(created)} row(s) created")
