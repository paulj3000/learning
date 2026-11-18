from django.core.management.base import BaseCommand, CommandError

from apps.regions.north_pole_publish import publish_north_pole
from apps.regions.treasure_rush_publish import PublishRefused


class Command(BaseCommand):
    help = "Publish the seeded North Pole content. Local development only (DEBUG, loopback DB)."

    def handle(self, *args, **options):
        try:
            changed = publish_north_pole()
        except PublishRefused as error:
            raise CommandError("; ".join(error.problems)) from error
        for line in changed:
            self.stdout.write(f"published {line}")
        self.stdout.write(f"{len(changed)} row(s) published")
