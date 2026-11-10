"""Copy child photos from the legacy Amplify Storage bucket into the Django photo bucket (AMP-04).

    manage.py migrate_amplify_child_photos --bucket B --region R --inventory --manifest m.json
    manage.py migrate_amplify_child_photos --bucket B --region R --export e.json --manifest m.json
    manage.py migrate_amplify_child_photos --bucket B --region R --export e.json \\
        --manifest m.json --confirm-copy
    manage.py migrate_amplify_child_photos --rollback m.json [--confirm-rollback]

`--inventory` only reads: every object under `child-photos/` with its size, ETag, version and
SHA-256, plus the noncurrent-version count (and, with `--export`, which child each maps to).
Without `--confirm-copy` a run with `--export` is a dry run: it reads the bucket and the
database, validates every photo through the Django pipeline, and writes nothing but the
manifest. `--confirm-copy` stores each mapped photo through that pipeline and verifies it.
Re-running is safe: a photo already in Django with the same checksum is not copied again.

Never deletes or changes a source object. Rules: apps/users/amplify_photo_migration.py. Runbook:
docs/platform/AMPLIFY_STORAGE_CUTOVER.md. Output here is counts only; the manifest holds ids and
is written owner-only.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.core.legacy_bucket import LegacyBucket, LegacyBucketError, read_manifest, write_manifest
from apps.users import amplify_photo_migration as migration
from apps.users.amplify_import import ImportFileError


class Command(BaseCommand):
    help = "Inventory, dry-run, copy (--confirm-copy) or roll back legacy Amplify child photos."

    def add_arguments(self, parser):
        parser.add_argument("--bucket", help="The Amplify Storage bucket (read only).")
        parser.add_argument("--region", help="Its AWS region.")
        parser.add_argument("--export", type=Path, help="The Amplify profile export (JSON).")
        parser.add_argument("--manifest", type=Path, help="Where to write the JSON manifest.")
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument("--inventory", action="store_true", help="List and checksum only.")
        mode.add_argument("--confirm-copy", action="store_true", help="Copy into Django.")
        mode.add_argument("--rollback", type=Path, help="A copy manifest to undo.")
        parser.add_argument(
            "--confirm-rollback", action="store_true", help="With --rollback: really remove."
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
        export = None
        if options["export"]:
            try:
                export = json.loads(options["export"].read_text(encoding="utf-8"))
            except (OSError, ValueError) as error:
                raise CommandError(f"Cannot read the export: {type(error).__name__}") from None
        try:
            bucket = LegacyBucket(
                options["bucket"], options["region"], prefix=migration.LEGACY_PREFIX
            )
            result = migration.run(bucket, mode=mode, export=export)
        except (ImportFileError, LegacyBucketError) as error:
            raise CommandError(str(error)) from None
        write_manifest(options["manifest"], result.manifest())
        label = {
            migration.INVENTORY: "Inventory (read only)",
            migration.DRY_RUN: "Dry run (nothing copied)",
            migration.COPY: "Copy",
        }[mode]
        self.stdout.write(f"{label}: {json.dumps(result.summary(), sort_keys=True)}")
        self.stdout.write(f"Source versions: {json.dumps(result.versions, sort_keys=True)}")
        if export is not None:
            self.stdout.write(f"Reconciled: {'yes' if result.reconciled() else 'no'}")
        self.stdout.write("Manifest written (holds child ids: keep it private).")

    def _rollback(self, path: Path, confirm: bool):
        try:
            report = migration.rollback(read_manifest(path), confirm=confirm)
        except (ImportFileError, LegacyBucketError) as error:
            raise CommandError(str(error)) from None
        label = "Rollback" if confirm else "Rollback dry run (nothing removed)"
        self.stdout.write(f"{label}: {json.dumps(report.summary(), sort_keys=True)}")
