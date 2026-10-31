"""Report Places with more than one 3D Area (ADR-041 decision B). Read-only.

    python manage.py report_place_areas

Exits with status 1 and lists each affected Place when any exist, so it can run before the
`regions.0002` migration, which refuses to add the one-per-Place constraint in that case. It
never deletes or reassigns anything: resolve each Place by hand
(docs/ISLAND_ADVENTURE_MANAGEMENT.md).
"""

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count

from apps.regions.models import WorldRegion


class Command(BaseCommand):
    help = "List Places that have more than one 3D Area. Changes nothing."

    def handle(self, *args, **options):
        duplicates = (
            WorldRegion.objects.values("location__slug")
            .annotate(areas=Count("id"))
            .filter(areas__gt=1)
            .order_by("location__slug")
        )
        if not duplicates:
            self.stdout.write("Every Place has at most one 3D Area.")
            return
        for row in duplicates:
            ids = WorldRegion.objects.filter(location__slug=row["location__slug"]).values_list(
                "region_id", "status"
            )
            listed = ", ".join(f"{region_id} ({status})" for region_id, status in ids)
            self.stdout.write(f"{row['location__slug']}: {listed}")
        raise CommandError("Some Places have more than one 3D Area. Nothing was changed.")
