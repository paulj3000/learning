from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.urls import reverse
from django.utils import timezone
from rest_framework import exceptions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from . import deletion, photos, recent_auth, services
from .authentication import UnprovisionedParent
from .models import COMPANION_DISPLAY_NAMES, CompanionType
from .permissions import IsProvisionedParent, IsVerifiedPrincipal, RequiresRecentAuthentication
from .photo_storage import PhotoObjectMissing, PhotoStorageError
from .photo_validation import PhotoRejected
from .scoping import ChildScopedAPIView
from .serializers import (
    ChildProfileSerializer,
    ChildProfileWrite,
    ParentProfileWrite,
    model_errors,
)


class MeView(APIView):
    """The signed-in parent's own account.

    GET never creates anything: an unprovisioned parent gets 403 `account_not_provisioned`.
    POST provisions the account once (201) and is idempotent afterwards (200). It reads the
    identity only from the verified token, takes no request body, creates no children, and
    grants no privileges.

    PATCH (LAI-CHILD-001) changes the parent's own `displayName` and `timezone`, nothing else:
    the body is closed, so ownership, the identity mapping and admin flags can never be written.

    DELETE (AMP-03) deletes the account and every child's data (`deletion.delete_parent_account`).
    Like child deletion it is a sensitive action: a recent sign-in is required. 204 when done;
    503 `account_deletion_incomplete` when photo storage could not be cleaned up (safe to retry);
    409 `staff_account_not_deletable` for a Django Admin staff account. The client then deletes
    the Cognito user itself, while its token is still valid.

    All three return `{"id", "displayName", "timezone", "django_admin"}`. `django_admin` says
    whether this account is active Django Admin staff (LAI-0404, ADR-034). The React app POSTs
    once after every sign-in, which creates the account the first time and reads the flag in the
    same call. The flag only decides whether the React menu shows an "Admin" link: Django Admin
    checks its own session sign-in on every request and never trusts it, and a Cognito group
    never sets it. The Android app makes the same call (docs/android/ANDROID_AUTH_FLOW.md).
    """

    def get_permissions(self):
        if self.request.method == "DELETE":
            return [IsProvisionedParent(), RequiresRecentAuthentication()]
        permission = IsVerifiedPrincipal if self.request.method == "POST" else IsProvisionedParent
        return [permission()]

    def get(self, request):
        return Response(_account_body(request.user))

    def delete(self, request):
        try:
            deletion.delete_parent_account(request.user)
        except deletion.StaffAccountNotDeletable:
            raise StaffAccountNotDeletable from None
        except deletion.ChildDeletionIncomplete:
            raise AccountDeletionIncomplete from None
        return Response(status=204)

    def patch(self, request):
        body = ParentProfileWrite(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        try:
            account = services.update_parent_profile(request.user, **body.model_fields())
        except DjangoValidationError as error:
            raise model_errors(error, ParentProfileWrite.FIELDS) from None
        return Response(_account_body(account))

    def post(self, request):
        user = request.user
        if isinstance(user, UnprovisionedParent):
            account, created = services.provision_parent_account(user.cognito_sub)
        else:
            account, created = user, False
        # The app calls this right after every sign-in, so this sees each Cognito session's
        # first token and remembers its `auth_time` (LAI-0209: a refresh cannot move it).
        recent_auth.record_session_anchor(account, request.auth)
        return Response(_account_body(account), status=201 if created else 200)


class AccountDeletionIncomplete(exceptions.APIException):
    status_code = 503
    default_code = "account_deletion_incomplete"
    default_detail = "The account could not be fully deleted yet. Please try again."


class StaffAccountNotDeletable(exceptions.APIException):
    status_code = 409
    default_code = "staff_account_not_deletable"
    default_detail = "This account is managed in the administration site."


def _account_body(account):
    return {
        "id": str(account.pk),
        "displayName": account.display_name,
        "timezone": account.timezone,
        "django_admin": bool(account.is_active and account.is_staff),
    }


class ChildProfileLimitReached(exceptions.APIException):
    status_code = 409
    default_code = "child_profile_limit_reached"
    default_detail = "No more child profiles can be added."


class ChildListView(APIView):
    """GET the signed-in parent's children; POST creates one (LAI-ANDROID-API-001).

    Parent-scoped: the owner is always `request.user`. At most `MAX_CHILD_PROFILES` profiles,
    active or not (409 `child_profile_limit_reached`).
    """

    def get(self, request):
        children = services.list_child_profiles(request.user)
        return Response({"children": ChildProfileSerializer(children, many=True).data})

    def post(self, request):
        body = ChildProfileWrite(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            child = services.create_child_profile(request.user, **body.model_fields())
        except services.ChildProfileLimitReached:
            raise ChildProfileLimitReached from None
        except DjangoValidationError as error:
            raise model_errors(error) from None
        return Response(ChildProfileSerializer(child).data, status=201)


class ChildDeletionIncomplete(exceptions.APIException):
    status_code = 503
    default_code = "child_deletion_incomplete"
    default_detail = "The profile could not be fully deleted yet. Please try again."


class ChildDetailView(ChildScopedAPIView):
    """GET, PATCH or DELETE one of the parent's children.

    DELETE (LAI-0602) is a sensitive action: the parent must have signed in recently
    (`RequiresRecentAuthentication`, LAI-0209), checked before the child is looked up, so the
    answer for a stale sign-in is the same whichever id is asked for. The child is then resolved
    through the parent (another family's child or an unknown id: 404). Deletion removes the
    photo objects first and keeps the child if storage fails (503 `child_deletion_incomplete`,
    safe to retry); a repeated DELETE of a deleted child is 404.
    """

    def get_permissions(self):
        if self.request.method == "DELETE":
            return [IsProvisionedParent(), RequiresRecentAuthentication()]
        return super().get_permissions()

    def get(self, request, child_id):
        return Response(ChildProfileSerializer(self.child).data)

    def patch(self, request, child_id):
        body = ChildProfileWrite(data=request.data, partial=True)
        body.is_valid(raise_exception=True)
        try:
            child = services.update_child_profile(
                request.user, self.child.pk, **body.model_fields()
            )
        except services.ChildProfileNotFound:
            raise exceptions.NotFound from None
        except DjangoValidationError as error:
            raise model_errors(error) from None
        return Response(ChildProfileSerializer(child).data)

    def delete(self, request, child_id):
        try:
            deletion.delete_child_profile(request.user, self.child.pk)
        except services.ChildProfileNotFound:  # deleted by a concurrent request
            raise exceptions.NotFound from None
        except deletion.ChildDeletionIncomplete:
            raise ChildDeletionIncomplete from None
        return Response(status=204)


# --- Child profile photo (LAI-0904, ADR-042; docs/platform/CHILD_PHOTO_STORAGE.md) -------------


class PhotoInvalid(exceptions.APIException):
    status_code = 400
    default_code = "photo_invalid"
    default_detail = "That photo could not be read."


class PhotoDimensionsUnsupported(exceptions.APIException):
    status_code = 400
    default_code = "photo_dimensions"
    default_detail = "That photo's dimensions are not supported."


class PhotoTooLarge(exceptions.APIException):
    status_code = 413
    default_code = "photo_too_large"
    default_detail = "That photo file is too large."


class PhotoTypeUnsupported(exceptions.APIException):
    status_code = 415
    default_code = "photo_type_unsupported"
    default_detail = "Only JPEG photos are accepted."


class PhotoStorageUnavailable(exceptions.APIException):
    status_code = 503
    default_code = "photo_storage_unavailable"
    default_detail = "Photos are not available right now."


_PHOTO_REJECTIONS = {
    "photo_invalid": PhotoInvalid,
    "photo_dimensions": PhotoDimensionsUnsupported,
    "photo_too_large": PhotoTooLarge,
    "photo_type_unsupported": PhotoTypeUnsupported,
}


def _photo_body(request, child, photo):
    if photo is None:
        return {"photo": None}
    try:
        access = photos.photo_access(photo)
    except PhotoStorageError:
        raise PhotoStorageUnavailable from None
    url = access.url or request.build_absolute_uri(
        reverse("child-photo-content", kwargs={"child_id": child.pk})
    )
    return {
        "photo": {
            "id": str(photo.pk),
            "contentType": photo.content_type,
            "byteSize": photo.byte_size,
            "width": photo.width,
            "height": photo.height,
            "uploadedAt": photo.created_at.isoformat(),
            # "presigned": a plain GET of `url` until `urlExpiresAt`, no credentials (an <img>).
            # "api": `url` is this API and needs the same bearer token as every other call.
            "delivery": "presigned" if access.url else "api",
            "url": url,
            "urlExpiresAt": access.expires_at.isoformat() if access.expires_at else None,
        }
    }


def _uncached(response: Response) -> Response:
    """The body carries a presigned URL that Django authorized for this request only."""
    response["Cache-Control"] = "private, no-store"
    return response


class ChildPhotoView(ChildScopedAPIView):
    """GET, PUT (upload or replace) or DELETE the profile photo of one of the parent's children.

    PUT takes the raw JPEG as the body (`Content-Type: image/jpeg`), never multipart and never a
    file name. Removing a photo reduces the data held about a child, so unlike child deletion it
    is not a blocked sensitive action (ADR-024 A3).
    """

    def get(self, request, child_id):
        return _uncached(
            Response(_photo_body(request, self.child, photos.current_photo(self.child)))
        )

    def put(self, request, child_id):
        limit = settings.LAI_CHILD_PHOTO_MAX_BYTES
        try:
            declared = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            raise PhotoInvalid from None
        if declared > limit:
            raise PhotoTooLarge
        data = request._request.read(limit + 1)
        try:
            photo = photos.replace_photo(
                request.user, self.child.pk, data, request.content_type or ""
            )
        except PhotoRejected as rejected:
            raise _PHOTO_REJECTIONS[rejected.code] from None
        except services.ChildProfileNotFound:
            raise exceptions.NotFound from None
        except PhotoStorageError:
            raise PhotoStorageUnavailable from None
        return _uncached(Response(_photo_body(request, self.child, photo)))

    def delete(self, request, child_id):
        try:
            photos.delete_photo(request.user, self.child.pk)
        except services.ChildProfileNotFound:
            raise exceptions.NotFound from None
        return Response(status=204)


class ChildPhotoContentView(ChildScopedAPIView):
    """The photo bytes, for clients with a bearer token (local stores, native apps).

    Never cached by a shared cache, never sniffed as anything but a JPEG.
    """

    def perform_content_negotiation(self, request, force=False):
        # An image client sends `Accept: image/*`; errors still answer in JSON.
        return super().perform_content_negotiation(request, force=True)

    def get(self, request, child_id):
        photo = photos.current_photo(self.child)
        if photo is None:
            raise exceptions.NotFound
        try:
            data = photos.read_photo(photo)
        except PhotoObjectMissing:
            raise exceptions.NotFound from None
        except PhotoStorageError:
            raise PhotoStorageUnavailable from None
        response = HttpResponse(data, content_type=photo.content_type)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        response["Content-Disposition"] = 'inline; filename="photo.jpg"'
        return response


# --- Companion choice (AMP-03; replaces Amplify `CompanionProfile`) -----------------------------


class CompanionWrite(serializers.Serializer):
    companionType = serializers.ChoiceField(choices=CompanionType.values)

    def validate(self, attrs):
        unknown = set(self.initial_data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError(
                {name: ["This field is not accepted."] for name in sorted(unknown)},
                code="unknown_field",
            )
        return attrs


def _companion_body(child) -> dict:
    if not child.companion_type:
        return {"companion": None}
    return {
        "companion": {
            "companionType": child.companion_type,
            "displayName": COMPANION_DISPLAY_NAMES[CompanionType(child.companion_type)],
            "chosenAt": child.companion_chosen_at.isoformat(),
        }
    }


class ChildCompanionView(ChildScopedAPIView):
    """GET the companion a child chose (`{"companion": null}` before they choose); PUT chooses.

    Idempotent: choosing the companion the child already has changes nothing (200); the first
    choice answers 201. Only an authored companion type is accepted, never a name.
    """

    def get(self, request, child_id):
        return Response(_companion_body(self.child))

    def put(self, request, child_id):
        body = CompanionWrite(data=request.data)
        body.is_valid(raise_exception=True)
        chosen = body.validated_data["companionType"]
        with transaction.atomic():
            try:
                child = services.lock_owned_child_profile(request.user, self.child.pk)
            except services.ChildProfileNotFound:
                raise exceptions.NotFound from None
            created = not child.companion_type
            if child.companion_type != chosen:
                child.companion_type = chosen
                child.companion_chosen_at = timezone.now()
                child.save(update_fields=["companion_type", "companion_chosen_at", "updated_at"])
        return Response(_companion_body(child), status=201 if created else 200)
