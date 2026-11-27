"""Family accounts and child sessions (LAI-AUTH-01, ADR-NNN): domain rules and schema.

No route or authenticator uses these yet; the API-level tests (the LAI-0403 checklist, the
structural route allowlist) arrive with LAI-AUTH-02/03/04. Everything here is synthetic and
nothing contacts AWS or Cognito.
"""

import logging
from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.users import family_auth as fa
from apps.users import services
from apps.users.models import (
    ChildCredential,
    ChildCredentialStatus,
    ChildPin,
    ChildPlaySession,
    ChildProfile,
    ChildSessionSource,
    FamilyDevice,
)

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

ISSUER = "https://cognito-idp.us-test-1.amazonaws.com/us-test-1_CHILDPOOL"


@pytest.fixture
def t0():
    return timezone.now().replace(microsecond=0)


@pytest.fixture
def device_a(families, t0):
    value, device = fa.create_family_device(families.a, remembered=True, now=t0)
    return value, device


def make_credential(child, *, login="sky.rider", subject="child-sub-1", status="ACTIVE", **kw):
    return ChildCredential.objects.create(
        child=child,
        login_name=login,
        issuer=ISSUER if subject else "",
        subject=subject,
        status=status,
        **kw,
    )


@pytest.fixture
def consent(monkeypatch):
    """Stand-in for LAI-0308: tests that need the mode B success path grant consent here."""
    monkeypatch.setattr(fa, "child_login_consent_recorded", lambda child: True)


# --- PINs -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["123", "12345", "12a4", "", None, 1234, "١٢٣٤", " 1234"])
def test_a_pin_must_be_exactly_four_ascii_digits(families, bad):
    with pytest.raises(fa.PinInvalid):
        fa.set_pin(families.a, families.a1.id, bad)


def test_a_pin_is_stored_hashed_never_in_plain_text(families):
    row = fa.set_pin(families.a, families.a1.id, "4821")
    stored = ChildPin.objects.get(pk=row.pk).pin_hash
    assert "4821" not in stored
    assert stored.startswith("md5$")  # the test hasher; production uses Django's default


def test_a_parent_cannot_set_another_familys_childs_pin(families):
    with pytest.raises(services.ChildProfileNotFound):
        fa.set_pin(families.a, families.b1.id, "4821")
    assert not ChildPin.objects.filter(child=families.b1).exists()


def test_a_child_without_a_pin_needs_none(families):
    fa.check_pin(families.a1, None)


def test_a_child_with_a_pin_needs_it(families):
    fa.set_pin(families.a, families.a1.id, "4821")
    with pytest.raises(fa.PinRequired):
        fa.check_pin(families.a1, None)
    with pytest.raises(fa.PinIncorrect):
        fa.check_pin(families.a1, "0000")
    fa.check_pin(families.a1, "4821")


def test_wrong_pins_lock_the_profile_and_the_lockout_is_stored_in_the_database(
    families, settings, t0
):
    settings.LAI_CHILD_PIN_MAX_ATTEMPTS = 3
    settings.LAI_CHILD_PIN_LOCKOUT_SECONDS = 900
    fa.set_pin(families.a, families.a1.id, "4821")
    for _ in range(2):
        with pytest.raises(fa.PinIncorrect):
            fa.check_pin(families.a1, "1111", now=t0)
    with pytest.raises(fa.PinLocked):
        fa.check_pin(families.a1, "1111", now=t0)
    # The right PIN is refused while locked: the count is in PostgreSQL, not a worker's memory.
    fresh_child = ChildProfile.objects.get(pk=families.a1.pk)
    with pytest.raises(fa.PinLocked):
        fa.check_pin(fresh_child, "4821", now=t0 + timedelta(seconds=899))
    fa.check_pin(fresh_child, "4821", now=t0 + timedelta(seconds=901))


