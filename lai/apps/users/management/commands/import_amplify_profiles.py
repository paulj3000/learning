"""Import exported Amplify parent and child profiles into Django (LAI-CHILD-001).

    python manage.py import_amplify_profiles <export.json> [--report report.json]
    python manage.py import_amplify_profiles <export.json> --apply [--provision-parents]

A dry run (the default) reads the database and the file and writes nothing. --apply re-plans and
writes the planned creations in one transaction; running it again creates nothing new. Never
calls AWS. Rules and the export format: apps/users/amplify_import.py and
docs/platform/AMPLIFY_PROFILE_IMPORT.md. Running it against production data is a Phase 11/12
task that needs approval.
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.users import amplify_import


class Command(BaseCommand):
    help = "Plan (default) or apply an import of exported Amplify profiles."

    def add_arguments(self, parser):
        parser.add_argument("export", type=Path, help="JSON export of ParentProfile/ChildProfile.")
        parser.add_argument("--apply", action="store_true", help="Write the planned creations.")
        parser.add_argument(
            "--provision-parents",
            action="store_true",
            help="Create the ParentAccount for an owner sub that has none yet.",
        )
        parser.add_argument("--report", type=Path, help="Also write the JSON report here.")

    def handle(self, *args, export, apply, provision_parents, report, **options):
        try:
            data = json.loads(export.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise CommandError(f"Cannot read the export: {error.__class__.__name__}") from None
        try:
            plan = amplify_import.plan_import(data, provision_parents=provision_parents)
        except amplify_import.ImportFileError as error:
            raise CommandError(str(error)) from None
        if apply:
            amplify_import.apply_plan(plan)
        body = plan.report(applied=apply)
        if report:
            report.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
        mode = "Applied" if apply else "Dry run (nothing written)"
        self.stdout.write(f"{mode}: {json.dumps(body['summary'], sort_keys=True)}")
        self.stdout.write(f"Photos left in Amplify Storage: {body['photosLeftInAmplifyStorage']}")
