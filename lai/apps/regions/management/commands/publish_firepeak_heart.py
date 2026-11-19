from django.core.management.base import BaseCommand, CommandError

from apps.regions.firepeak_heart_publish import publish_firepeak_heart
from apps.regions.treasure_rush_publish import PublishRefused


class Command(BaseCommand):
    help = (
        "Validate and publish the seeded Heart of Firepeak content. Local development only: "
        "refused unless DEBUG is on and the database is on loopback."
    )

    def handle(self, *args, **options):
        try:
            changed = publish_firepeak_heart()
        except PublishRefused as refused:
            for problem in refused.problems:
                self.stderr.write(f"- {problem}")
            raise CommandError("The Heart of Firepeak was not published.") from refused
        for label in changed:
            self.stdout.write(f"published {label}")
        self.stdout.write(f"{len(changed)} row(s) published" if changed else "already published")
