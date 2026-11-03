"""Speech routes (SM-P8-04)."""

from django.urls import path

from .views import SpeechFileView, SpeechView

urlpatterns = [
    path("children/<uuid:child_id>/audio/speech/", SpeechView.as_view(), name="speech"),
    path("speech-files/<str:token>/speech.mp3", SpeechFileView.as_view(), name="speech-file"),
]
