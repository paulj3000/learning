"""Create Storykeeper Castle's sound cues for audio that already exists (SC-R06-01).

    python manage.py seed_castle_sound            # create what can be, report the rest
    python manage.py seed_castle_sound --dry-run  # report only, write nothing

The same rules as `seed_treasure_rush_sound`, whose command this reuses with the castle's table
(`apps/audio/castle_cues.py`):

- Idempotent. A cue id that already exists is left exactly as staff configured it.
- A cue is created only when its audio asset exists in the Asset Library (asset id = the cue id
  with dashes, for example `ambient-castle-hall`), is audio, suits the channel, and has a
  PUBLISHED default version. Otherwise it is reported as `ASSET NEEDED`. No placeholder is made.
- Never publishes. Cues are created shared; they reach children only when staff publish a sound
  release in Django Admin.
- Touches no assignment, no other game's cue and no release. The shared cues the castle reuses
  (`sfx.learning.*`, `sfx.quest.complete`) are seeded by `seed_treasure_rush_sound`, not here.
"""

from apps.audio.castle_cues import CASTLE_CUES
from apps.audio.management.commands.seed_treasure_rush_sound import Command as SeedCommand


class Command(SeedCommand):
    help = "Create missing Storykeeper Castle sound cues whose audio exists. Never publishes."
    cues = CASTLE_CUES
