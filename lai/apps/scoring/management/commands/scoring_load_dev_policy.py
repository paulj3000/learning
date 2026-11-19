"""Create (and optionally activate) the provisional development fixture policy (GE-102)."""

from django.core.management.base import BaseCommand

from apps.scoring import fixtures, policies


class Command(BaseCommand):
    help = "Create a draft scoring policy from the provisional development fixtures."

    def add_arguments(self, parser):
        parser.add_argument("--key", default=policies.DEFAULT_KEY)
        parser.add_argument("--activate", action="store_true")

    def handle(self, *args, key, activate, **options):
        policy = fixtures.create_dev_policy(key)
        if activate:
            policies.activate(policy)
        self.stdout.write(f"{policy} created{' and activated' if activate else ''}.")
        self.stdout.write("Development fixture values: never eligible for economy approval.")