def test_a_lockout_on_one_sibling_does_not_lock_the_other(families, settings, t0):
    settings.LAI_CHILD_PIN_MAX_ATTEMPTS = 3
    fa.set_pin(families.a, families.a1.id, "4821")
    fa.set_pin(families.a, families.a2.id, "7302")
    for _ in range(3):
        with pytest.raises((fa.PinIncorrect, fa.PinLocked)):
            fa.check_pin(families.a1, "0000", now=t0)
    fa.check_pin(families.a2, "7302", now=t0)


def test_setting_a_new_pin_clears_a_lockout(families, settings, t0):
    settings.LAI_CHILD_PIN_MAX_ATTEMPTS = 3
    fa.set_pin(families.a, families.a1.id, "4821")
    for _ in range(3):
        with pytest.raises((fa.PinIncorrect, fa.PinLocked)):
            fa.check_pin(families.a1, "0000", now=t0)
    fa.set_pin(families.a, families.a1.id, "5555", now=t0)
    fa.check_pin(families.a1, "5555", now=t0)


def test_a_correct_pin_resets_the_failure_count(families, settings, t0):
    settings.LAI_CHILD_PIN_MAX_ATTEMPTS = 3
    fa.set_pin(families.a, families.a1.id, "4821")
    for _ in range(2):
        with pytest.raises(fa.PinIncorrect):
            fa.check_pin(families.a1, "0000", now=t0)
    fa.check_pin(families.a1, "4821", now=t0)
    assert ChildPin.objects.get(child=families.a1).failed_attempts == 0


def test_clearing_a_pin(families):
    fa.set_pin(families.a, families.a1.id, "4821")
    assert fa.clear_pin(families.a, families.a1.id) is True
    assert not fa.has_pin(families.a1)


# --- Family devices and mode A sessions ----------------------------------------------------------


def test_a_device_stores_only_a_digest_and_has_the_configured_lifetime(families, settings, t0):
    value, device = fa.create_family_device(families.a, remembered=True, now=t0)
    assert value not in device.token_hash and len(device.token_hash) == 64
    assert device.expires_at == t0 + timedelta(seconds=settings.LAI_FAMILY_DEVICE_REMEMBER_SECONDS)
    _, short = fa.create_family_device(families.a, remembered=False, now=t0)
    assert short.expires_at == t0 + timedelta(seconds=settings.LAI_FAMILY_DEVICE_SESSION_SECONDS)


def test_a_device_lists_only_its_parents_active_children(families, device_a):
    services.update_child_profile(families.a, families.a2.id, active=False)
    _, device = device_a
    assert [c.id for c in fa.device_profiles(device)] == [families.a1.id]


@pytest.mark.parametrize("value", [None, "", "short", "x" * 200, "not-a-real-device-value-123"])
def test_an_unknown_or_malformed_device_value_names_no_device(families, device_a, value):
    assert fa.device_for_value(value) is None


def test_a_device_value_round_trips(device_a):
    value, device = device_a
    assert fa.device_for_value(value).pk == device.pk


def test_a_device_expires(device_a, settings, t0):
    value, _ = device_a
    later = t0 + timedelta(seconds=settings.LAI_FAMILY_DEVICE_REMEMBER_SECONDS + 1)
    assert fa.device_for_value(value, now=later) is None


def test_a_device_dies_with_its_parent_account(families, device_a):
    value, _ = device_a
    families.a.is_active = False
    families.a.save(update_fields=["is_active"])
    assert fa.device_for_value(value) is None


def test_a_device_opens_a_session_for_its_own_child_only(families, device_a, t0):
    _, device = device_a
    _value, session = fa.start_session_from_device(device, families.a1.id, now=t0)
    assert (session.child_id, session.parent_id) == (families.a1.id, families.a.id)
    assert session.source == ChildSessionSource.FAMILY_DEVICE
    for other in (families.b1.id, "not-a-uuid", "00000000-0000-0000-0000-000000000000"):
        with pytest.raises(fa.ProfileUnavailable):
            fa.start_session_from_device(device, other, now=t0)


def test_an_inactive_child_gets_the_same_answer_as_another_familys(families, device_a):
    services.update_child_profile(families.a, families.a2.id, active=False)
    _, device = device_a
    with pytest.raises(fa.ProfileUnavailable):
        fa.start_session_from_device(device, families.a2.id)


