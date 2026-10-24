"""Who may use the catalog admin (LAI-0304; wired to real identities by LAI-0404).

Deny by default. ADR-024 gate A4 decides admin rights from the verified access token's
`cognito:groups` claim, never from a stored flag (`ParentAccount.is_staff` stays unused), and
Django Admin stays unmounted until LAI-0404 builds that gate. Until then nothing sets
`request.catalog_admin_role`, so every request resolves to `NONE` and is refused.

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
    """The caller's catalog role. LAI-0404 sets the attribute from the verified token."""
    role = getattr(request, "catalog_admin_role", AdminRole.NONE)
    return role if isinstance(role, AdminRole) else AdminRole.NONE


def can_view(request: HttpRequest) -> bool:
    return resolve_admin_role(request) in (AdminRole.ADMIN, AdminRole.SUPERUSER)


def can_edit_catalog_fields(request: HttpRequest) -> bool:
    return can_view(request)


def can_delete(request: HttpRequest) -> bool:
    return CONTENT_AUTHORING_CUTOVER and resolve_admin_role(request) is AdminRole.SUPERUSER
