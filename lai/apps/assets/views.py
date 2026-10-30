"""The asset API (LAI-2200 AM-6). Read-only: there is no upload or mutation endpoint here.

- `GET /api/v1/children/<child_id>/assets/?ids=a,b@2`: resolve published assets for a child's
  scene. Child-scoped like every play route, so the caller is the parent of that child.
- `GET /api/v1/asset-files/<token>/model.<format>`: the bytes of a published version, for
  `django` delivery. The signed token is the authorization (the loader sends no bearer token);
  publication is re-checked on every fetch.
"""

import logging
import time
import uuid

from django.http import FileResponse, HttpResponseNotModified, JsonResponse
from rest_framework.exceptions import ValidationError
from rest_framework.negotiation import BaseContentNegotiation
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import AssetStatus
from apps.core.exceptions import error_body
from apps.game_sessions.runtime_auth import GameRuntimeAccessMixin
from apps.users.scoping import ChildScopedAPIView

from . import resolver
from .delivery import InvalidToken, read_token
from .models import AssetVersion, VersionStatus
from .storage import StorageError, get_storage

logger = logging.getLogger("lai.assets")


class AssetResolveView(GameRuntimeAccessMixin, ChildScopedAPIView):
    """Also reachable by the game runtime's cookie, for its own child (LAI-ANDROID-API-001)."""

    def get(self, request, child_id):
        try:
            references = resolver.parse_references(request.query_params.get("ids", ""))
        except resolver.BadReferences as error:
            raise ValidationError({"ids": [str(error)]}) from None
        response = Response({"assets": resolver.resolve(references)})
        response["Cache-Control"] = "private, no-cache"  # the URLs inside expire
        return response


class _AnyContent(BaseContentNegotiation):
    """The file route answers with the model whatever the client's Accept header says."""

    def select_parser(self, request, parsers):
        return parsers[0] if parsers else None

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def _not_found() -> JsonResponse:
    return JsonResponse(error_body("not_found", "Not found."), status=404)


class AssetFileView(APIView):
    authentication_classes: list = []  # the signed token authorizes; no bearer token is read
    permission_classes = [AllowAny]
    content_negotiation_class = _AnyContent

    def get(self, request, token, filename):
        try:
            version_id, expires = read_token(token)
        except InvalidToken:
            return _not_found()
        version = (
            AssetVersion.objects.select_related("asset")
            .filter(version_id=version_id, status=VersionStatus.PUBLISHED)
            .exclude(asset__status=AssetStatus.RETIRED)
            .first()
            if _is_uuid(version_id)
            else None
        )
        if version is None or filename != f"model.{version.format}":
            return _not_found()  # retired, unpublished, unknown, or a mismatched name: alike
        etag = f'"{version.sha256}"'
        if request.headers.get("If-None-Match") == etag:
            return HttpResponseNotModified(headers={"ETag": etag})
        try:
            stream = get_storage().open(version.storage_key)
        except StorageError:
            logger.warning("asset file unavailable: %s v%s", version.asset.asset_id, version.number)
            return JsonResponse(
                error_body("content_unavailable", "This is not available right now."), status=503
            )
        remaining = max(expires - _now(), 0)
        response = FileResponse(stream, content_type=version.content_type)
        response["Content-Length"] = str(version.size_bytes)
        response["Cache-Control"] = f"private, max-age={remaining}, immutable"
        response["ETag"] = etag
        return response


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, TypeError):
        return False
    return True


def _now() -> int:
    return int(time.time())
