"""Staff-only model preview for Django Admin (LAI-2200 AM-10; `docs/ASSET_LIBRARY.md` section 17).

Separate from gameplay delivery (`delivery.py`) on purpose: the gameplay route serves published
versions only, and an administrator needs to inspect a validated version before publishing it.
Nothing here changes a version or its definition.

The preview page embeds a preview token: a signed `{version id, staff account id, expiry}` that
lives `PREVIEW_TTL_SECONDS`. The viewer sends it in the `X-Asset-Preview-Token` header, never in a
URL, so it cannot reach an access log, a referrer or the browser history. The file route then
needs all of: an active staff session with `assets.view_assetversion` (or change), a token for
this version and this account that has not expired, a previewable status, a file within the
upload limit, and stored bytes that still match the recorded SHA-256. The bytes always come
through Django, in every storage mode, so no presigned or permanent storage URL is ever issued
for a preview and the bucket needs no CORS rule for it.
"""

import time
from dataclasses import dataclass

from django.core import signing
from django.urls import reverse
from django.utils.html import format_html

from .models import VersionStatus
from .validation import max_bytes_for

SALT = "lai.assets.preview.v1"
PREVIEW_TTL_SECONDS = 600
TOKEN_HEADER = "X-Asset-Preview-Token"  # noqa: S105 - a header name, not a secret

# Validated versions (before publishing) and anything that was published. A DRAFT has not been
# validated and a REJECTED version failed a check, so their bytes are never handed to a browser.
PREVIEWABLE = (VersionStatus.VALIDATED, VersionStatus.PUBLISHED, VersionStatus.RETIRED)


class PreviewRefused(Exception):
    """Why a version cannot be previewed: an error code, a safe message and an HTTP status."""

    def __init__(self, code: str, message: str, status: int):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def can_preview(user) -> bool:
    """Staff with read access to versions: the same rule as the version admin's view page."""
    has_perm = getattr(user, "has_perm", None)
    if not (has_perm and getattr(user, "is_active", False) and getattr(user, "is_staff", False)):
        return False
    return has_perm("assets.view_assetversion") or has_perm("assets.change_assetversion")


def refusal_for(version) -> PreviewRefused | None:
    """The reason this version cannot be previewed at all, or None."""
    if version.status not in PREVIEWABLE:
        return PreviewRefused(
            "not_previewable",
            f"A {version.get_status_display().lower()} version cannot be previewed.",
            409,
        )
    limit = max_bytes_for(version.family)
    if version.size_bytes > limit:
        return PreviewRefused(
            "too_large",
            f"The file is {version.size_bytes:,} bytes, over the {limit:,} byte limit.",
            413,
        )
    return None


@dataclass(frozen=True)
class PreviewToken:
    value: str
    expires_at: int  # unix seconds


def issue_token(version, user, *, now: float | None = None) -> PreviewToken:
    expires = int(time.time() if now is None else now) + PREVIEW_TTL_SECONDS
    payload = {"v": str(version.version_id), "u": str(user.pk), "e": expires}
    return PreviewToken(signing.dumps(payload, salt=SALT), expires)


def check_token(token: str, version, user, *, now: float | None = None) -> None:
    """Raise PreviewRefused unless `token` was issued for this version and this account and is
    still valid. A forged or mismatched token reads as missing; only a genuine one can expire."""
    try:
        payload = signing.loads(token or "", salt=SALT)
    except signing.BadSignature:
        raise _missing() from None
    if (
        not isinstance(payload, dict)
        or payload.get("v") != str(version.version_id)
        or payload.get("u") != str(user.pk)
        or not isinstance(payload.get("e"), int)
    ):
        raise _missing()
    if payload["e"] <= int(time.time() if now is None else now):
        raise PreviewRefused(
            "preview_expired", "This preview has expired. Reload the page to view the model.", 410
        )


def _missing() -> PreviewRefused:
    return PreviewRefused("not_found", "Not found.", 404)


