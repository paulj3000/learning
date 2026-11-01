"""The asset manager's administrator API (AM-14, ADR-042; `docs/ASSET_MANAGER.md` section 20).

The browser never touches the asset bucket: it sends the file to Django, and Django checksums,
validates, stores and records it through `apps.assets.services`, the same lifecycle Django Admin
uses. There is no second asset subsystem; these views are a REST surface over the services.

Authorization (ADR-024):

- **A4.** Administrative authority comes from the `Admins` group of the verified Cognito access
  token, on every request. No API permission reads `is_staff` (ADR-034 item 4): Django Admin's
  staff sign-in and Django permissions apply to Django Admin only.
- **A3.** Every mutation (create a definition, upload, publish, change the default, retire,
  delete) is a privileged administrative mutation, so it also needs a recent sign-in
  (`MUTATION_GATE`, `RequiresRecentAuthentication`, LAI-0209, ADR-043). It is checked after the
  `Admins` check: a non-administrator gets `403 permission_denied` however recently they signed
  in, and recent sign-in never grants administration. An administrator whose sign-in is too old
  gets `403 recent_auth_required`. Reads (the list and the detail) need no recent sign-in.

Responses never carry storage keys, bucket names, uploader identities or credentials. Asset
definitions are never deleted here (retire one in Django Admin), and published or retired
versions are never deleted at all, so content that references an asset cannot lose it.
"""

import logging
from pathlib import PurePath

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from rest_framework import exceptions, serializers
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import SAFE_METHODS
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.catalog.models import (
    ASSET_KINDS,
    SLUG_LENGTH,
    AssetCategory,
    AssetOrigin,
    ContentAsset,
)
from apps.core.content_status import ContentStatus
from apps.core.exceptions import error_body
from apps.regions.models import TreasureChest, WorldObjectPlacement
from apps.users.permissions import IsProvisionedParent, RequiresRecentAuthentication

from . import services
from .models import AssetVersion
from .storage import ASSET_ID

logger = logging.getLogger("lai.assets")

ADMIN_GROUP = "Admins"

# ADR-024 A3: every mutation also needs a recent sign-in (LAI-0209). Listed after the admin check.
MUTATION_GATE = RequiresRecentAuthentication

# How each refusal from `services` is answered.
REFUSAL_STATUS = {
    "invalid_model": 400,
    "duplicate_version": 409,
    "asset_retired": 409,
    "not_validated": 409,
    "not_published": 409,
    "default_in_use": 409,
    "published": 409,
    "storage_failed": 503,
}

# Multipart framing around the file; a request larger than the limit plus this is refused unread.
MULTIPART_OVERHEAD = 64 * 1024


class IsAssetAdministrator(IsProvisionedParent):
    """A provisioned account whose verified access token carries the `Admins` group (A4)."""

    def has_permission(self, request, view):
        super().has_permission(request, view)
        return ADMIN_GROUP in request.auth.groups


class AssetTooLarge(exceptions.APIException):
    status_code = 413
    default_code = "asset_too_large"
    default_detail = "That file is larger than the upload limit."


class AdminAssetView(APIView):
    def get_permissions(self):
        permissions = [IsAssetAdministrator()]
        if self.request.method not in SAFE_METHODS:
            permissions.append(MUTATION_GATE())
        return permissions

    def definition(self, asset_id: str) -> ContentAsset:
        asset = ContentAsset.objects.filter(asset_id=asset_id).first()
        if asset is None:
            raise exceptions.NotFound
        return asset

    def version(self, asset: ContentAsset, number: int) -> AssetVersion:
        version = asset.versions.filter(number=number).first()
        if version is None:
            raise exceptions.NotFound
        return version


def refused(refusal: services.AssetActionRefused) -> Response:
    details = dict(refusal.details)
    if refusal.findings:
        details["findings"] = [finding.as_dict() for finding in refusal.findings]
    return Response(
        error_body(refusal.code, refusal.message, details or None),
        status=REFUSAL_STATUS.get(refusal.code, 409),
    )


# --- representations ---------------------------------------------------------------------------


