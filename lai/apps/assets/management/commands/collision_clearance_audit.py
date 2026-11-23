"""List collision profiles with raised Solid parts and how the engine treats them (GE-L16).

    python manage.py collision_clearance_audit

Read-only. A Solid part whose bottom is above the model's pivot keeps its height and leaves the
space under it open only when the gap is at least the walk-under clearance (1.7 m for the
standard avatar); lower, the engine blocks it at every height, down to the ground. Automatic
profiles taller than 1.2 m are Solid and are included. Heights are model space: a placement's
elevation adds to every gap. Use the list to check published profiles before and after the
GE-L16 rule reaches an environment; nothing is changed.
"""

from django.core.management.base import BaseCommand

from apps.assets.collision import WALK_UNDER_CLEARANCE, clearance_audit
from apps.assets.models import CollisionProfile


class Command(BaseCommand):
    help = "Report collision profiles with raised Solid parts (read-only)."

    def handle(self, *args, **options):
        profiles = CollisionProfile.objects.select_related(
            "asset", "version", "asset__default_version"
        ).order_by("asset__asset_id", "version__number")
        rows = clearance_audit(profiles)
        self.stdout.write(
            f"Raised Solid parts (walk-under clearance {WALK_UNDER_CLEARANCE:g} m, model space): "
            f"{len(rows)} profile(s)"
        )
        for row in rows:
            self.stdout.write(f"{row['asset']} ({row['scope']}, {row['shape']})")
            for part in row["parts"]:
                verdict = "walk-under passage" if part["passage"] else "blocks at every height"
                self.stdout.write(
                    f"  box {part['index'] + 1}: {part['minY']:g} to {part['maxY']:g} m, {verdict}"
                )
