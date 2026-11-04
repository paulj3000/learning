"""Delete expired approved utterances and generated clips (SM-P8-05).

    python manage.py speech_cleanup [--dry-run]

Run it on a schedule (hourly is plenty). It removes only what has expired; authored clips (no
expiry) stay until a line or voice changes. Counts only; never prints text.
"""

from django.core.management.base import BaseCommand

from apps.speech import services


class Command(BaseCommand):
    help = "Remove expired speech utterances and clips."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        removed = services.cleanup(dry_run=options["dry_run"])
        verb = "Would remove" if options["dry_run"] else "Removed"
        self.stdout.write(
            f"{verb} {removed['utterances']} utterance(s) and {removed['clips']} clip(s). "
            f"{removed['objects_failed']} object delete(s) failed and will be retried."
        )
