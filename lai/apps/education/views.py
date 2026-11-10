"""Skill progress reads, saved stories (AMP-03) and the Director (AMP-05). Child-scoped, bearer-only (LAI-0403).

GET    children/{id}/skill-progress/              the child's derived mastery rows
GET    children/{id}/story-artifacts/             the child's saved stories, newest first
POST   children/{id}/story-artifacts/             save the story made in one session (idempotent)
DELETE children/{id}/story-artifacts/{artifact}/  a parent deletes one saved story
GET    children/{id}/next-learning-activity/      the Director's suggestions (see below)

`SkillProgress` is never written here: it is derived on the server from evidence the server
graded (`mastery.apply_evidence`, LAI-0603). The client has no way to write mastery numbers.

A saved story is the narrated beats of one Storykeeper Castle play-through. The client sends the
session id and the beats; the server checks that the session is this child's, that every beat
names a step of that session's adventure, that each text is short and passes the AI output
boundary checks, and takes the title from the catalog. One story per session: saving again
returns the story already saved.
"""

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound, ValidationError
from rest_framework.response import Response

from apps.ai.content_safety import boundary_violations, contains_url
from apps.catalog.models import AdventureStep
from apps.game_sessions.models import AdventureSession, SessionKind
from apps.game_sessions.serializers import ClosedSerializer
from apps.users.scoping import ChildScopedAPIView

from .director import next_learning_activity
from .models import SkillProgress, StoryArtifact

MAX_SCENES = 20
MAX_SCENE_TEXT = 600
MAX_ARTIFACTS = 200


class StorySceneRejected(APIException):
    status_code = 400
    default_code = "story_scene_rejected"
    default_detail = "That story could not be saved."


def skill_progress_body(row: SkillProgress) -> dict:
    return {
        "learningObjectiveCode": row.learning_objective_code,
        "exposureCount": row.exposure_count,
        "independentSuccessCount": row.independent_success_count,
        "supportedSuccessCount": row.supported_success_count,
        "consecutiveIndependentCorrect": row.consecutive_independent_correct,
        "recentLevel": row.recent_level or None,
        "errorPattern": row.error_pattern or None,
        "lastPracticedAt": row.last_practiced_at.isoformat() if row.last_practiced_at else None,
    }


class SkillProgressView(ChildScopedAPIView):
    def get(self, request, child_id):
        rows = self.scoped(SkillProgress.objects.all()).order_by(
            "-last_practiced_at", "learning_objective_code"
        )
        return Response({"skills": [skill_progress_body(row) for row in rows]})


class SceneWrite(serializers.Serializer):
    stepId = serializers.CharField(max_length=100)
    text = serializers.CharField(max_length=MAX_SCENE_TEXT, trim_whitespace=True)
    source = serializers.ChoiceField(choices=["AI", "FALLBACK"])


class ArtifactWrite(ClosedSerializer):
    sessionId = serializers.UUIDField()
    scenes = serializers.ListField(child=SceneWrite(), min_length=1, max_length=MAX_SCENES)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        for scene in self.initial_data.get("scenes") or []:
            if isinstance(scene, dict) and set(scene) - set(SceneWrite().fields):
                raise ValidationError(
                    {"scenes": ["A scene has a field that is not accepted."]},
                    code="unknown_field",
                )
        return attrs


def artifact_body(artifact: StoryArtifact) -> dict:
    session = artifact.adventure_session
    return {
        "id": str(artifact.pk),
        "sessionId": str(session.pk),
        "templateSlug": session.adventure.slug,
        "title": artifact.title,
        "scenes": artifact.scenes,
        "createdAt": artifact.created_at.isoformat(),
    }


class StoryArtifactListView(ChildScopedAPIView):
    def get(self, request, child_id):
        artifacts = self.scoped(
            StoryArtifact.objects.select_related("adventure_session__adventure")
        ).order_by("-created_at")[:MAX_ARTIFACTS]
        return Response({"artifacts": [artifact_body(a) for a in artifacts]})

    def post(self, request, child_id):
        body = ArtifactWrite(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        session = (
            self.scoped(AdventureSession.objects.select_related("adventure"))
            .filter(pk=data["sessionId"], kind=SessionKind.ADVENTURE)
            .first()
        )
        if session is None:
            raise NotFound
        existing = self.scoped(StoryArtifact.objects).filter(adventure_session=session).first()
        if existing is not None:
            return Response(artifact_body(existing))
        steps = set(
            AdventureStep.objects.filter(adventure=session.adventure).values_list(
                "step_id", flat=True
            )
        )
        scenes = []
        for scene in data["scenes"]:
            if scene["stepId"] not in steps:
                raise ValidationError(
                    {"scenes": ["A scene names a step this adventure does not have."]},
                    code="unknown_step",
                )
            if boundary_violations(scene["text"]) or contains_url(scene["text"]):
                raise StorySceneRejected
            scenes.append(
                {"stepId": scene["stepId"], "text": scene["text"], "source": scene["source"]}
            )
        try:
            with transaction.atomic():
                artifact = StoryArtifact.objects.create(
                    child=self.child,
                    adventure_session=session,
                    title=session.adventure.title,
                    scenes=scenes,
                    created_at=timezone.now(),
                )
        except IntegrityError:  # a concurrent save of the same session won
            artifact = self.scoped(StoryArtifact.objects).get(adventure_session=session)
            return Response(artifact_body(artifact))
        return Response(artifact_body(artifact), status=201)


class StoryArtifactDetailView(ChildScopedAPIView):
    def delete(self, request, child_id, artifact_id):
        artifact = self.get_scoped_object(StoryArtifact.objects, artifact_id)
        artifact.delete()
        return Response(status=204)


class NextLearningActivityView(ChildScopedAPIView):
    """The Director's route (AMP-05; replaces the Amplify `getNextLearningActivity`).

    200: {"suggestions": [{"adventureSlug", "title", "score", "reasons": [...]}],
          "hasPersonalizedSignal": bool}. Read-only; another family's child is a 404. The
    reasoning is adult-facing; a child surface shows adventures in order, never a reason.
    """

    def get(self, request, child_id):
        return Response(next_learning_activity(self.child))