def summary(version) -> list[tuple[str, str]]:
    """The facts shown beside the viewer, in display order."""
    asset = version.asset
    if version.status == VersionStatus.PUBLISHED and asset.default_version_id == version.pk:
        default = "Yes, unpinned references get this version"
    else:
        default = "No"
    findings = version.validation_report or []
    errors = sum(1 for finding in findings if finding.get("severity") == "error")
    if version.validated_at is None:
        validation = "Not validated"
    elif errors:
        validation = f"Failed ({errors} error(s))"
    else:
        warnings = len(findings)
        validation = f"Passed ({warnings} warning(s))" if warnings else "Passed"
    dimensions = version.dimensions or {}
    size = (
        " x ".join(f"{dimensions[axis]:g}" for axis in ("x", "y", "z")) + " m"
        if all(isinstance(dimensions.get(axis), int | float) for axis in ("x", "y", "z"))
        else "Unknown"
    )
    return [
        ("Asset", f"{asset.display_name or asset.asset_id} ({asset.asset_id})"),
        ("Version", f"{version.number} ({version.version_id})"),
        ("Format", version.get_format_display()),
        *_media_facts(version),
        ("File size", f"{version.size_bytes:,} bytes"),
        ("Validation", validation),
        ("Lifecycle", version.get_status_display()),
        ("Asset status", asset.get_status_display()),
        ("Default version", default),
        ("Animation clips", ", ".join(version.clips) or "None"),
        ("Bounding box", size),
    ]


def _media_facts(version) -> list[tuple[str, str]]:
    meta = version.metadata or {}
    if version.family == "image":
        return [("Image size", f"{meta.get('width', '?')} x {meta.get('height', '?')} pixels")]
    if version.family == "audio":
        return [
            ("Duration", f"{meta.get('durationSeconds', '?')} seconds"),
            ("Sample rate", f"{meta.get('sampleRate', '?')} Hz"),
            ("Channels", str(meta.get("channels", "?"))),
        ]
    return []


def file_preview_html(version) -> str:
    """The inline preview on the version page: a thumbnail, a player, or the 3D link.

    The `src` is always our own staff-only media route. Names and metadata are escaped by
    `format_html`; the file's bytes are never inserted into the page.
    """
    if version.family == "model":
        return link_for(version)
    if refusal_for(version) is not None:
        return link_for(version)
    url = reverse("admin:assets_assetversion_media", args=[version.pk])
    meta = version.metadata or {}
    if version.family == "image":
        return format_html(
            '<img src="{}" alt="Preview of {}" width="{}" height="{}" '
            'style="max-width:320px;height:auto;background:#eee">'
            "<br>{} x {} pixels, {}, {} bytes",
            url,
            version.label,
            min(meta.get("width") or 320, 320),
            min(meta.get("height") or 320, 320),
            meta.get("width", "?"),
            meta.get("height", "?"),
            version.get_format_display(),
            f"{version.size_bytes:,}",
        )
    return format_html(
        '<audio controls preload="metadata" src="{}">Your browser cannot play this audio.</audio>'
        "<br>{} seconds, {} Hz, {} channel(s), {}, {} bytes",
        url,
        meta.get("durationSeconds", "?"),
        meta.get("sampleRate", "?"),
        meta.get("channels", "?"),
        version.get_format_display(),
        f"{version.size_bytes:,}",
    )


def link_for(version) -> str:
    """A link to the preview page, or why there is none (version and definition admins)."""
    if version is None:
        return "No version uploaded"
    if refusal_for(version) is not None:
        return f"Not previewable ({version.get_status_display().lower()})"
    url = reverse("admin:assets_assetversion_preview", args=[version.pk])
    noun = {"model": "in 3D", "image": "image", "audio": "audio"}[version.family]
    return format_html('<a href="{}">Preview v{} {}</a>', url, version.number, noun)
