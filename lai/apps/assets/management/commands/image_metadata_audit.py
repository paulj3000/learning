"""Report stored image versions that carry embedded metadata (read only; staff operation).

    python manage.py image_metadata_audit                       # every stored image version
    python manage.py image_metadata_audit --status PUBLISHED    # only what players can receive
    python manage.py image_metadata_audit --json                # machine readable
    python manage.py image_metadata_audit --only-sensitive      # hide clean versions

Scans PNG, JPEG and WebP asset versions for GPS location, device, owner, comment, embedded
thumbnail, XMP, IPTC and text metadata (presence only, never a value). Changes nothing: it writes
no row and no object, and it does not sanitize. Published images are delivered unchanged, so a
reported published version should be replaced with a sanitized one (docs/ASSET_LIBRARY.md,
"Image privacy"). Exit status 0 always; a report is not a failure.
"""

from collections import Counter

from django.core.management.base import BaseCommand, CommandError

from apps.assets.image_audit import CATEGORIES, audit_image_metadata
from apps.assets.models import VersionStatus


class Command(BaseCommand):
    help = "Report image asset versions with embedded location, device, owner or comment metadata."

    def add_arguments(self, parser):
        parser.add_argument(
            "--status",
            action="append",
            choices=VersionStatus.values,
            help="Limit to a version status (repeatable). Default: every status.",
        )
        parser.add_argument("--only-sensitive", action="store_true", help="List flagged only.")
        parser.add_argument("--json", action="store_true", help="Print one JSON document.")

    def handle(self, *args, status=None, only_sensitive=False, json=False, **options):
        try:
            rows = list(audit_image_metadata(statuses=status))
        except Exception as error:  # noqa: BLE001 - one safe line, no paths or values
            raise CommandError(f"image metadata audit failed ({type(error).__name__}).") from None
        counts = Counter(c for row in rows for c in row["categories"])
        summary = {
            "scanned": sum(1 for r in rows if r["state"] == "scanned"),
            "missing": sum(1 for r in rows if r["state"] == "missing"),
            "unreadable": sum(1 for r in rows if r["state"] == "unreadable"),
            "sensitive": sum(1 for r in rows if r["sensitive"]),
            "incomplete": sum(1 for r in rows if r["incomplete"]),
            "by_category": {name: counts.get(name, 0) for name in CATEGORIES},
        }
        listed = [r for r in rows if r["sensitive"]] if only_sensitive else rows
        if json:
            import json as encoder

            self.stdout.write(encoder.dumps({"summary": summary, "versions": listed}, indent=2))
            return
        self.stdout.write(
            f"scanned: {summary['scanned']}  sensitive: {summary['sensitive']}  "
            f"incomplete: {summary['incomplete']}  missing: {summary['missing']}  "
            f"unreadable: {summary['unreadable']}"
        )
        for name, number in summary["by_category"].items():
            self.stdout.write(f"  {name}: {number}")
        for row in listed:
            flags = ",".join(row["categories"]) or "-"
            note = " (structure not fully read)" if row["incomplete"] else ""
            self.stdout.write(
                f"{row['asset_id']} v{row['version']} {row['status']} {row['format']} "
                f"{row['state']}: {flags}{note}"
            )
