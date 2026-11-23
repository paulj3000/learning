"""Expire and delete derived artifacts per the retention policy (ADR-066); reconcile orphans.

    python manage.py asset_artifact_retention            # dry run: report only
    python manage.py asset_artifact_retention --apply    # expire, delete objects, delete orphans

90 days for artifacts nobody reviewed, 30 days after supersession or rejection
(LAI_ARTIFACT_RETENTION_UNREVIEWED_DAYS, LAI_ARTIFACT_RETENTION_SUPERSEDED_DAYS). Promoted,
accepted, held and active-job artifacts are never touched. Orphan objects (no row) older than
LAI_ARTIFACT_ORPHAN_GRACE_HOURS are removed. Runs on the Django role; worker roles cannot delete.
"""

from django.core.management.base import BaseCommand

from apps.assets.artifact_retention import run_retention


class Command(BaseCommand):
    help = "Report (default) or apply derived artifact retention and orphan cleanup."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true", help="Make the changes (the default is a dry run)."
        )

    def handle(self, *args, apply, **options):
        report = run_retention(apply=apply)
        self.stdout.write("APPLY" if apply else "DRY RUN (nothing changed)")
        for name, value in report.items():
            if name == "apply":
                continue
            if isinstance(value, list):
                self.stdout.write(f"{name}: {len(value)}")
                for item in value:
                    self.stdout.write(f"  {item}")
            else:
                self.stdout.write(f"{name}: {value}")