def test_a_pin_protected_child_needs_the_pin_on_the_device(families, device_a):
    _, device = device_a
    fa.set_pin(families.a, families.a1.id, "4821")
    with pytest.raises(fa.PinRequired):
        fa.start_session_from_device(device, families.a1.id)
    with pytest.raises(fa.PinIncorrect):
        fa.start_session_from_device(device, families.a1.id, "1111")
    _, session = fa.start_session_from_device(device, families.a1.id, "4821")
    assert session.child_id == families.a1.id


def test_switching_sibling_ends_the_previous_childs_session(families, device_a, t0):
    _, device = device_a
    first, _ = fa.start_session_from_device(device, families.a1.id, now=t0)
    second, session = fa.start_session_from_device(device, families.a2.id, now=t0)
    assert fa.session_for_value(first, now=t0) is None
    assert fa.session_for_value(second, now=t0).child_id == families.a2.id


def test_a_revoked_device_cannot_open_sessions_and_its_sessions_end(families, device_a, t0):
    value, device = device_a
    session_value, _ = fa.start_session_from_device(device, families.a1.id, now=t0)
    assert fa.revoke_family_device(families.a, device.id, now=t0) is True
    assert fa.device_for_value(value, now=t0) is None
    assert fa.session_for_value(session_value, now=t0) is None
    device.refresh_from_db()
    with pytest.raises(fa.ProfileUnavailable):
        fa.start_session_from_device(device, families.a1.id, now=t0)


def test_a_parent_cannot_revoke_another_familys_device(families, device_a):
    _, device = device_a
    assert fa.revoke_family_device(families.b, device.id) is False
    device.refresh_from_db()
    assert device.revoked_at is None


def test_signing_out_every_device(families, t0):
    v1, d1 = fa.create_family_device(families.a, remembered=True, now=t0)
    v2, d2 = fa.create_family_device(families.a, remembered=False, now=t0)
    vb, _ = fa.create_family_device(families.b, remembered=True, now=t0)
    s1, _ = fa.start_session_from_device(d1, families.a1.id, now=t0)
    assert fa.revoke_all_family_devices(families.a, now=t0) == 2
    assert fa.device_for_value(v1, now=t0) is None and fa.device_for_value(v2, now=t0) is None
    assert fa.session_for_value(s1, now=t0) is None
    assert fa.device_for_value(vb, now=t0) is not None  # another family is untouched


# --- Child session lifecycle ----------------------------------------------------------------------


@pytest.fixture
def session_a1(families, device_a, t0):
    _, device = device_a
    return fa.start_session_from_device(device, families.a1.id, now=t0)


def test_a_session_stores_only_a_digest(session_a1):
    value, session = session_a1
    assert value not in session.token_hash and len(session.token_hash) == 64


def test_a_session_has_an_absolute_lifetime(session_a1, settings, t0):
    value, _ = session_a1
    settings.LAI_CHILD_SESSION_IDLE_SECONDS = settings.LAI_CHILD_SESSION_MAX_SECONDS
    step = timedelta(seconds=settings.LAI_CHILD_SESSION_MAX_SECONDS - 1)
    assert fa.session_for_value(value, now=t0 + step) is not None
    assert fa.session_for_value(value, now=t0 + step + timedelta(seconds=2)) is None


def test_an_idle_session_expires_and_use_keeps_it_alive(session_a1, settings, t0):
    value, _ = session_a1
    idle = settings.LAI_CHILD_SESSION_IDLE_SECONDS
    assert fa.session_for_value(value, now=t0 + timedelta(seconds=idle - 10)) is not None
    # That use moved `last_seen_at`, so the session lives another idle period from there.
    assert fa.session_for_value(value, now=t0 + timedelta(seconds=2 * idle - 20)) is not None
    assert fa.session_for_value(value, now=t0 + timedelta(seconds=3 * idle)) is None


def test_explicit_logout_ends_the_session(session_a1, t0):
    value, session = session_a1
    fa.end_session(session, now=t0)
    assert fa.session_for_value(value, now=t0) is None


