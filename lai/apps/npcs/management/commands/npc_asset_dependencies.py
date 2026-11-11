"""Report which NPC releases and draft rows use an asset (LAI-NPC-036).

    python manage.py npc_asset_dependencies            # every asset the NPC Manager uses
    python manage.py npc_asset_dependencies npc-pip    # one asset

Read-only. An asset or version used by the ACTIVE release or a SUPERSEDED release (a rollback
target) cannot be retired in the Asset Library; draft rows block nothing and are listed so staff
know what to fix. The same report is in Django Admin (NPC releases, Asset dependencies). Prints
asset ids, release numbers and staff-authored keys only; never child data.
"""

from django.core.management.base import BaseCommand

from apps.npcs import dependencies


class Command(BaseCommand):
    help = "List the NPC releases and draft rows that use each asset."

    def add_arguments(self, parser):
        parser.add_argument("asset_id", nargs="?", help="Report only this asset id.")

    def handle(self, *args, asset_id=None, **options):
        reports = dependencies.report(asset_id)
        if not reports:
            what = asset_id or "any asset"
            self.stdout.write(f"No NPC release or draft uses {what}.")
            return
        for item in reports:
            verdict = "cannot be retired" if item.blocks_retirement else "can be retired"
            self.stdout.write(f"{item.asset.asset_id} ({item.asset.kind}): {verdict}")
            for link in item.release_links:
                version = f"v{link.version.number}" if link.version_id else "bundled"
                status = link.release.get_status_display().lower()
                self.stdout.write(
                    f"  release {link.release.number} ({status}) {version}: {link.usage}"
                )
            for line in item.drafts.describe():
                self.stdout.write(f"  draft: {line}")
