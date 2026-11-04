"""A read-only report on the sound library (SM-P3).

    python manage.py audio_library_report                     # inventory, every game, problems
    python manage.py audio_library_report --game treasure-rush
    python manage.py audio_library_report --island learning-adventure-island --place pirate-cove
    python manage.py audio_library_report --game treasure-rush --strict   # exit 2 if not ready

Never writes, never publishes, never touches a sound configuration. The output is deterministic
(sorted, no timestamps except the last publication date stored in the database), so it can be
compared between runs. In `--strict` mode the command exits with status 2 when any required cue of
the chosen game(s) cannot play, or any error-level problem exists, so a release check can use it.
"""

from django.core.management.base import BaseCommand, CommandError

from apps.audio import reporting


class Command(BaseCommand):
    help = "Read-only sound library readiness report. Use --strict to fail when not ready."

    def add_arguments(self, parser):
        parser.add_argument("--game", choices=sorted(reporting.GAMES), help="Check one game.")
        parser.add_argument("--island", help="Narrow the scope table to this Island slug.")
        parser.add_argument("--place", help="Narrow the scope table to this Place slug.")
        parser.add_argument(
            "--strict",
            action="store_true",
            help="Exit with status 2 when required audio is missing.",
        )

    def handle(self, *args, **options):
        out = self.stdout.write
        games = [options["game"]] if options["game"] else sorted(reporting.GAMES)
        inv = reporting.inventory()
        out("SOUND LIBRARY")
        out(f"  audio assets: {inv.audio_assets}")
        out(f"  published audio assets: {inv.published_assets}")
        out(f"  draft or unpublished audio assets: {inv.draft_assets}")
        out(f"  retired audio assets: {inv.retired_assets}")
        out(f"  sound cues: {inv.cues} ({inv.enabled_cues} enabled)")
        out(f"  cues in the live release: {inv.cues_in_live_release}")
        out(f"  unassigned cues: {inv.unassigned_cues}")
        out(f"  cues whose audio is not published: {inv.cues_with_blocked_audio}")
        out(f"  releases: {inv.releases}")
        live = f"release {inv.live_release_number}" if inv.live_release_number else "none"
        out(f"  live release: {live}")
        out(f"  last published: {inv.last_published_at or 'never'}")

        not_ready = 0
        for slug in games:
            coverage = reporting.game_coverage(slug)
            out("")
            out(f"GAME {coverage.game.title.upper()} ({slug})")
            if not coverage.area_found:
                out(f"  3D Area '{coverage.game.region_id}': NOT FOUND")
            for check in coverage.checks:
                mark = "READY    " if check.ready else "NOT READY"
                out(f"  {mark} {check.cue_id}  [{check.purpose}]")
                if not check.ready:
                    out(
                        f"            cue: {check.cue_status}; audio '{check.asset_id}': "
                        f"{check.asset_status}; assignment: {check.assignment_status}; "
                        f"release: {check.release_status}; manifest: {check.manifest_status}"
                    )
                    for fix in check.remediation:
                        out(f"            -> {fix}")
            for check in coverage.optional:
                out(f"  optional  {check.cue_id}: {'ready' if check.ready else check.cue_status}")
            required = len(coverage.checks)
            out(f"  {coverage.ready_count} of {required} required cues ready")
            if not coverage.ready:
                not_ready += required - coverage.ready_count or 1

        scopes = reporting.scope_coverage(options["island"], options["place"])
        out("")
        out("COVERAGE BY SCOPE")
        for row in scopes:
            out(
                f"  {row.kind}: {row.label}: {row.assignments} assignment(s), "
                f"{row.manifest_sounds} sound(s) served, {row.problems} invalid"
            )
        if not scopes:
            out("  (nothing matches)")

        issues = reporting.diagnostics(options["game"]).issues
        out("")
        out(f"PROBLEMS ({len(issues)})")
        for issue in issues:
            out(f"  {issue.severity.upper()} {issue.code} {issue.subject}: {issue.message}")
            out(f"      -> {issue.remediation}")
        if not issues:
            out("  none")

        errors = [i for i in issues if i.severity == reporting.ERROR]
        if options["strict"] and (not_ready or errors):
            raise CommandError(
                f"Not ready: {not_ready} required cue(s) cannot play, {len(errors)} error(s).",
                returncode=2,
            )
