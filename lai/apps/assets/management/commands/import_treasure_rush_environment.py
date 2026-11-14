"""Import the Treasure Rush environment packs into the asset library (TR-ENV-03).

    python manage.py import_treasure_rush_environment --source /path/to/environment-assets --dry-run
    python manage.py import_treasure_rush_environment --source /path/to/environment-assets
    python manage.py import_treasure_rush_environment --source DIR --category barrels --publish
    python manage.py import_treasure_rush_environment --source DIR --publish --licence-confirmed

`--source` is a downloaded GLB, a ZIP, or a directory holding them (palms, barrels, logs, mixed);
it is read, never written, and should live outside the repository. Each declared model is found
by its node name, prepared (one model per file, Y-up, grounded, sized, smaller textures),
validated, and stored through the configured asset storage as a VALIDATED version. `--category`
limits the run to `palms`, `barrels` or `logs`.

Publishing (`--publish`) is refused outside local development, and skips any pack whose licence
the owner has not confirmed unless `--licence-confirmed` records that they now have. With S3
storage nothing is uploaded without `--allow-shared-storage`, and nothing is published (publish
in Django Admin). Re-running is safe: imported models are skipped. The assets are ordinary
library assets for any region. See apps/assets/model_packs.py and docs/ASSET_LIBRARY.md s. 22.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.assets.model_packs import GROUPS, PackRefused, check_environment, import_pack, packs_for


class Command(BaseCommand):
    help = "Prepare, validate and store the Treasure Rush environment models (palms, barrels, logs)."
    #: A subclass fixes the category (the palm command).
    fixed_category: str | None = None

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True, help="A .glb, a .zip, or a directory.")
        if self.fixed_category is None:
            parser.add_argument("--category", choices=GROUPS, help="Import only this group.")
        parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")
        parser.add_argument(
            "--publish",
            action="store_true",
            help="Publish the validated versions (local development only).",
        )
        parser.add_argument(
            "--licence-confirmed",
            action="store_true",
            help="The owner has confirmed the licence of every pack in this run; publish them too.",
        )
        parser.add_argument(
            "--allow-shared-storage",
            action="store_true",
            help="Permit uploading when asset storage is S3 (an approved shared environment).",
        )
        parser.add_argument(
            "--json", action="store_true", dest="as_json", help="Print the full JSON report."
        )

    def handle(self, *args, source, dry_run, publish, allow_shared_storage, as_json, **options):
        if dry_run and publish:
            raise CommandError("--dry-run and --publish cannot be combined.")
        category = self.fixed_category or options.get("category")
        try:
            packs = packs_for(category)
            check_environment(
                dry_run=dry_run, publish=publish, allow_shared_storage=allow_shared_storage
            )
            path = Path(source).expanduser()
            reports = []
            for pack in packs:
                try:
                    reports.append(
                        import_pack(
                            pack,
                            path,
                            dry_run=dry_run,
                            publish=publish,
                            allow_shared_storage=allow_shared_storage,
                            licence_confirmed=options.get("licence_confirmed", False),
                        )
                    )
                except PackRefused as refused:
                    if category is not None:
                        raise
                    # Importing everything from a folder that holds only some packs is normal.
                    self.stdout.write(f"{pack.title}: skipped ({refused}).")
        except PackRefused as refused:
            raise CommandError(str(refused)) from None
        if as_json:
            self.stdout.write(
                json.dumps([report.as_dict() for report in reports], sort_keys=True, indent=1)
            )
            return
        for report in reports:
            self._summary(report, dry_run=dry_run, publish=publish)

    def _summary(self, report, *, dry_run, publish):
        self.stdout.write(f"== {report.pack} (storage: {report.storage})")
        for src in report.sources:
            self.stdout.write(
                f"Source {src['file']}: {src['sizeBytes']:,} bytes, sha256 {src['sha256']}"
                + ("" if src["matchesKnownDownload"] else " (differs from the recorded download)")
            )
        for item in report.discovered:
            if item["selected"]:
                d = item["dimensions"]
                self.stdout.write(
                    f"  {item['node']} -> {item['asset']}: {item['triangles']} triangles, "
                    f"{d['x']} x {d['y']} x {d['z']} m, {item['sizeBytes']:,} bytes "
                    f"(source {item['sourceSizeBytes']:,})"
                )
            else:
                self.stdout.write(f"  {item['node']}: not imported ({item['reason']})")
        prefix = "Dry run: would import" if dry_run else "Imported"
        self.stdout.write(f"{prefix} {len(report.imported)} model(s).")
        for item in report.imported:
            version = f"v{item['version']}" if item.get("version") else "(new version)"
            self.stdout.write(f"  {item['asset']} {version}")
        self.stdout.write(f"Already imported (skipped): {len(report.skipped)}.")
        for item in report.skipped:
            self.stdout.write(f"  {item['asset']} v{item['version']} ({item['status']})")
        self.stdout.write(f"New definitions: {', '.join(report.created_definitions) or 'none'}.")
        if publish:
            self.stdout.write(f"Published: {len(report.published)}.")
            for item in report.unpublished:
                self.stdout.write(
                    f"  not published: {item['asset']} v{item['version']} ({item['reason']}; "
                    "rerun with --licence-confirmed once the owner confirms the licence)"
                )
        self.stdout.write(f"Unresolved: {len(report.unresolved)}.")
        for item in report.unresolved:
            self.stdout.write(f"  {json.dumps(item, sort_keys=True)}")
        for item in report.ignored_files:
            self.stdout.write(f"  ignored {item['file']}: {item['reason']}")
