"""Test-only routes that fail on purpose with synthetic sensitive values (LAI-0208)."""

import logging

from django.db import IntegrityError
from django.urls import path
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from config.urls import handler400, handler403, handler404, handler500  # noqa: F401
from config.urls import urlpatterns as real_patterns

from .sentinels import EMAIL, INTEREST, LOCAL, NICKNAME, SUB

app_logger = logging.getLogger("lai.testapp")


class Open(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]


class Boom(Open):
    def get(self, request, kind):
        secret_local = LOCAL  # noqa: F841 - must never reach any report
        if kind == "plain":
            raise RuntimeError(f"child {NICKNAME} <{EMAIL}> likes {INTEREST}")
        if kind == "chained":
            try:
                raise ValueError(f"inner {SUB}")
            except ValueError as inner:
                raise RuntimeError(f"outer {NICKNAME}") from inner
        if kind == "context":
            try:
                raise KeyError(INTEREST)
            except KeyError:
                raise RuntimeError("while handling") from None
        if kind == "database":
            raise IntegrityError(f"Key (cognito_sub)=({SUB}) already exists.")
        if kind == "logged":
            try:
                raise RuntimeError(f"handled {NICKNAME}")
            except RuntimeError:
                app_logger.exception("handler failed")
            return Response({"ok": True})
        if kind == "logged-error":
            app_logger.error("failed", exc_info=RuntimeError(f"explicit {EMAIL}"))
            return Response({"ok": True})
        return Response({})


urlpatterns = [path("api/v1/privacy/<str:kind>/", Boom.as_view()), *real_patterns]
