import pytest
from django.core.cache import cache
from django.core.management import call_command

from apps.assets.storage import reset_storage_cache


@pytest.fixture(autouse=True)
def roles_and_storage():
    reset_storage_cache()
    call_command("ensure_asset_roles", verbosity=0)
    call_command("ensure_sound_roles", verbosity=0)
    cache.clear()
    yield
    reset_storage_cache()
