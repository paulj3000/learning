"""Import the Quaternius Palm Trees pack into the asset library (TR-PALM-03).

    python manage.py import_treasure_rush_palm_trees --source /path/to/palm-tree-assets --dry-run
    python manage.py import_treasure_rush_palm_trees --source /path/to/palm-tree-assets --publish

Kept for compatibility: exactly `import_treasure_rush_environment --category palms`, with the
same options (TR-ENV-03). See that command and docs/ASSET_LIBRARY.md section 22.
"""

from .import_treasure_rush_environment import Command as EnvironmentCommand


class Command(EnvironmentCommand):
    help = "Prepare, validate and store the Quaternius palm trees as asset library versions."
    fixed_category = "palms"
