"""AI turn routes (LAI-0702, LAI-0703). Both are child-scoped views (`ChildScopedAPIView`)."""

from django.urls import path

from .views import CompanionTurnView, TutorTurnView

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}ai/companion-turns/", CompanionTurnView.as_view(), name="ai-companion-turns"),
    path(f"{CHILD}ai/tutor-turns/", TutorTurnView.as_view(), name="ai-tutor-turns"),
]
