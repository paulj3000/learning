"""Game-only WebView launches (LAI-ANDROID-API-001, ADR-036). Flow and threat model:
docs/android/ANDROID_GAME_LAUNCH.md.

1. The native app asks to launch (bearer token): the child must be the parent's, active, and
   allowed the region (`discovery.visible_region`). The answer is an opaque ticket that lives
   `LAI_GAME_TICKET_TTL_SECONDS`.
2. The native app redeems the ticket (bearer token again, same parent) and receives the game
   session cookie, which it hands to the WebView's cookie store. Redemption is one conditional
   UPDATE, so a ticket is consumed exactly once even under concurrent requests, and every check
   from step 1 runs again.
3. The game runtime, loaded in the WebView, calls the game routes with that cookie. It is valid
   for one child and one region until it expires, is revoked, or the parent or child is
   deactivated.

Tickets and cookie values are 256-bit random strings; only their SHA-256 is stored. Neither is
ever logged. No Cognito token reaches the WebView.
"""

import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.users import services as user_services

from . import discovery
from .models import GameBrowserSession, GameLaunchTicket


class LaunchError(Exception):
    code = "launch_error"


class ChildInactive(LaunchError):
    code = "child_inactive"


class TicketInvalid(LaunchError):
    """Unknown, expired, already used, revoked, or another parent's: one answer for all."""

    code = "launch_ticket_invalid"


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("ascii", "ignore")).hexdigest()


def _now(now=None):
    return now or timezone.now()


def create_launch(parent, child, region_id: str, *, now=None) -> tuple[str, GameLaunchTicket]:
    """A new ticket for `child` (already resolved through `parent`) to play `region_id`."""
    if not child.active:
        raise ChildInactive
    region = discovery.visible_region(child, region_id)  # RegionNotVisible
    at = _now(now)
    ticket = secrets.token_urlsafe(32)
    row = GameLaunchTicket.objects.create(
        child=child,
        parent=parent,
        region_id=region.region_id,
        ticket_hash=_digest(ticket),
        created_at=at,
        expires_at=at + timedelta(seconds=settings.LAI_GAME_TICKET_TTL_SECONDS),
    )
    return ticket, row


def redeem_ticket(parent, ticket: str, *, now=None) -> tuple[str, GameBrowserSession]:
    """Consume `ticket` once for `parent` and open the game session it grants.

    Returns (cookie value, session). Any other parent's ticket, or a replay, is `TicketInvalid`.
    The parent's earlier game sessions are revoked: one WebView, one live game session.
    """
    if not isinstance(ticket, str) or not 20 <= len(ticket) <= 128:
        raise TicketInvalid
    at = _now(now)
    digest = _digest(ticket)
    # Claimed and committed on its own: a ticket that fails a later check stays used.
    claimed = GameLaunchTicket.objects.filter(
        ticket_hash=digest, parent=parent, consumed_at__isnull=True, expires_at__gt=at
    ).update(consumed_at=at)
    if claimed != 1:
        raise TicketInvalid
    row = GameLaunchTicket.objects.get(ticket_hash=digest)
    try:
        child = user_services.get_owned_child_profile(parent, row.child_id)
        discovery.visible_region(child, row.region_id)
    except (user_services.ChildProfileNotFound, discovery.RegionNotVisible):
        raise TicketInvalid from None
    if not child.active:
        raise TicketInvalid
    with transaction.atomic():
        GameBrowserSession.objects.filter(parent=parent, revoked_at__isnull=True).update(
            revoked_at=at
        )
        value = secrets.token_urlsafe(32)
        session = GameBrowserSession.objects.create(
            child=child,
            parent=parent,
            region_id=row.region_id,
            token_hash=_digest(value),
            ticket=row,
            created_at=at,
            expires_at=at + timedelta(seconds=settings.LAI_GAME_SESSION_TTL_SECONDS),
        )
    return value, session


def session_for_cookie(value: str, *, now=None) -> GameBrowserSession | None:
    """The live session a cookie value names, or None. Re-checks parent and child every time."""
    if not value or len(value) > 128:
        return None
    session = (
        GameBrowserSession.objects.select_related("parent", "child")
        .filter(token_hash=_digest(value), revoked_at__isnull=True, expires_at__gt=_now(now))
        .first()
    )
    if session is None or not session.parent.is_active or not session.child.active:
        return None
    if session.child.parent_id != session.parent_id:  # defence in depth; the FK cannot move
        return None
    return session


def csrf_token(session: GameBrowserSession) -> str:
    """The value the runtime must echo in `X-LAI-Game-CSRF` on every write. Derived, not stored."""
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, f"lai-game-csrf:{session.token_hash}".encode(), "sha256").hexdigest()


def csrf_matches(session: GameBrowserSession, presented: str | None) -> bool:
    return bool(presented) and hmac.compare_digest(csrf_token(session), presented)


def revoke_session(session: GameBrowserSession, *, now=None) -> None:
    GameBrowserSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
        revoked_at=_now(now)
    )


def revoke_all(parent, *, now=None) -> int:
    """Native sign-out: end every live game session and void every unused ticket."""
    at = _now(now)
    with transaction.atomic():
        GameLaunchTicket.objects.filter(parent=parent, consumed_at__isnull=True).update(
            consumed_at=at
        )
        return GameBrowserSession.objects.filter(parent=parent, revoked_at__isnull=True).update(
            revoked_at=at
        )
