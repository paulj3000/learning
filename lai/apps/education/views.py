"""The Director's child-scoped route (AMP-05; replaces the Amplify `getNextLearningActivity`).

GET /api/v1/children/{child_id}/next-learning-activity/
    200: {"suggestions": [{"adventureSlug", "title", "score",
                            "reasons": [{"kind", "skillId", "status", "weight", "storyId",
                                         "penalty"}]}],
          "hasPersonalizedSignal": bool}

Read-only. The child is resolved through the signed-in parent (`ChildScopedAPIView`): another
family's child and a missing child are the same 404. The reasoning is adult-facing; a child
surface shows adventures in order, never a reason (`director.py`).
"""

from rest_framework.response import Response

from apps.users.scoping import ChildScopedAPIView

from .director import next_learning_activity


class NextLearningActivityView(ChildScopedAPIView):
    def get(self, request, child_id):
        return Response(next_learning_activity(self.child))