def _iso(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value else None


def version_body(version: AssetVersion) -> dict:
    return {
        "number": version.number,
        "versionId": str(version.version_id),
        "status": version.status,
        "originalFilename": version.original_filename,
        "contentType": version.content_type,
        "sizeBytes": version.size_bytes,
        "sha256": version.sha256,
        "format": version.format,
        "clips": list(version.clips),
        "dimensions": version.dimensions,
        "validationReport": version.validation_report,
        "createdAt": _iso(version.created_at),
        "validatedAt": _iso(version.validated_at),
        "publishedAt": _iso(version.published_at),
        "retiredAt": _iso(version.retired_at),
    }


def published_references(asset_id: str) -> int:
    """How many objects in published 3D Areas use this asset id."""
    published = {"asset_id": asset_id, "region__status": ContentStatus.PUBLISHED}
    return (
        WorldObjectPlacement.objects.filter(**published).count()
        + TreasureChest.objects.filter(**published).count()
    )


def definition_body(asset: ContentAsset, *, versions: bool) -> dict:
    default = asset.default_version
    body = {
        "assetId": asset.asset_id,
        "displayName": asset.display_name,
        "description": asset.description,
        "kind": asset.kind,
        "category": asset.category,
        "tags": list(asset.tags),
        "status": asset.status,
        "origin": asset.origin,
        "defaultVersion": default.number if default else None,
        "versionCount": asset.versions.count(),
        "createdAt": _iso(asset.created_at),
        "updatedAt": _iso(asset.updated_at),
    }
    if versions:
        body["versions"] = [version_body(v) for v in asset.versions.order_by("-number")]
        body["publishedReferences"] = published_references(asset.asset_id)
    return body


class DefinitionInput(serializers.Serializer):
    # The storage key's own rule, so a definition made here can always take an upload.
    assetId = serializers.RegexField(
        ASSET_ID,
        max_length=SLUG_LENGTH,
        error_messages={"invalid": "Use lowercase letters and digits joined by hyphens."},
    )
    displayName = serializers.CharField(max_length=120)
    description = serializers.CharField(max_length=1000, required=False, allow_blank=True)
    kind = serializers.ChoiceField(choices=ASSET_KINDS)
    category = serializers.ChoiceField(choices=AssetCategory.values)
    tags = serializers.ListField(
        child=serializers.SlugField(max_length=32), max_length=20, required=False
    )


# --- views -------------------------------------------------------------------------------------


class AdminAssetListView(AdminAssetView):
    """GET every definition (optionally `?kind=`); POST a new Django definition with no versions."""

    parser_classes = [JSONParser]

    def get(self, request):
        assets = ContentAsset.objects.select_related("default_version").order_by("asset_id")
        kind = request.query_params.get("kind")
        if kind:
            assets = assets.filter(kind=kind)
        return Response({"assets": [definition_body(a, versions=False) for a in assets]})

    def post(self, request):
        data = DefinitionInput(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data
        asset = ContentAsset(
            asset_id=values["assetId"],
            kind=values["kind"],
            category=values["category"],
            origin=AssetOrigin.DJANGO,
            display_name=values["displayName"].strip(),
            description=values.get("description", "").strip(),
            tags=values.get("tags", []),
            created_by=request.user,
        )
        if ContentAsset.objects.filter(asset_id=asset.asset_id).exists():
            return _asset_exists()
        try:
            asset.full_clean()
        except DjangoValidationError as error:
            raise exceptions.ValidationError(_camel_errors(error.message_dict)) from None
        try:
            with transaction.atomic():
                asset.save()
        except IntegrityError:  # created by a concurrent request since the check above
            return _asset_exists()
        logger.info("asset definition created: %s", asset.asset_id)
        return Response(definition_body(asset, versions=True), status=201)


class AdminAssetDetailView(AdminAssetView):
    def get(self, request, asset_id):
        return Response(definition_body(self.definition(asset_id), versions=True))


class AdminAssetVersionsView(AdminAssetView):
    """POST a model file (multipart field `file`) as the definition's next version."""

    parser_classes = [MultiPartParser]

    def post(self, request, asset_id):
        limit = int(settings.LAI_ASSET_MAX_UPLOAD_BYTES)
        try:
            declared = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            raise exceptions.ParseError from None
        if declared > limit + MULTIPART_OVERHEAD:
            raise AssetTooLarge
        asset = self.definition(asset_id)
        upload = request.FILES.get("file")
        if upload is None:
            raise exceptions.ValidationError({"file": ["Choose a model file to upload."]})
        if upload.size > limit:
            raise AssetTooLarge
        # The name is kept for the admin's reference only; keys are made from ids, never names.
        filename = PurePath(upload.name or "").name[:255]
        try:
            version = services.upload_version(
                asset, upload, original_filename=filename, user=request.user
            )
        except services.AssetActionRefused as refusal:
            return refused(refusal)
        return Response(version_body(version), status=201)


class AdminAssetVersionView(AdminAssetView):
    """DELETE a version that was never published, and its stored file."""

    def delete(self, request, asset_id, number):
        version = self.version(self.definition(asset_id), number)
        try:
            services.delete_unpublished_version(version)
        except services.AssetActionRefused as refusal:
            return refused(refusal)
        return Response(status=204)


class AdminAssetVersionActionView(AdminAssetView):
    """POST `publish`, `default` (make it the default) or `retire` (body: `{"replacement": n}`)."""

    parser_classes = [JSONParser]
    action = ""

    def post(self, request, asset_id, number):
        asset = self.definition(asset_id)
        version = self.version(asset, number)
        try:
            if self.action == "publish":
                services.publish_version(version, user=request.user)
            elif self.action == "default":
                services.set_default_version(version)
            else:
                services.retire_version(version, replacement=self._replacement(asset, request))
        except services.AssetActionRefused as refusal:
            return refused(refusal)
        version.refresh_from_db()
        return Response(version_body(version))

    def _replacement(self, asset, request) -> AssetVersion | None:
        raw = request.data.get("replacement") if isinstance(request.data, dict) else None
        if raw is None:
            return None
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise exceptions.ValidationError({"replacement": ["A version number."]})
        return self.version(asset, raw)


def _asset_exists() -> Response:
    return Response(error_body("asset_exists", "An asset with this id already exists."), status=409)


_FIELD_NAMES = {"asset_id": "assetId", "display_name": "displayName"}


def _camel_errors(errors: dict) -> dict:
    return {_FIELD_NAMES.get(field, field): messages for field, messages in errors.items()}
