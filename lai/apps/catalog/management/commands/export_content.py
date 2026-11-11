"""`manage.py export_content`: write published content in the export format (LAI-0814).

    python manage.py export_content --out DIR [--include-drafts] [--skip-check]

Reads each record's published version, so the files are exactly what children can see. Runs
`check_content` first and refuses to write if it finds an error. Deterministic: the same
published content gives the same bytes and digest. Promote the result with
`load_content --path DIR --dry-run`, then without `--dry-run`.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.catalog import export


class Command(BaseCommand):
    help = "Write published content to DIR in the export format, after checking it."

    def add_arguments(self, parser):
        parser.add_argument("--out", type=Path, required=True, help="Directory to write.")
        parser.add_argument(
            "--include-drafts",
            action="store_true",
            help="Use the newest open draft or submitted version where a record has one "
            "(review environments only; marked in the manifest).",
        )
        parser.add_argument("--skip-check", action="store_true", help="Do not run check_content.")

    def handle(self, *args, out: Path, include_drafts: bool, skip_check: bool, **options):
        if not skip_check:
            report = export.check_content()
            for line in report.errors:
                self.stderr.write(f"error: {line}")
            if not report.ok:
                raise CommandError(f"{len(report.errors)} error(s); nothing was written.")
        plan = export.build_export(include_drafts=include_drafts)
        if plan.problems:
            raise CommandError("; ".join(plan.problems))
        manifest = export.write_export(plan, out)
        self.stdout.write(
            f"Wrote {len(manifest['files'])} files and {len(manifest['records'])} records to {out} "
            f"(digest {manifest['contentDigest'][:12]})."
        )
        if include_drafts:
            drafts = sum(1 for r in manifest["records"] if r["draft"])
            self.stdout.write(
                f"{drafts} record(s) are open drafts; an import never publishes them."
            )
