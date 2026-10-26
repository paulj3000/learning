"""Import existing models as validated (unpublished) asset versions (LAI-2200 AM-8).

    python manage.py import_assets --from-bundled [--root react/public] [--dry-run]
    python manage.py import_assets --from-amplify export.json --files ./downloads [--dry-run]

Idempotent: files already imported (same SHA-256) are skipped. Nothing is published, deleted or
re-pointed. `--json` prints the full report. See apps/assets/importer.py.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.assets.importer import import_amplify, import_bundled


class Command(BaseCommand):
    help = "Import bundled or Amplify models into the asset manager as validated versions."

    def add_arguments(self, parser):
        source = parser.add_mutually_exclusive_group(required=True)
        source.add_argument("--from-bundled", action="store_true")
        source.add_argument("--from-amplify", metavar="EXPORT_JSON")
        parser.add_argument("--root", help="Bundled files root (default: react/public).")
        parser.add_argument("--files", help="Directory with the downloaded Amplify files.")
        parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")
        parser.add_argument(
            "--json", action="store_true", dest="as_json", help="Print the full JSON report."
        )

    def handle(self, *args, from_bundled, from_amplify, root, files, dry_run, as_json, **options):
        if from_bundled:
            report = import_bundled(root=Path(root) if root else None, dry_run=dry_run)
        else:
            if not files:
                raise CommandError("--from-amplify needs --files <directory>.")
            report = import_amplify(Path(from_amplify), Path(files), dry_run=dry_run)
        data = report.as_dict()
        if as_json:
            self.stdout.write(_dumps(data))
            return
        prefix = "Dry run: would import" if dry_run else "Imported"
        self.stdout.write(f"{prefix} {len(report.imported)} file(s).")
        self.stdout.write(f"Already imported (skipped): {len(report.skipped)}.")
        self.stdout.write(f"New definitions: {len(report.created_definitions)}.")
        self.stdout.write(f"Unresolved: {len(report.unresolved)}.")
        for item in report.unresolved:
            self.stdout.write(f"  {_dumps(item)}")


def _dumps(value) -> str:
    return json.dumps(value, sort_keys=True)
