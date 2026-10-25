from django.core.management.base import BaseCommand, CommandError

from apps.islands.treasure_rush_publish import PublishRefused, publish_treasure_rush


class Command(BaseCommand):
    help = (
        "Validate and publish the seeded Treasure Rush content. Local development only: "
        "refused unless DEBUG is on and the database is on loopback."
    )

    def handle(self, *args, **options):
        try:
            changed = publish_treasure_rush()
        except PublishRefused as refused:
            for problem in refused.problems:
                self.stderr.write(f"- {problem}")
            raise CommandError("Treasure Rush was not published.") from refused
        for label in changed:
            self.stdout.write(f"published {label}")
        self.stdout.write(f"{len(changed)} row(s) published" if changed else "already published")
