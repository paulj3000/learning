"""Create Storykeeper Castle's authored narration lines (SC-R06-03).

    python manage.py seed_castle_speech_lines            # create what is missing
    python manage.py seed_castle_speech_lines --dry-run  # report only, write nothing

- Idempotent. A line id that already exists is never changed: staff may have edited or disabled
  it in Django Admin. A line whose text no longer matches its source is reported as `DIFFERS`
  so staff can decide; it is not overwritten.
- Needs the `narrator` voice profile (`seed_speech_voices`). Without it nothing is created and the
  command says so.
- Every line passes the same output rules as any spoken text (`SpeechLine.clean`).
- Synthesizes nothing and calls no provider: a clip is made (with Amazon Polly where speech is on,
  the fake provider locally and in tests) the first time a child's game asks for the line, and is
  then cached and shared. It does not turn speech on; `LAI_SPEECH_PROVIDER` does that.
"""

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.speech.castle_lines import CONTEXT, VOICE_PROFILE_ID, castle_lines
from apps.speech.models import SpeechLine, VoiceProfile


class Command(BaseCommand):
    help = "Create missing Storykeeper Castle narration lines. Never changes an existing line."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report only; write nothing.")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        profile = VoiceProfile.objects.filter(profile_id=VOICE_PROFILE_ID).first()
        if profile is None:
            self.stdout.write(
                f"VOICE NEEDED: create the '{VOICE_PROFILE_ID}' voice profile first "
                "(manage.py seed_speech_voices). Nothing was created."
            )
            return
        created, existing, differs, invalid = [], [], [], []
        with transaction.atomic():
            for spec in castle_lines():
                current = SpeechLine.objects.filter(line_id=spec.line_id).first()
                if current is not None:
                    existing.append(spec.line_id)
                    if current.text != spec.text:
                        differs.append(spec.line_id)
                    continue
                line = SpeechLine(
                    line_id=spec.line_id, voice_profile=profile, text=spec.text, context=CONTEXT
                )
                try:
                    line.full_clean()
                except ValidationError as error:
                    invalid.append((spec.line_id, "; ".join(error.messages)))
                    continue
                if not dry:
                    line.save()
                created.append(spec.line_id)

        verb = "Would create" if dry else "Created"
        self.stdout.write(f"{verb} {len(created)} line(s).")
        self.stdout.write(f"Already present (untouched): {len(existing)}")
        for line_id in differs:
            self.stdout.write(f"DIFFERS {line_id}: its text no longer matches the source; review it")
        for line_id, problem in invalid:
            self.stdout.write(f"INVALID {line_id}: {problem}")
