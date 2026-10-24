from django.urls import path

from .views import AnswersView, HintsView

urlpatterns = [
    path(
        "children/<uuid:child_id>/sessions/<uuid:session_id>/answers/",
        AnswersView.as_view(),
        name="session-answers",
    ),
    path(
        "children/<uuid:child_id>/sessions/<uuid:session_id>/hints/",
        HintsView.as_view(),
        name="session-hints",
    ),
]
