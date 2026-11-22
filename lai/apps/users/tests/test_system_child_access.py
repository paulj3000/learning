"""GE-090-D1: the cross-family child lookups for system jobs stay out of request code.

Operator commands and background jobs (scoring reconcile and verify, the castle keepsake backfill)
read every family's children through `services.*_for_system`, never through `ChildProfile.objects`
(test_tenant_isolation). These tests pin what the helpers return and that no view, serializer,
API or URL module can reach them.
"""

import re
import uuid
from pathlib import Path

import pytest
from django.db import transaction

from apps.users import services
from apps.users.models import ChildProfile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

LAI_ROOT = Path(__file__).resolve().parents[3]

# Every helper that ignores ownership. A request handler must never call one.
CROSS_FAMILY_HELPERS = (
    "iter_child_profiles_for_system",
    "iter_child_profile_ids_for_system",
    "child_profile_for_system",
    "lock_child_profile_for_system",
    "child_profile_for_import",
)
# Request-path modules by file name: views, viewsets, API, serializers, URLs, routers,
# permissions and Django admin. The scan is name-based: a request handler in a module with
# another name (a helper imported by a view) is not seen, and review must still catch it.
REQUEST_MODULE = re.compile(
    r"(^|_)(views?|viewsets?|api|serializers?|urls|routers?|permissions?|admin)(_|\.py$)"
)


def _request_modules():
    for path in (LAI_ROOT / "apps").rglob("*.py"):
        parts = path.relative_to(LAI_ROOT).parts
        if "tests" in parts or "migrations" in parts:
            continue
        if REQUEST_MODULE.search(path.name) or {"views", "api"} & set(parts[:-1]):
            yield path


def test_no_request_module_calls_a_cross_family_helper():
    modules = list(_request_modules())
    assert len(modules) > 20  # the scan really sees the views, serializers and urls
    pattern = re.compile(r"\b(" + "|".join(CROSS_FAMILY_HELPERS) + r")\b")
    offenders = sorted(
        f"{path.relative_to(LAI_ROOT)}: {match}"
        for path in modules
        for match in pattern.findall(path.read_text())
    )
    assert offenders == []


def test_the_system_iterators_see_every_family_in_id_order(families):
    everyone = {families.a1.pk, families.a2.pk, families.b1.pk, families.b2.pk}
    ids = list(services.iter_child_profile_ids_for_system())
    assert set(ids) == everyone and ids == sorted(ids)
    assert [c.pk for c in services.iter_child_profiles_for_system()] == ids


def test_the_system_lookup_returns_none_for_an_unknown_id(families):
    assert services.child_profile_for_system(families.b1.pk) == families.b1
    assert services.child_profile_for_system(uuid.uuid4()) is None


def test_the_system_lock_raises_for_an_unknown_id_and_locks_a_known_one(families):
    with transaction.atomic():
        assert services.lock_child_profile_for_system(families.a2.pk) == families.a2
        with pytest.raises(ChildProfile.DoesNotExist):
            services.lock_child_profile_for_system(uuid.uuid4())


def test_the_owner_lock_refuses_another_familys_child(families):
    """The client world-change path locks through this (GE-090-D1)."""
    with transaction.atomic():
        assert services.lock_owned_child_profile(families.a, families.a1.pk) == families.a1
        with pytest.raises(services.ChildProfileNotFound):
            services.lock_owned_child_profile(families.a, families.b1.pk)