def test_deactivating_the_child_or_parent_ends_the_session(families, session_a1):
    value, _ = session_a1
    services.update_child_profile(families.a, families.a1.id, active=False)
    assert fa.session_for_value(value) is None
    services.update_child_profile(families.a, families.a1.id, active=True)
    assert fa.session_for_value(value) is not None
    families.a.is_active = False
    families.a.save(update_fields=["is_active"])
    assert fa.session_for_value(value) is None


def test_the_parent_can_end_one_childs_sessions_but_not_another_familys(families, session_a1):
    value, _ = session_a1
    with pytest.raises(services.ChildProfileNotFound):
        fa.revoke_child_sessions(families.b, families.a1.id)
    assert fa.session_for_value(value) is not None
    assert fa.revoke_child_sessions(families.a, families.a1.id) == 1
    assert fa.session_for_value(value) is None


def test_session_csrf_is_bound_to_the_session(families, device_a, t0):
    _, device = device_a
    _, one = fa.start_session_from_device(device, families.a1.id, now=t0)
    _, two = fa.start_session_from_device(device, families.a2.id, now=t0)
    assert fa.session_csrf_matches(one, fa.session_csrf_token(one))
    assert not fa.session_csrf_matches(one, fa.session_csrf_token(two))
    assert not fa.session_csrf_matches(one, None)
    assert not fa.session_csrf_matches(one, "")


# --- Mode B: independent child credentials --------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("Sky.Rider", "sky.rider"), ("  mo_42 ", "mo_42"), ("a-b-c-d", "a-b-c-d")],
)
def test_login_names_are_normalized(raw, expected):
    assert fa.validate_login_name(raw) == expected


@pytest.mark.parametrize(
    "bad", ["abc", "x" * 21, ".dot", "has space", "émile", "a@b.com", "", None, 12345]
)
def test_bad_login_names_are_refused(bad):
    with pytest.raises(fa.LoginNameInvalid):
        fa.validate_login_name(bad)


def test_a_login_name_may_not_be_the_childs_nickname():
    with pytest.raises(fa.LoginNameInvalid):
        fa.validate_login_name("Robin", nickname="robin")


def test_login_names_are_unique_case_insensitively(families):
    make_credential(families.a1, login="sky.rider", subject="s-1")
    with pytest.raises(IntegrityError), transaction.atomic():
        ChildCredential.objects.create(
            child=families.b1, login_name="SKY.RIDER".lower(), issuer=ISSUER, subject="s-2"
        )


def test_a_revoked_login_name_can_be_reused(families):
    make_credential(families.a1, login="sky.rider", subject="s-1", status="REVOKED")
    make_credential(families.b1, login="sky.rider", subject="s-2")


def test_a_cognito_identity_maps_to_one_child_only(families):
    make_credential(families.a1, login="first.one", subject="same-sub")
    with pytest.raises(IntegrityError), transaction.atomic():
        make_credential(families.b1, login="second.one", subject="same-sub")


def test_a_child_has_at_most_one_live_credential(families):
    make_credential(families.a1, login="first.one", subject="s-1")
    with pytest.raises(IntegrityError), transaction.atomic():
        make_credential(families.a1, login="second.one", subject="s-2")


def test_an_active_credential_must_have_a_cognito_identity(families):
    with pytest.raises(IntegrityError), transaction.atomic():
        make_credential(families.a1, subject="", status="ACTIVE")
    make_credential(families.a1, subject="", status="PROVISIONING")


def test_the_login_name_format_is_enforced_by_the_database(families):
    with pytest.raises(IntegrityError), transaction.atomic():
        make_credential(families.a1, login="Has Space")


def test_an_identity_is_found_by_issuer_and_subject_only(families):
    credential = make_credential(families.a1, subject="s-1")
    assert fa.credential_for_identity(ISSUER, "s-1").pk == credential.pk
    assert fa.credential_for_identity("https://cognito-idp.x.amazonaws.com/other", "s-1") is None
    assert fa.credential_for_identity(ISSUER, "") is None


