"""Who may use the catalog admin (LAI-0304; wired to Django Admin staff by LAI-0404).

Deny by default. The role comes from the Django Admin session's account (ADR-034, which amends
ADR-024 A4 for Django Admin only): an active staff account is `ADMIN`, an active staff superuser
is `SUPERUSER`, and anyone else, including every Cognito-authenticated parent, is `NONE`. API
authorization is unchanged and never reads these flags.

Roles mirror the Amplify groups (ADR-031): `Admins` view the catalog and edit catalog fields;
`Superusers` are Admins who may also delete, which stays closed until the content authoring
cutover because imported content is owned by the export.
"""

from enum import StrEnum

from django.http import HttpRequest

# Flipped by the cutover task (ADR-019 sub-decision 8 amendment), never by configuration.
CONTENT_AUTHORING_CUTOVER = False


class AdminRole(StrEnum):
    NONE = "none"
    ADMIN = "admin"
    SUPERUSER = "superuser"


def resolve_admin_role(request: HttpRequest) -> AdminRole:
    """The caller's catalog role, from the Django Admin session's account."""
    user = getattr(request, "user", None)
    if not (
        getattr(user, "is_authenticated", False)
        and getattr(user, "is_active", False)
        and getattr(user, "is_staff", False)
    ):
        return AdminRole.NONE
    return AdminRole.SUPERUSER if getattr(user, "is_superuser", False) else AdminRole.ADMIN


def can_view(request: HttpRequest) -> bool:
    return resolve_admin_role(request) in (AdminRole.ADMIN, AdminRole.SUPERUSER)


def can_edit_catalog_fields(request: HttpRequest) -> bool:
    return can_view(request)


def can_delete(request: HttpRequest) -> bool:
    return CONTENT_AUTHORING_CUTOVER and resolve_admin_role(request) is AdminRole.SUPERUSER
