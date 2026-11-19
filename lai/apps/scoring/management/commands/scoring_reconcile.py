"""Backfill and repair (GE-109): derive awards from existing child records.

Idempotent: running it again records nothing new. Writes only scoring tables; existing child
progress (inventory, quests, world, mastery) is read, never changed. Does nothing while scoring
is off or no policy may award (see `policies.awarding_policy`). In a deployed environment a
production backfill is an owner approval (docs/scoring/MIGRATION_PLAN.md).
"""

from django.core.management.base import BaseCommand, CommandError

from apps.scoring import policies, reconcile
from apps.users.models import ChildProfile


class Command(BaseCommand):
    help = "Reconcile scoring awards from existing child records (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument("--child", help="One child profile id. Default: every child.")
        parser.add_argument("--dry-run", action="store_true", help="Count, write nothing.")

    def handle(self, *args, child, dry_run, **options):
        policy = policies.awarding_policy()
        if policy is None:
            raise CommandError("Scoring is off, or no active policy may award. Nothing to do.")
        children = ChildProfile.objects.order_by("pk")
        if child:
            children = children.filter(pk=child)
        total_children = total_new = 0
        for profile in children.iterator():
            total_children += 1
            if dry_run:
                _, planned = reconcile.plan(profile, policy)
                total_new += len(planned)
                continue
            total_new += len(reconcile.reconcile_child(profile).new_entries)
        verb = "would consider" if dry_run else "recorded"
        # Counts only: never a child id or name (CLAUDE.md section 13).
        self.stdout.write(f"{total_children} children; {verb} {total_new} award(s) under {policy}.")
