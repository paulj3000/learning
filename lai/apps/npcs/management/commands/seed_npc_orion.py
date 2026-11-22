"""Author Professor Orion as NPC Manager content for Storykeeper's Castle (SC-R05-03).

    python manage.py seed_npc_orion             # create missing rows, then validate
    python manage.py seed_npc_orion --publish   # ... and publish a release if anything changed

Prerequisites: `load_content` (the `professor-orion` NPC, the `npc-professor-ticktock` stand-in
model and the `storykeeper-castle` Place). Orion has no voice yet: captions only until staff pick
one in Django Admin.

Create-only and safe to rerun, exactly like `seed_npc_quill`: each row is created when its stable
key does not exist yet and never changed once it does, so staff edits survive. A rerun with
nothing to create reports `unchanged`, and `--publish` reports `unchanged` when the ACTIVE release
already holds this content. Releases are global: publishing here also carries every other READY
character.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.npcs import orion_content
from apps.npcs.castle_seed import run_seed_command, seed_castle_npc

COMMAND = "seed_npc_orion"


def seed_orion() -> list[str]:
    """Create Orion's NPC Manager rows that do not exist yet. Returns what was created."""
    return seed_castle_npc(orion_content, COMMAND)


class Command(BaseCommand):
    help = (
        "Author Professor Orion as NPC Manager content (create-only), validate, optionally publish."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--publish", action="store_true", help="Publish a release when validation passes."
        )
        parser.add_argument("--notes", default=COMMAND, help="Release notes.")

    def handle(self, *args, publish: bool = False, **options):
        run_seed_command(
            self,
            orion_content,
            "Professor Orion",
            COMMAND,
            publish=publish,
            notes=options.get("notes") or COMMAND,
        )
