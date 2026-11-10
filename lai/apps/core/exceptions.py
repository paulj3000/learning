"""The API error contract (docs/ARCHITECTURE.md, "API conventions").

    {"error": {"code": "validation_error", "message": "Invalid request.", "details": {...}},
     "request_id": "..."}

Messages are fixed strings chosen here, never the text of a raised exception, so internal
detail cannot leak. Only `details` for validation errors carries per-field messages and codes.

Boundary: `api_exception_handler` runs only for exceptions raised inside a DRF view. Errors
raised outside it (URL resolution, middleware, host validation, unexpected crashes) are answered
by the Django-level JSON handlers at the bottom of this file, wired in `config/urls.py`.
"""

from django.http import JsonResponse
from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .request_context import get_request_id

# (code, safe message) by exception class, most specific first.
_KNOWN = [
    (exceptions.ValidationError, "validation_error", "Invalid request."),
    (exceptions.ParseError, "parse_error", "The request body could not be read."),
    (exceptions.AuthenticationFailed, "authentication_failed", "Authentication failed."),
    (exceptions.NotAuthenticated, "not_authenticated", "Authentication is required."),
    (exceptions.PermissionDenied, "permission_denied", "You do not have permission."),
    (exceptions.NotFound, "not_found", "Not found."),
    (exceptions.MethodNotAllowed, "method_not_allowed", "Method not allowed."),
    (exceptions.NotAcceptable, "not_acceptable", "Not acceptable."),
    (exceptions.UnsupportedMediaType, "unsupported_media_type", "Unsupported media type."),
    (exceptions.Throttled, "throttled", "Too many requests."),
]
# Errors with their own stable code, declared by the exception class (`default_code`).
_CODED = {
    "account_not_provisioned": "Account setup is required.",
    "sensitive_action_unavailable": "This action is not available.",
    "authentication_unavailable": "Authentication is temporarily unavailable.",
    # Recent sign-in verification (LAI-0209)
    "recent_auth_required": "Please confirm your sign-in to continue.",
    "recent_auth_unavailable": "Sign-in confirmation is temporarily unavailable.",
    "child_deletion_incomplete": "The profile could not be fully deleted yet. Please try again.",
    # Adventure answers (LAI-0601)
    "answer_invalid": "That answer could not be understood.",
    "session_not_active": "This adventure is no longer active.",
    "step_not_current": "That step is not the current one.",
    "content_version_changed": "This adventure has changed since it was started.",
    "request_conflict": "That request id was already used for a different answer.",
    "invalid_transition": "That change is not allowed right now.",
    # Region play (Treasure Rush TR-5)
    "content_unavailable": "This is not available right now.",
    "session_not_open": "This play session has ended.",
    "chest_already_open": "This chest is already open.",
    "attempt_already_answered": "This challenge was already answered.",
    "quest_unavailable": "This quest is not available.",
    # 3D Area puzzles (ADR-047, LAI-0812)
    "puzzle_locked": "Finish the earlier part of the adventure first.",
    # Pip's Missing Treasure (TR-14)
    "chest_locked": "This chest is still locked.",
    # Native Android API (LAI-ANDROID-API-001)
    "child_profile_limit_reached": "No more child profiles can be added.",
    "child_inactive": "This child profile is turned off.",
    "launch_ticket_invalid": "This game link has expired. Please start again.",
    "game_csrf_failed": "This request could not be verified.",
    # Child profile photos (LAI-0904)
    "photo_invalid": "That photo could not be read. Please choose a different one.",
    "photo_dimensions": "That photo is too big. Please choose a smaller one.",
    "photo_too_large": "That photo file is too large.",
    "photo_type_unsupported": "Only JPEG photos are accepted.",
    "photo_storage_unavailable": "Photos are not available right now. Please try again later.",
    # Household co-op (AMP-05)
    "partner_invalid": "Choose another one of your children to play with.",
    "adventure_invalid": "This adventure cannot be shared by these children.",
    "slot_invalid": "That step cannot be shared.",
    "coop_session_not_active": "This shared adventure is no longer active.",
    # Asset library administrator API (AM-14)
    "asset_too_large": "That file is larger than the upload limit.",
    # Amplify Data exit (AMP-03): account deletion and per-child state outside region play
    "account_deletion_incomplete": "The account could not be fully deleted yet. Please try again.",
    "staff_account_not_deletable": "This account is managed in the administration site.",
    "story_scene_rejected": "That story could not be saved.",
    "chapter_not_finished": "This chapter is not finished yet.",
    "chapter_not_current": "That chapter is not the current one.",
    "unknown_chapter": "That chapter is not part of this story.",
    "unknown_choice": "That choice is not part of this story.",
    "unknown_scene": "That scene is not part of this story.",
    "unknown_dialogue_node": "That is not something this character says.",
    "unknown_character": "That character is not on the island.",
    "invalid_source": "That source is not accepted.",
    "world_change_limit": "No more changes can be recorded.",
}
_PASSTHROUGH_HEADERS = {"Allow", "WWW-Authenticate", "Retry-After"}


def error_body(code: str, message: str, details=None) -> dict:
    body: dict = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    request_id = get_request_id()
    if request_id:
        body["request_id"] = request_id
    return body


def _validation_details(exc: exceptions.ValidationError):
    details = exc.get_full_details()  # {field: [{"message", "code"}]} or a list
    if isinstance(details, dict):
        return details
    return {"non_field_errors": details}


def api_exception_handler(exc, context):
    """DRF exception handler: same statuses and headers as DRF, our body."""
    response = exception_handler(exc, context)
    if response is None:
        return None  # not an API error: let Django log it and answer with `server_error`
    code, message = "error", "Request failed."
    for cls, known_code, known_message in _KNOWN:
        if isinstance(exc, cls):
            code, message = known_code, known_message
            break
    own_code = getattr(type(exc), "default_code", None)  # a subclass's own code wins
    if own_code in _CODED:
        code, message = own_code, _CODED[own_code]
    details = _validation_details(exc) if isinstance(exc, exceptions.ValidationError) else None
    headers = {name: value for name, value in response.items() if name in _PASSTHROUGH_HEADERS}
    return Response(
        error_body(code, message, details), status=response.status_code, headers=headers
    )


def _json_error(status: int, code: str, message: str) -> JsonResponse:
    return JsonResponse(error_body(code, message), status=status)


def bad_request(request, exception=None):
    return _json_error(400, "bad_request", "Bad request.")


def permission_denied(request, exception=None):
    return _json_error(403, "permission_denied", "You do not have permission.")


def not_found(request, exception=None):
    return _json_error(404, "not_found", "Not found.")


def server_error(request):
    return _json_error(500, "server_error", "Something went wrong.")
