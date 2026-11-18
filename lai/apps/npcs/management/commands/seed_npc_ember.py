"""Author Ember's Storykeeper's Castle visit as NPC Manager content (SC-R05-02).

    python manage.py seed_npc_ember             # create missing rows, then validate
    python manage.py seed_npc_ember --publish   # ... and publish a release if anything changed

Prerequisites: `load_content` (the `ember-dragon` NPC, the `npc-pip` stand-in model she already
wears in the sanctuary, and the `storykeeper-castle` Place).

One character, `ember-dragon`, with one gated Place-level placement in the castle
(`castle-ember`); see `apps/npcs/ember_content.py`. Create-only and safe to rerun, exactly like
`seed_npc_quill`; releases are global, so publishing also carries every other READY character.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.npcs import ember_content
from apps.npcs.castle_seed import run_seed_command, seed_castle_npc

COMMAND = "seed_npc_ember"


def seed_ember() -> list[str]:
    """Create Ember's castle NPC Manager rows that do not exist yet. Returns what was created."""
    return seed_castle_npc(ember_content, COMMAND)


class Command(BaseCommand):
    help = "Author Ember's castle visit as NPC Manager content (create-only), validate, publish."

    def add_arguments(self, parser):
        parser.add_argument(
            "--publish", action="store_true", help="Publish a release when validation passes."
        )
        parser.add_argument("--notes", default=COMMAND, help="Release notes.")

    def handle(self, *args, publish: bool = False, **options):
        run_seed_command(
            self,
            ember_content,
            "Ember",
            COMMAND,
            publish=publish,
            notes=options.get("notes") or COMMAND,
        )
