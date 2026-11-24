"""Report where an asset is used, from every registered usage provider (LAI-07 W2).

    python manage.py asset_usage palm-tree
    python manage.py asset_usage palm-tree --number 3
    python manage.py asset_usage palm-tree --json

Read-only. "BLOCKS" marks a usage that refuses retirement. Assets named only in bundled
TypeScript manifests are not visible here (docs/ASSET_LIBRARY.md s. 25.1).
"""

import json

from django.core.management.base import BaseCommand, CommandError

from apps.assets.dependencies import DependencyCheckFailed, registered_sources, usages_for
from apps.assets.models import AssetVersion
from apps.catalog.models import ContentAsset


class Command(BaseCommand):
    help = "List every registered usage of an asset (or one version) and what blocks retiring it."

    def add_arguments(self, parser):
        parser.add_argument("asset_id")
        parser.add_argument(
            "--number", type=int, dest="number", help="Only usages of this version number."
        )
        parser.add_argument(
            "--json", action="store_true", dest="as_json", help="Print the report as JSON."
        )

    def handle(self, *args, asset_id, number, as_json, **options):
        version = number  # `--version` is Django's own option
        asset = ContentAsset.objects.filter(asset_id=asset_id).first()
        if asset is None:
            raise CommandError(f'No asset "{asset_id}".')
        target = None
        if version is not None:
            target = AssetVersion.objects.filter(asset=asset, number=version).first()
            if target is None:
                raise CommandError(f'"{asset_id}" has no version {version}.')
        try:
            usages = usages_for(asset, target)
        except DependencyCheckFailed as failed:
            raise CommandError(
                f"The {failed.source} dependency check failed; see the server log."
            ) from None
        if as_json:
            report = {
                "asset": asset.asset_id,
                "version": version,
                "sources": registered_sources(),
                "blocksRetirement": any(u.blocks_retirement for u in usages),
                "usages": [
                    {
                        "source": u.source,
                        "code": u.code,
                        "label": u.label,
                        "blocksRetirement": u.blocks_retirement,
                        "adminUrl": u.admin_url,
                        "details": dict(u.details),
                    }
                    for u in usages
                ],
            }
            self.stdout.write(json.dumps(report, sort_keys=True, indent=1))
            return
        what = f"{asset.asset_id} v{version}" if version is not None else asset.asset_id
        sources = registered_sources()
        if not sources:
            self.stdout.write(f"{what}: no usage providers are registered.")
            return
        blocking = sum(1 for u in usages if u.blocks_retirement)
        self.stdout.write(
            f"{what}: {len(usages)} usage(s), {blocking} blocking retirement "
            f"(checked: {', '.join(sources)})."
        )
        for u in usages:
            flag = "BLOCKS" if u.blocks_retirement else "listed"
            link = f" {u.admin_url}" if u.admin_url else ""
            self.stdout.write(f"  [{flag}] {u.source}: {u.label}{link}")