def test_mode_b_fails_closed_until_consent_is_recorded(families, t0):
    credential = make_credential(families.a1)
    with pytest.raises(fa.ConsentRequired):
        fa.start_session_from_credential(credential, token_issued_at=int(t0.timestamp()), now=t0)
    assert not ChildPlaySession.objects.exists()


def test_both_modes_reach_the_same_child_profile(families, device_a, consent, t0):
    """Progress compatibility: one child id, whichever way the child got in."""
    _, device = device_a
    credential = make_credential(families.a1, tokens_valid_after=t0)
    _, from_device = fa.start_session_from_device(device, families.a1.id, now=t0)
    _, from_login = fa.start_session_from_credential(
        credential, token_issued_at=int(t0.timestamp()), now=t0
    )
    assert from_device.child_id == from_login.child_id == families.a1.id
    assert from_login.parent_id == families.a.id
    assert from_login.source == ChildSessionSource.CHILD_LOGIN


@pytest.mark.parametrize("status", ["PROVISIONING", "SUSPENDED", "REVOKED"])
def test_only_an_active_credential_opens_a_session(families, consent, t0, status):
    credential = make_credential(families.a1, status=status)
    with pytest.raises(fa.CredentialUnavailable):
        fa.start_session_from_credential(credential, token_issued_at=int(t0.timestamp()), now=t0)


@pytest.mark.parametrize("iat", [None, True, "1700000000", 1.5])
def test_a_token_without_a_whole_issue_time_is_refused(families, consent, t0, iat):
    credential = make_credential(families.a1, tokens_valid_after=t0 - timedelta(days=1))
    with pytest.raises(fa.CredentialUnavailable):
        fa.start_session_from_credential(credential, token_issued_at=iat, now=t0)


def test_suspension_ends_sessions_and_refuses_older_tokens(families, consent, t0):
    credential = make_credential(families.a1, tokens_valid_after=t0 - timedelta(hours=1))
    issued = int((t0 - timedelta(minutes=5)).timestamp())
    value, _ = fa.start_session_from_credential(credential, token_issued_at=issued, now=t0)
    fa.suspend_credential(families.a, families.a1.id, now=t0)
    assert fa.session_for_value(value, now=t0) is None
    credential.refresh_from_db()
    with pytest.raises(fa.CredentialUnavailable):
        fa.start_session_from_credential(credential, token_issued_at=issued, now=t0)
    # Resuming does not revive a token from before the suspension.
    later = t0 + timedelta(minutes=1)
    fa.resume_credential(families.a, families.a1.id, now=later)
    credential.refresh_from_db()
    with pytest.raises(fa.CredentialUnavailable):
        fa.start_session_from_credential(credential, token_issued_at=issued, now=later)
    fresh = int((later + timedelta(seconds=1)).timestamp())
    assert fa.start_session_from_credential(credential, token_issued_at=fresh, now=later)


def test_a_password_reset_ends_sessions_and_refuses_older_tokens(families, consent, t0):
    credential = make_credential(families.a1, tokens_valid_after=t0 - timedelta(hours=1))
    issued = int((t0 - timedelta(minutes=5)).timestamp())
    value, _ = fa.start_session_from_credential(credential, token_issued_at=issued, now=t0)
    fa.record_password_reset(families.a, families.a1.id, now=t0)
    assert fa.session_for_value(value, now=t0) is None
    credential.refresh_from_db()
    with pytest.raises(fa.CredentialUnavailable):
        fa.start_session_from_credential(credential, token_issued_at=issued, now=t0)


def test_a_session_from_a_suspended_credential_dies_even_if_not_revoked(families, consent, t0):
    """Defence in depth: the status is checked on every use, not only at revocation."""
    credential = make_credential(families.a1, tokens_valid_after=t0 - timedelta(hours=1))
    value, _ = fa.start_session_from_credential(
        credential, token_issued_at=int(t0.timestamp()), now=t0
    )
    ChildCredential.objects.filter(pk=credential.pk).update(status="SUSPENDED")
    assert fa.session_for_value(value, now=t0) is None


