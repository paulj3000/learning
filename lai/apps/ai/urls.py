"""AI routes (LAI-0702, LAI-0703, LAI-0706). All are child-scoped views (`ChildScopedAPIView`)."""

from django.urls import path

from .views import AIHistoryView, CompanionTurnView, SafetyEventsView, TutorTurnView

CHILD = "children/<uuid:child_id>/"

urlpatterns = [
    path(f"{CHILD}ai/companion-turns/", CompanionTurnView.as_view(), name="ai-companion-turns"),
    path(f"{CHILD}ai/tutor-turns/", TutorTurnView.as_view(), name="ai-tutor-turns"),
    path(f"{CHILD}ai/safety-events/", SafetyEventsView.as_view(), name="ai-safety-events"),
    path(f"{CHILD}ai/history/", AIHistoryView.as_view(), name="ai-history"),
]
