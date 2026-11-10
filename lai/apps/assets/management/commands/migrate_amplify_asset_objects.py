"""Import the legacy Amplify asset-library objects into the Django asset library (AMP-04).

    manage.py migrate_amplify_asset_objects --bucket B --region R --inventory --manifest m.json
    manage.py migrate_amplify_asset_objects --bucket B --region R --export a.json --manifest m.json
    manage.py migrate_amplify_asset_objects --bucket B --region R --export a.json \\
        --manifest m.json --confirm-copy
    manage.py migrate_amplify_asset_objects --rollback m.json [--confirm-rollback]

`--inventory` only reads: every object under `assets/` with size, ETag, version and SHA-256, and
which Django version (if any) already holds those bytes. With `--export` (the Amplify `Asset`
records, the same file `import_assets --from-amplify` takes) and no `--confirm-copy`, a run is a
dry run of the importer. `--confirm-copy` imports as `VALIDATED` versions (never published) and
verifies each one. Re-runs skip files already imported. Never deletes or changes a source object.
Rules: apps/assets/amplify_object_migration.py. Runbook: docs/platform/AMPLIFY_STORAGE_CUTOVER.md.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.assets import amplify_object_migration as migration
from apps.core.legacy_bucket import LegacyBucket, LegacyBucketError, read_manifest, write_manifest


class Command(BaseCommand):
    help = "Inventory, dry-run, import (--confirm-copy) or roll back legacy Amplify asset objects."

    def add_arguments(self, parser):
        parser.add_argument("--bucket", help="The Amplify Storage bucket (read only).")
        parser.add_argument("--region", help="Its AWS region.")
        parser.add_argument("--export", type=Path, help="The Amplify Asset records export (JSON).")
        parser.add_argument("--manifest", type=Path, help="Where to write the JSON manifest.")
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--inventory", action="store_true", help="List and checksum only.")
        mode.add_argument("--confirm-copy", action="store_true", help="Import into Django.")
        mode.add_argument("--rollback", type=Path, help="A copy manifest to undo.")
        parser.add_argument(
            "--confirm-rollback", action="store_true", help="With --rollback: really delete."
        )

    def handle(self, *args, **options):
        if options["rollback"]:
            return self._rollback(options["rollback"], options["confirm_rollback"])
        if options["confirm_rollback"]:
            raise CommandError("--confirm-rollback works with --rollback only.")
        if not options["bucket"] or not options["region"] or not options["manifest"]:
            raise CommandError("--bucket, --region and --manifest are required.")
        mode = (
            migration.INVENTORY
            if options["inventory"]
            else migration.COPY
            if options["confirm_copy"]
            else migration.DRY_RUN
        )
        try:
            bucket = LegacyBucket(
                options["bucket"], options["region"], prefix=migration.LEGACY_PREFIX
            )
            result = migration.run(bucket, mode=mode, export_file=options["export"])
        except (migration.ManifestError, LegacyBucketError) as error:
            raise CommandError(str(error)) from None
        write_manifest(options["manifest"], result.manifest())
        label = {
            migration.INVENTORY: "Inventory (read only)",
            migration.DRY_RUN: "Dry run (nothing imported)",
            migration.COPY: "Import",
        }[mode]
        self.stdout.write(f"{label}: {json.dumps(result.summary(), sort_keys=True)}")
        self.stdout.write(f"Source versions: {json.dumps(result.versions, sort_keys=True)}")
        self.stdout.write(f"Reconciled: {'yes' if result.reconciled() else 'no'}")
        self.stdout.write("Manifest written.")

    def _rollback(self, path: Path, confirm: bool):
        try:
            report = migration.rollback(read_manifest(path), confirm=confirm)
        except (migration.ManifestError, LegacyBucketError) as error:
            raise CommandError(str(error)) from None
        label = "Rollback" if confirm else "Rollback dry run (nothing deleted)"
        self.stdout.write(f"{label}: {json.dumps(report.summary(), sort_keys=True)}")
        if report.definitions_to_review:
            self.stdout.write(
                "Definitions created by the run (review in Django Admin): "
                + ", ".join(report.definitions_to_review)
            )
