from django.core.management.base import BaseCommand, CommandError

from apps.regions import castle_events


class Command(BaseCommand):
    help = (
        "Import castle_events.json into the Castle Director catalog (ADR-065). Idempotent: new "
        "events are created, an event edited in Django Admin is never changed (a changed seed "
        "becomes a draft for review), and a retired event stays retired."
    )

    def handle(self, *args, **options):
        try:
            counts = castle_events.import_seed()
        except castle_events.SeedInvalid as error:
            raise CommandError(str(error)) from error
        self.stdout.write(", ".join(f"{name} {count}" for name, count in counts.items()))
