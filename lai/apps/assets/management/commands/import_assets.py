"""Import existing models as unpublished asset versions (LAI-2200 AM-8).

    python manage.py import_assets --from-bundled [--ids a,b] [--root react/public] [--dry-run]
    python manage.py import_assets --from-amplify export.json --files ./downloads [--dry-run]

Idempotent: files already imported (same SHA-256) are skipped. Nothing is published, deleted or
re-pointed. Versions are `VALIDATED`; with `LAI_ASSET_ASYNC_VALIDATION=on` an imported GLB is a
`DRAFT` until its background validation finishes, and each imported file is listed with its
status. `--ids` limits a bundled import to those asset ids (for example the Treasure Cove
models: `--ids npc-pip,treasure-chest,ground-tile`). `--json` prints the full report. See
apps/assets/importer.py and docs/ASSET_LIBRARY.md section 11.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.assets.importer import import_amplify, import_bundled


class Command(BaseCommand):
    help = "Import bundled or Amplify models into the asset library as unpublished versions."

    def add_arguments(self, parser):
        source = parser.add_mutually_exclusive_group(required=True)
        source.add_argument("--from-bundled", action="store_true")
        source.add_argument("--from-amplify", metavar="EXPORT_JSON")
        parser.add_argument("--root", help="Bundled files root (default: react/public).")
        parser.add_argument(
            "--ids", help="Comma-separated asset ids: import only these (with --from-bundled)."
        )
        parser.add_argument("--files", help="Directory with the downloaded Amplify files.")
        parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")
        parser.add_argument(
            "--json", action="store_true", dest="as_json", help="Print the full JSON report."
        )

    def handle(
        self, *args, from_bundled, from_amplify, root, files, ids, dry_run, as_json, **options
    ):
        selected = None
        if ids is not None:
            if not from_bundled:
                raise CommandError("--ids works with --from-bundled only.")
            selected = list(dict.fromkeys(part.strip() for part in ids.split(",") if part.strip()))
            if not selected:
                raise CommandError("--ids needs at least one asset id.")
        if from_bundled:
            report = import_bundled(
                root=Path(root) if root else None, dry_run=dry_run, ids=selected
            )
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
        for item in report.imported:
            if not dry_run:
                self.stdout.write(f"  {_imported_line(item)}")
        self.stdout.write(f"Already imported (skipped): {len(report.skipped)}.")
        self.stdout.write(f"New definitions: {len(report.created_definitions)}.")
        self.stdout.write(f"Unresolved: {len(report.unresolved)}.")
        for item in report.unresolved:
            self.stdout.write(f"  {_dumps(item)}")


def _imported_line(item: dict) -> str:
    """One imported file and its version status, for example
    `npc-pip version 2: Imported (DRAFT, background validation queued)`."""
    status = item.get("status", "")
    if item.get("background_validation") == "queued":
        state = f"Imported ({status}, background validation queued)"
    else:
        state = f"Imported ({status})"
    where = item.get("path") or item.get("slug") or ""
    return f"{item.get('asset')} version {item.get('version')}: {state} from {where}"


def _dumps(value) -> str:
    return json.dumps(value, sort_keys=True)
