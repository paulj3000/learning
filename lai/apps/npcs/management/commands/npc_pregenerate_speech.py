"""Pre-generate NPC dialogue speech into the shared speech cache (LAI-NPC-028).

    python manage.py npc_pregenerate_speech              # the ACTIVE release
    python manage.py npc_pregenerate_speech --release 7  # one release by number

Uses the configured speech provider (`LAI_SPEECH_PROVIDER`; `disabled` does nothing, `fake`
makes placeholder audio, `polly` calls Amazon Polly and costs money). Already-cached lines are
skipped. Prints counts and keys only, never dialogue text or child data.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.npcs.models import NpcRelease
from apps.npcs.speech import pregenerate_release_speech
from apps.npcs.vocabulary import ReleaseStatus


class Command(BaseCommand):
    help = "Synthesize every voiced NPC dialogue line of a release into the speech cache."

    def add_arguments(self, parser):
        parser.add_argument("--release", type=int, help="Release number (default: ACTIVE).")

    def handle(self, *args, release=None, **options):
        if release is None:
            row = NpcRelease.objects.filter(status=ReleaseStatus.ACTIVE).first()
            if row is None:
                raise CommandError("There is no ACTIVE NPC release.")
        else:
            row = NpcRelease.objects.filter(number=release).first()
            if row is None:
                raise CommandError(f"NPC release {release} does not exist.")
        report = pregenerate_release_speech(row)
        self.stdout.write(
            f"NPC release {report.release}: synthesized {report.synthesized}, "
            f"cached {report.cached}, recorded {report.recorded}, skipped {report.skipped}, "
            f"failed {report.failed}, characters {report.characters_synthesized}"
            + (f", stopped: {report.stopped}" if report.stopped else "")
        )
        for problem in report.problems:
            self.stdout.write(f"  {problem}")
