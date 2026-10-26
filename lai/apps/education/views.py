"""Mastery reads (LAI-0603). Child-scoped, bearer only, read-only (LAI-0403).

GET /api/v1/children/{child_id}/mastery/
    200: {"objectives": [entry, ...]}, every objective the child has evidence for, most
         recently practised first.
GET /api/v1/children/{child_id}/mastery/{objective_id}/
    200: one entry, also for a catalog objective with no evidence yet (`hasEvidence: false`,
         `status: null`); 404 for a code the catalog does not hold.

There is no write route: mastery moves only through graded answers
(`apps.education.services.record_step_evidence`). Contract: docs/PLAY_API.md, "Mastery".
"""

from django.utils import timezone
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from apps.catalog.models import LearningObjective
from apps.users.scoping import ChildScopedAPIView

from .models import SkillProgress
from .reads import mastery_entries, mastery_entry


class MasteryListView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response({"objectives": mastery_entries(self.child)})


class MasteryDetailView(ChildScopedAPIView):
    def get(self, request, child_id, objective_id):
        objective = LearningObjective.objects.filter(code=objective_id).first()
        if objective is None:
            raise NotFound
        progress = (
            SkillProgress.objects.for_child(self.child)
            .filter(learning_objective_code=objective.code)
            .first()
        )
        return Response(mastery_entry(objective, progress, timezone.now()))