def test_a_parent_cannot_manage_another_familys_credential(families):
    make_credential(families.a1)
    for action in (fa.suspend_credential, fa.revoke_credential, fa.record_password_reset):
        with pytest.raises(services.ChildProfileNotFound):
            action(families.b, families.a1.id)
    assert ChildCredential.objects.get(child=families.a1).status == ChildCredentialStatus.ACTIVE


def test_revoking_a_credential_keeps_the_profile(families, consent, t0):
    credential = make_credential(families.a1, tokens_valid_after=t0 - timedelta(hours=1))
    fa.revoke_credential(families.a, families.a1.id, now=t0)
    credential.refresh_from_db()
    assert credential.status == ChildCredentialStatus.REVOKED
    assert ChildProfile.objects.filter(pk=families.a1.pk, active=True).exists()
    assert fa.credential_for_identity(ISSUER, credential.subject) is None


# --- Schema and existing profiles ----------------------------------------------------------------


def test_a_session_must_match_its_source(families, device_a, t0):
    _, device = device_a
    base = {
        "child": families.a1,
        "parent": families.a,
        "expires_at": t0 + timedelta(hours=1),
        "created_at": t0,
    }
    with pytest.raises(IntegrityError), transaction.atomic():
        ChildPlaySession.objects.create(source="CHILD_LOGIN", token_hash="a" * 64, **base)
    with pytest.raises(IntegrityError), transaction.atomic():
        ChildPlaySession.objects.create(
            source="FAMILY_DEVICE", family_device=None, token_hash="b" * 64, **base
        )


def test_the_migration_only_adds_tables():
    """Existing parents, child ids and progress are untouched by construction."""
    from importlib import import_module

    from django.db import migrations

    migration = import_module("apps.users.migrations.0009_family_child_authentication").Migration
    new = {"familydevice", "childpin", "childcredential", "childplaysession"}
    created = {op.name.lower() for op in migration.operations if type(op) is migrations.CreateModel}
    assert created == new
    for op in migration.operations:
        if type(op) is migrations.CreateModel:
            continue
        # Indexes and constraints only, and only on the tables this migration creates.
        assert type(op) in {migrations.AddIndex, migrations.AddConstraint}, op
        assert op.model_name in new, op


def test_existing_profiles_need_nothing_to_use_family_login(families, device_a, t0):
    """A profile created before this change opens a session with no backfill or data change."""
    before = ChildProfile.objects.filter(pk=families.a1.pk).values().get()
    _, device = device_a
    fa.start_session_from_device(device, families.a1.id, now=t0)
    assert ChildProfile.objects.filter(pk=families.a1.pk).values().get() == before


def test_deleting_a_child_removes_its_pin_credential_and_sessions(families, device_a, t0):
    _, device = device_a
    fa.set_pin(families.a, families.a2.id, "4821")
    make_credential(families.a2)
    fa.start_session_from_device(device, families.a2.id, "4821", now=t0)
    ChildProfile.objects.filter(pk=families.a2.pk).delete()
    for model in (ChildPin, ChildCredential, ChildPlaySession):
        assert not model.objects.filter(child_id=families.a2.pk).exists()
    assert FamilyDevice.objects.filter(pk=device.pk).exists()


def test_reprs_carry_ids_only(families):
    credential = make_credential(families.a1, login="sky.rider")
    assert "sky.rider" not in repr(credential) and "sky.rider" not in str(credential)


def test_nothing_sensitive_is_logged(families, consent, caplog, t0):
    caplog.set_level(logging.DEBUG)
    value, device = fa.create_family_device(families.a, remembered=True, now=t0)
    fa.set_pin(families.a, families.a1.id, "4821")
    with pytest.raises(fa.PinIncorrect):
        fa.start_session_from_device(device, families.a1.id, "1111", now=t0)
    session_value, _ = fa.start_session_from_device(device, families.a1.id, "4821", now=t0)
    fa.session_for_value(session_value, now=t0)
    text = caplog.text
    for secret in (value, session_value, "4821", "1111", str(families.a1.id), families.a1.nickname):
        assert secret not in text
