"""Independent child sign-in end to end (ADR-075): provisioning, exchange, sessions, isolation.

Everything runs against local keys and the in-memory child pool (mocked Cognito); nothing
contacts AWS. Children and parents come from the shared `families` fixture (two families, two
children each), so sibling and cross-family cases are always tested together.
"""

import logging
import time
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.users import child_auth
from apps.users.models import (
    ChildAccountEvent,
    ChildCredential,
    ChildCredentialStatus,
    ChildDevice,
    ChildPlaySession,
    ChildProfile,
    ParentConsent,
)
from apps.users.tests.conftest import CONSENT_VERSION, PASSWORD

pytestmark = pytest.mark.django_db

SESSION = "/api/v1/child-auth/session/"
RESTORE = "/api/v1/child-auth/session/restore/"
END = "/api/v1/child-auth/session/end/"


def sign_in_url(child):
    return f"/api/v1/children/{child.pk}/sign-in/"


def consent_url(child):
    return f"/api/v1/children/{child.pk}/consents/child-sign-in/"


def child_url(child, suffix=""):
    return f"/api/v1/children/{child.pk}/{suffix}"


def csrf_of(client):
    return client.get(SESSION).json()["csrfToken"]


# --- parent provisioning -------------------------------------------------------------------------


class TestProvisioning:
    def test_parent_enables_sign_in_for_an_existing_child_without_a_new_profile(
        self, families, api, child_pool
    ):
        profiles_before = set(ChildProfile.objects.values_list("pk", flat=True))
        parent = api(families.a)
        assert parent.post(consent_url(families.a1)).status_code == 201
        response = parent.post(
            sign_in_url(families.a1),
            {"username": "Zinnia01", "password": PASSWORD},
            content_type="application/json",
        )
        assert response.status_code == 201, response.content
        body = response.json()
        assert body["signIn"]["status"] == "ACTIVE"
        assert body["signIn"]["username"] == "zinnia01"  # normalized
        assert PASSWORD not in response.content.decode()
        assert set(ChildProfile.objects.values_list("pk", flat=True)) == profiles_before
        credential = ChildCredential.objects.get(child=families.a1)
        assert credential.subject and credential.issuer == child_pool.issuer
        assert credential.provider_username.startswith("c-")
        assert credential.provider_username != credential.login_name
        assert child_pool.provider.users[credential.provider_username].login_name == "zinnia01"

    def test_consent_comes_first(self, families, api, child_pool):
        response = api(families.a).post(
            sign_in_url(families.a1),
            {"username": "zinnia01", "password": PASSWORD},
            content_type="application/json",
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "consent_required"
        assert child_pool.provider.users == {}

    def test_no_approved_consent_text_means_nobody_can_consent(
        self, families, api, settings, child_pool
    ):
        settings.LAI_CHILD_SIGN_IN_CONSENT_VERSION = ""
        response = api(families.a).post(consent_url(families.a1))
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "consent_unavailable"

    @pytest.mark.parametrize(
        "method,suffix,body",
        [
            ("post", "consents/child-sign-in/", None),
            ("post", "sign-in/", {"username": "zinnia01", "password": PASSWORD}),
            ("post", "sign-in/password/", {"password": PASSWORD}),
            ("patch", "sign-in/", {"username": "zinnia02"}),
            ("post", "sign-in/resume/", None),
            ("delete", "sign-in/", None),
        ],
    )
    def test_granting_actions_need_a_recent_parent_sign_in(
        self, families, api, token_for, child_pool, method, suffix, body
    ):
        old = int(time.time()) - 3600
        client = api(token=token_for(families.a.cognito_sub, auth_time=old, iat=old + 10))
        response = getattr(client, method)(
            child_url(families.a1, suffix), body, content_type="application/json"
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "recent_auth_required"

    @pytest.mark.parametrize(
        "method,suffix",
        [
            ("get", "sign-in/"),
            ("post", "consents/child-sign-in/"),
            ("delete", "consents/child-sign-in/"),
            ("post", "sign-in/"),
            ("post", "sign-in/password/"),
            ("post", "sign-in/suspend/"),
            ("post", "sign-in/resume/"),
            ("post", "sign-in/sign-out-everywhere/"),
            ("get", "sign-in/devices/"),
            ("delete", "sign-in/"),
        ],
    )
    def test_another_family_cannot_see_or_manage_the_sign_in(
        self, families, api, provision, method, suffix
    ):
        provision(families.a, families.a1)
        response = getattr(api(families.b), method)(
            child_url(families.a1, suffix),
            {"username": "intruder1", "password": PASSWORD},
            content_type="application/json",
        )
        assert response.status_code == 404
        credential = ChildCredential.objects.get(child=families.a1)
        assert credential.status == ChildCredentialStatus.ACTIVE

    def test_usernames_are_validated_and_unique_case_insensitively(self, families, api, provision):
        provision(families.a, families.a1, username="zinnia01")
        parent = api(families.a)
        parent.post(consent_url(families.a2))
        for bad in ["abc", "a" * 21, "-dash", "has space", "zephyr-a2", "über1"]:
            response = parent.post(
                sign_in_url(families.a2),
                {"username": bad, "password": PASSWORD},
                content_type="application/json",
            )
            assert response.status_code == 400, bad
            assert response.json()["error"]["code"] == "login_name_invalid"
        response = parent.post(
            sign_in_url(families.a2),
            {"username": "ZINNIA01", "password": PASSWORD},
            content_type="application/json",
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "login_name_unavailable"

    @pytest.mark.parametrize("password", ["short1", "zinnia01-is-me", " leading-space", "x" * 65])
    def test_passwords_are_validated_and_never_echoed(self, families, api, child_pool, password):
        parent = api(families.a)
        parent.post(consent_url(families.a1))
        response = parent.post(
            sign_in_url(families.a1),
            {"username": "zinnia01", "password": password},
            content_type="application/json",
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "password_invalid"
        assert password not in response.content.decode()

    def test_the_request_body_is_closed(self, families, api, child_pool):
        parent = api(families.a)
        parent.post(consent_url(families.a1))
        response = parent.post(
            sign_in_url(families.a1),
            {"username": "zinnia01", "password": PASSWORD, "child": str(families.b1.pk)},
            content_type="application/json",
        )
        assert response.status_code == 400

    def test_a_second_enable_is_refused(self, families, api, provision):
        provision(families.a, families.a1)
        response = api(families.a).post(
            sign_in_url(families.a1),
            {"username": "zinnia09", "password": PASSWORD},
            content_type="application/json",
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "child_sign_in_exists"

    def test_a_pool_outage_leaves_a_retryable_state(self, families, api, child_pool):
        parent = api(families.a)
        parent.post(consent_url(families.a1))
        child_pool.provider.fail_next = "network"
        body = {"username": "zinnia01", "password": PASSWORD}
        response = parent.post(sign_in_url(families.a1), body, content_type="application/json")
        assert response.status_code == 503
        assert ChildCredential.objects.get(child=families.a1).status == "PROVISIONING"
        response = parent.post(sign_in_url(families.a1), body, content_type="application/json")
        assert response.status_code == 201
        assert ChildCredential.objects.filter(child=families.a1).count() == 1

    def test_a_disabled_provider_refuses_provisioning(self, families, api, settings, child_pool):
        settings.LAI_CHILD_IDENTITY_PROVIDER = "disabled"
        parent = api(families.a)
        parent.post(consent_url(families.a1))
        response = parent.post(
            sign_in_url(families.a1),
            {"username": "zinnia01", "password": PASSWORD},
            content_type="application/json",
        )
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "child_identity_unavailable"

    def test_audit_records_hold_action_codes_only(self, families, provision):
        provision(families.a, families.a1)
        events = list(ChildAccountEvent.objects.filter(child=families.a1))
        assert {e.action for e in events} == {"CONSENT_GRANTED", "SIGN_IN_ENABLED"}
        fields = {f.name for f in ChildAccountEvent._meta.get_fields()}
        assert fields == {"id", "child", "parent", "action", "occurred_at"}


# --- the exchange --------------------------------------------------------------------------------


class TestExchange:
    def test_a_child_signs_in_without_any_parent_token(self, families, provision, sign_in):
        credential = provision(families.a, families.a1)
        client, body = sign_in(credential)
        assert body["child"]["id"] == str(families.a1.pk)
        assert body["remembered"] is False
        cookie = client.cookies["lai_child_session"]
        assert cookie["httponly"] and cookie["samesite"] == "Strict"
        assert cookie["path"] == "/api/v1/"
        assert client.get(SESSION).json()["child"]["id"] == str(families.a1.pk)
        assert ChildPlaySession.objects.filter(child=families.a1).count() == 1

    def test_the_session_is_stored_only_as_a_digest(self, families, provision, sign_in):
        client, _ = sign_in(provision(families.a, families.a1))
        value = client.cookies["lai_child_session"].value
        session = ChildPlaySession.objects.get(child=families.a1)
        assert value not in {session.token_hash, str(session.pk)}
        assert len(session.token_hash) == 64

    @pytest.mark.parametrize(
        "overrides",
        [
            {"client_id": "test-client-id-0001"},  # the parent app client
            {"iss": "https://cognito-idp.us-test-1.amazonaws.com/us-test-1_TESTPOOL1"},
            {"token_use": "id"},
            {"exp": int(time.time()) - 120},
            {"client_id": "someone-elses-client"},
        ],
    )
    def test_mismatched_tokens_are_401(
        self, families, provision, child_pool, child_client, overrides
    ):
        credential = provision(families.a, families.a1)
        response = child_client().post(
            SESSION,
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {child_pool.token(credential, **overrides)}",
        )
        assert response.status_code == 401
        assert not ChildPlaySession.objects.exists()

    def test_a_token_signed_by_another_key_is_401(
        self, families, provision, child_pool, child_client
    ):
        from apps.users.tests.helpers import KeyPair

        credential = provision(families.a, families.a1)
        forged = child_pool.token(credential, key_pair=KeyPair("kid-child-1"))
        response = child_client().post(
            SESSION, {}, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {forged}"
        )
        assert response.status_code == 401

    def test_a_parent_token_cannot_open_a_child_session(
        self, families, provision, token_for, child_client
    ):
        provision(families.a, families.a1)
        response = child_client().post(
            SESSION,
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {token_for(families.a.cognito_sub)}",
        )
        assert response.status_code == 401

    @pytest.mark.parametrize(
        "overrides",
        [
            {"sub": "an-unknown-sub"},
            {"username": "zinnia01"},  # the login name is never the identity
            {"username": None},
            {"auth_time": int(time.time()) - 3600, "iat": int(time.time()) - 10},  # stale sign-in
            {"auth_time": None},
        ],
    )
    def test_identity_mismatches_get_one_calm_answer(
        self, families, provision, child_pool, child_client, overrides
    ):
        credential = provision(families.a, families.a1)
        response = child_client().post(
            SESSION,
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {child_pool.token(credential, **overrides)}",
        )
        assert response.status_code == 403
        error = response.json()["error"]
        assert error["code"] == "child_sign_in_unavailable"
        assert "grown-up" in error["message"]

    def test_suspended_inactive_or_unconsented_children_cannot_sign_in(
        self, families, provision, child_pool, child_client
    ):
        credential = provision(families.a, families.a1)
        token = child_pool.token(credential)

        def attempt():
            return (
                child_client()
                .post(
                    SESSION,
                    {},
                    content_type="application/json",
                    HTTP_AUTHORIZATION=f"Bearer {token}",
                )
                .status_code
            )

        child_auth.withdraw_sign_in_consent(families.a, families.a1.pk)
        assert attempt() == 403
        child_auth.grant_sign_in_consent(families.a, families.a1.pk)
        ChildProfile.objects.filter(pk=families.a1.pk).update(active=False)
        assert attempt() == 403
        ChildProfile.objects.filter(pk=families.a1.pk).update(active=True)
        child_auth.suspend_sign_in(families.a, families.a1.pk)
        assert attempt() == 403

    def test_a_token_from_before_a_password_reset_is_refused(
        self, families, provision, child_pool, child_client
    ):
        credential = provision(families.a, families.a1)
        old = child_pool.token(credential, auth_time=int(time.time()) - 30)
        child_auth.set_password(families.a, families.a1.pk, password="Brand-New-Pass9")
        response = child_client().post(
            SESSION, {}, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {old}"
        )
        assert response.status_code == 403

    def test_sign_in_is_rate_limited(
        self, families, provision, child_pool, child_client, settings, monkeypatch
    ):
        from apps.users.child_auth_views import ChildSignInThrottle

        monkeypatch.setattr(ChildSignInThrottle, "THROTTLE_RATES", {"child_sign_in": "3/min"})
        credential = provision(families.a, families.a1)
        statuses = [
            child_client()
            .post(
                SESSION,
                {},
                content_type="application/json",
                HTTP_AUTHORIZATION=f"Bearer {child_pool.token(credential)}",
            )
            .status_code
            for _ in range(5)
        ]
        assert statuses[:3] == [201, 201, 201]
        assert statuses[3:] == [429, 429]

    def test_nothing_sensitive_is_logged(self, families, provision, sign_in, caplog):
        caplog.set_level(logging.DEBUG)
        credential = provision(families.a, families.a1, username="zinnia01")
        client, _ = sign_in(credential, remember=True)
        child_client_token = client.cookies["lai_child_session"].value
        client.post(END, HTTP_X_LAI_CHILD_CSRF="wrong")
        text = caplog.text
        for secret in [
            PASSWORD,
            "zinnia01",
            str(families.a1.pk),
            families.a1.nickname,
            credential.subject,
            credential.provider_username,
            child_client_token,
        ]:
            assert secret not in text


# --- the child session as a credential -----------------------------------------------------------


class TestChildSession:
    def test_the_child_reaches_their_own_gameplay_and_progress(self, families, provision, sign_in):
        from apps.progression.models import WorldChange

        before = WorldChange.objects.filter(child=families.a1).count()
        client, _ = sign_in(provision(families.a, families.a1))
        assert client.get(child_url(families.a1)).status_code == 200
        response = client.get(child_url(families.a1, "world-changes/"))
        assert response.status_code == 200
        assert WorldChange.objects.filter(child=families.a1).count() == before

    @pytest.mark.parametrize("who", ["a2", "b1"])
    def test_a_sibling_or_another_family_is_404(self, families, provision, sign_in, who):
        client, _ = sign_in(provision(families.a, families.a1))
        other = getattr(families, who)
        for suffix in ["", "world-changes/", "home/", "inventory/", "rewards/", "skill-progress/"]:
            assert client.get(child_url(other, suffix)).status_code == 404, suffix

    @pytest.mark.parametrize(
        "method,path",
        [
            ("get", "/api/v1/me/"),
            ("get", "/api/v1/children/"),
            ("post", "/api/v1/children/"),
            ("patch", "{child}"),
            ("delete", "{child}"),
            ("get", "{child}sign-in/"),
            ("post", "{child}sign-in/password/"),
            ("post", "{child}sign-in/resume/"),
            ("post", "{child}consents/child-sign-in/"),
            ("delete", "{child}consents/child-sign-in/"),
            ("post", "{child}photo/"),
            ("post", "{child}game-launches/"),
            ("get", "{child}ai/safety-events/"),
            ("delete", "{child}ai/history/"),
            ("delete", "{child}world-state/"),
            ("delete", "{child}quests/"),
            ("patch", "{child}audio/settings/"),
            ("post", "{child}coop-sessions/"),
        ],
    )
    def test_parent_only_routes_never_accept_a_child_session(
        self, families, provision, sign_in, method, path
    ):
        client, body = sign_in(provision(families.a, families.a1))
        url = path.format(child=child_url(families.a1))
        response = getattr(client, method)(
            url, {}, content_type="application/json", HTTP_X_LAI_CHILD_CSRF=body["csrfToken"]
        )
        assert response.status_code == 401, (method, url)

    def test_a_child_token_is_never_a_bearer_token(self, families, provision, child_pool, api):
        credential = provision(families.a, families.a1)
        client = api(token=child_pool.token(credential))
        for url in ["/api/v1/me/", child_url(families.a1), child_url(families.a1, "home/")]:
            assert client.get(url).status_code == 401, url

    def test_writes_need_the_csrf_header_and_a_same_origin(self, families, provision, sign_in):
        client, body = sign_in(provision(families.a, families.a1))
        url = child_url(families.a1, "world-changes/")
        missing = client.post(url, {}, content_type="application/json")
        assert missing.status_code == 403
        assert missing.json()["error"]["code"] == "child_csrf_failed"
        foreign = client.post(
            url,
            {},
            content_type="application/json",
            HTTP_X_LAI_CHILD_CSRF=body["csrfToken"],
            HTTP_ORIGIN="https://evil.example",
        )
        assert foreign.status_code == 403
        ok = client.post(
            url, {}, content_type="application/json", HTTP_X_LAI_CHILD_CSRF=body["csrfToken"]
        )
        assert ok.status_code not in {401, 403}

    def test_a_planted_cookie_is_never_adopted(self, families, provision, child_pool, child_client):
        credential = provision(families.a, families.a1)
        client = child_client()
        planted = "attacker-chosen-value-0123456789abcdef"
        client.cookies["lai_child_session"] = planted
        assert client.get(SESSION).status_code == 401
        client.post(
            SESSION,
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {child_pool.token(credential)}",
        )
        assert client.cookies["lai_child_session"].value != planted
        assert child_auth.session_for_value(planted) is None

    def test_idle_and_absolute_expiry(self, families, provision, sign_in, settings):
        client, _ = sign_in(provision(families.a, families.a1))
        value = client.cookies["lai_child_session"].value
        now = timezone.now()
        assert child_auth.session_for_value(value, now=now) is not None
        idle = now + timedelta(seconds=settings.LAI_CHILD_SESSION_IDLE_SECONDS + 1)
        assert child_auth.session_for_value(value, now=idle) is None
        ChildPlaySession.objects.update(last_seen_at=now + timedelta(hours=13))
        late = now + timedelta(seconds=settings.LAI_CHILD_SESSION_MAX_SECONDS + 1)
        assert child_auth.session_for_value(value, now=late) is None

    def test_sign_out_ends_the_session(self, families, provision, sign_in):
        client, body = sign_in(provision(families.a, families.a1))
        response = client.post(END, HTTP_X_LAI_CHILD_CSRF=body["csrfToken"])
        assert response.status_code == 204
        assert client.get(child_url(families.a1)).status_code == 401
        assert ChildPlaySession.objects.get(child=families.a1).revoked_at is not None


# --- shared devices and remembered sign-in -------------------------------------------------------


class TestDevices:
    def test_a_second_child_on_the_same_browser_replaces_the_first(
        self, families, provision, sign_in
    ):
        a1 = provision(families.a, families.a1, username="zinnia01")
        a2 = provision(families.a, families.a2, username="zephyr02")
        client, _ = sign_in(a1, remember=True)
        first_session = client.cookies["lai_child_session"].value
        first_device = client.cookies["lai_child_device"].value
        sign_in(a2, client=client)
        assert child_auth.session_for_value(first_session) is None
        assert ChildDevice.objects.get(child=families.a1).revoked_at is not None
        assert client.get(child_url(families.a1)).status_code == 404
        assert client.get(child_url(families.a2)).status_code == 200
        with pytest.raises(child_auth.SignInRefused):
            child_auth.sign_in_with_device(first_device)

    def test_remember_me_reopens_the_session_and_rotates_the_device(
        self, families, provision, sign_in
    ):
        client, body = sign_in(provision(families.a, families.a1), remember=True)
        assert body["remembered"] is True
        device_cookie = client.cookies["lai_child_device"]
        assert device_cookie["path"] == "/api/v1/child-auth/" and device_cookie["httponly"]
        old_device = device_cookie.value
        old_session = client.cookies["lai_child_session"].value
        response = client.post(RESTORE, HTTP_X_LAI_CHILD_SIGN_IN="1")
        assert response.status_code == 201
        assert response.json()["child"]["id"] == str(families.a1.pk)
        assert client.cookies["lai_child_device"].value != old_device
        assert child_auth.session_for_value(old_session) is None
        with pytest.raises(child_auth.SignInRefused):
            child_auth.sign_in_with_device(old_device)  # a copied cookie stops working

    def test_restore_needs_the_sign_in_header(self, families, provision, sign_in):
        client, _ = sign_in(provision(families.a, families.a1), remember=True)
        assert client.post(RESTORE).status_code == 403
        assert (
            client.post(
                RESTORE, HTTP_X_LAI_CHILD_SIGN_IN="1", HTTP_ORIGIN="https://x.example"
            ).status_code
            == 403
        )

    def test_sign_out_forgets_the_remembered_device(self, families, provision, sign_in):
        client, body = sign_in(provision(families.a, families.a1), remember=True)
        client.post(END, HTTP_X_LAI_CHILD_CSRF=body["csrfToken"])
        assert ChildDevice.objects.get(child=families.a1).revoked_at is not None
        assert client.post(RESTORE, HTTP_X_LAI_CHILD_SIGN_IN="1").status_code == 403

    def test_the_parent_sees_and_revokes_remembered_devices(
        self, families, provision, sign_in, api
    ):
        client, _ = sign_in(provision(families.a, families.a1), remember=True)
        parent = api(families.a)
        devices = parent.get(child_url(families.a1, "sign-in/devices/")).json()["devices"]
        assert len(devices) == 1
        assert set(devices[0]) == {"id", "rememberedAt", "lastUsedAt", "expiresAt"}
        assert (
            api(families.b)
            .delete(child_url(families.a1, f"sign-in/devices/{devices[0]['id']}/"))
            .status_code
            == 404
        )
        response = parent.delete(child_url(families.a1, f"sign-in/devices/{devices[0]['id']}/"))
        assert response.status_code == 204
        assert client.get(child_url(families.a1)).status_code == 401
        assert client.post(RESTORE, HTTP_X_LAI_CHILD_SIGN_IN="1").status_code == 403

    def test_a_device_cannot_be_used_after_a_reset(self, families, provision, sign_in):
        client, _ = sign_in(provision(families.a, families.a1), remember=True)
        child_auth.set_password(families.a, families.a1.pk, password="Brand-New-Pass9")
        response = client.post(RESTORE, HTTP_X_LAI_CHILD_SIGN_IN="1")
        assert response.status_code == 403
        assert client.cookies["lai_child_device"].value == ""  # forgotten


# --- parent controls take effect at once ---------------------------------------------------------


class TestParentControls:
    def test_suspend_is_immediate_and_resume_keeps_old_tokens_out(
        self, families, provision, sign_in, child_pool, api, child_client
    ):
        credential = provision(families.a, families.a1)
        old_token = child_pool.token(credential)
        client, _ = sign_in(credential)
        parent = api(families.a)
        response = parent.post(child_url(families.a1, "sign-in/suspend/"))
        assert response.status_code == 200
        assert response.json()["signIn"]["status"] == "SUSPENDED"
        assert response.json()["providerSynced"] is True
        assert client.get(child_url(families.a1)).status_code == 401
        assert child_pool.provider.users[credential.provider_username].enabled is False
        assert parent.post(child_url(families.a1, "sign-in/resume/")).status_code == 200
        assert child_pool.provider.users[credential.provider_username].enabled is True
        response = child_client().post(
            SESSION, {}, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {old_token}"
        )
        assert response.status_code == 403

    def test_suspension_holds_even_when_the_pool_is_unreachable(
        self, families, provision, sign_in, child_pool, api
    ):
        client, _ = sign_in(provision(families.a, families.a1))
        child_pool.provider.fail_next = "network"
        response = api(families.a).post(child_url(families.a1, "sign-in/suspend/"))
        assert response.status_code == 200
        assert response.json()["providerSynced"] is False
        assert client.get(child_url(families.a1)).status_code == 401

    def test_sign_out_everywhere(self, families, provision, sign_in, api):
        credential = provision(families.a, families.a1)
        first, _ = sign_in(credential)
        second, _ = sign_in(credential, remember=True)
        response = api(families.a).post(child_url(families.a1, "sign-in/sign-out-everywhere/"))
        assert response.status_code == 200
        assert response.json()["signIn"]["activeSessions"] == 0
        assert response.json()["signIn"]["rememberedDevices"] == 0
        assert first.get(child_url(families.a1)).status_code == 401
        assert second.get(child_url(families.a1)).status_code == 401

    def test_parent_password_reset_ends_sessions(
        self, families, provision, sign_in, api, child_pool
    ):
        credential = provision(families.a, families.a1)
        client, _ = sign_in(credential)
        response = api(families.a).post(
            child_url(families.a1, "sign-in/password/"),
            {"password": "Brand-New-Pass9"},
            content_type="application/json",
        )
        assert response.status_code == 200
        assert "Brand-New-Pass9" not in response.content.decode()
        assert client.get(child_url(families.a1)).status_code == 401
        assert child_pool.provider.users[credential.provider_username].sign_outs >= 1

    def test_username_change_keeps_identity(self, families, provision, sign_in, api, child_pool):
        credential = provision(families.a, families.a1)
        response = api(families.a).patch(
            sign_in_url(families.a1), {"username": "zinnia77"}, content_type="application/json"
        )
        assert response.status_code == 200
        updated = ChildCredential.objects.get(pk=credential.pk)
        assert (updated.subject, updated.login_name) == (credential.subject, "zinnia77")
        assert child_pool.provider.users[credential.provider_username].login_name == "zinnia77"
        sign_in(updated)

    def test_withdrawing_consent_ends_sessions_at_once(self, families, provision, sign_in, api):
        client, _ = sign_in(provision(families.a, families.a1), remember=True)
        assert api(families.a).delete(consent_url(families.a1)).status_code == 200
        assert client.get(child_url(families.a1)).status_code == 401
        assert client.post(RESTORE, HTTP_X_LAI_CHILD_SIGN_IN="1").status_code == 403
        consent = ParentConsent.objects.get(child=families.a1)
        assert consent.withdrawn_at is not None and consent.policy_version == CONSENT_VERSION

    def test_a_new_consent_text_needs_new_consent(
        self, families, provision, sign_in, settings, child_pool, child_client
    ):
        credential = provision(families.a, families.a1)
        settings.LAI_CHILD_SIGN_IN_CONSENT_VERSION = "test-consent-v2"
        response = child_client().post(
            SESSION,
            {},
            content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {child_pool.token(credential)}",
        )
        assert response.status_code == 403

    def test_removing_sign_in_keeps_the_profile_and_frees_the_username(
        self, families, provision, sign_in, api, child_pool, child_client
    ):
        credential = provision(families.a, families.a1, username="zinnia01")
        token = child_pool.token(credential)
        response = api(families.a).delete(sign_in_url(families.a1))
        assert response.status_code == 200
        assert response.json()["signIn"] is None
        assert ChildProfile.objects.filter(pk=families.a1.pk).exists()
        tombstone = ChildCredential.objects.get(pk=credential.pk)
        assert tombstone.status == "REVOKED" and tombstone.login_name == ""
        assert credential.provider_username not in child_pool.provider.users
        response = child_client().post(
            SESSION, {}, content_type="application/json", HTTP_AUTHORIZATION=f"Bearer {token}"
        )
        assert response.status_code == 403
        provision(families.a, families.a2, username="zinnia01")  # the name is free again

    def test_removal_finishes_later_when_the_pool_is_unreachable(
        self, families, provision, api, child_pool
    ):
        credential = provision(families.a, families.a1)
        child_pool.provider.fail_next = "network"
        response = api(families.a).delete(sign_in_url(families.a1))
        assert response.json()["providerSynced"] is False
        assert ChildCredential.objects.get(pk=credential.pk).provider_cleanup_pending
        response = api(families.a).delete(sign_in_url(families.a1))
        assert response.status_code == 200
        assert not ChildCredential.objects.get(pk=credential.pk).provider_cleanup_pending

    def test_deleting_the_child_deletes_the_pool_user_first(
        self, families, provision, api, child_pool
    ):
        credential = provision(families.a, families.a1)
        child_pool.provider.fail_next = "network"
        assert api(families.a).delete(child_url(families.a1)).status_code == 503
        assert ChildProfile.objects.filter(pk=families.a1.pk).exists()
        assert api(families.a).delete(child_url(families.a1)).status_code == 204
        assert credential.provider_username not in child_pool.provider.users
        assert not ChildCredential.objects.filter(pk=credential.pk).exists()

    def test_overview_never_contains_secrets(self, families, provision, sign_in, api):
        credential = provision(families.a, families.a1)
        sign_in(credential, remember=True)
        body = api(families.a).get(sign_in_url(families.a1)).json()
        assert set(body["signIn"]) == {
            "status",
            "username",
            "createdAt",
            "passwordSetAt",
            "activeSessions",
            "rememberedDevices",
        }
        text = str(body)
        assert credential.subject not in text and credential.provider_username not in text
