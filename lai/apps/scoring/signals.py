"""Live hooks (GE-104): reconcile a child after a gameplay write commits.

Receivers live here, in the scoring app, so no other app's code changes: the existing play,
quest, discovery and reward services stay exactly as they are and keep deciding everything.
Each receiver only schedules `reconcile.schedule(child_id)`, which runs after the gameplay
transaction commits, so scoring can never slow, fail or roll back play. When scoring is off
(`LAI_SCORING_ENABLED`, the default) nothing is scheduled.

Missing a signal is harmless by design: the next reconcile, or `manage.py scoring_reconcile`,
derives the same awards from the same records.
"""

from django.db.models.signals import post_save

from . import reconcile

_UID = "apps.scoring.signals"


def _child_of(instance):
    child_id = getattr(instance, "child_id", None)
    if child_id is None and hasattr(instance, "session"):  # AdventureAction has no child column
        child_id = getattr(instance.session, "child_id", None)
    return child_id


def _on_save(sender, instance, created, raw=False, **kwargs):
    if raw:  # loaddata
        return
    reconcile.schedule(_child_of(instance))


def watched_models():
    from apps.education.models import SkillProgress
    from apps.game_sessions.models import (
        AdventureAction,
        AdventureSession,
        ChallengeAttempt,
        PuzzleAttempt,
    )
    from apps.inventory.models import GrantedRule
    from apps.progression.models import WorldChange, WorldState
    from apps.quests.models import QuestProgress

    return (
        AdventureAction,
        AdventureSession,
        ChallengeAttempt,
        PuzzleAttempt,
        SkillProgress,
        GrantedRule,
        WorldChange,
        WorldState,
        QuestProgress,
    )


def connect() -> None:
    for model in watched_models():
        post_save.connect(
            _on_save, sender=model, dispatch_uid=f"{_UID}.{model._meta.label_lower}", weak=False
        )
