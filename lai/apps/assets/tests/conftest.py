import pytest

from apps.assets.storage import get_storage, reset_storage_cache


@pytest.fixture(autouse=True)
def fresh_asset_storage():
    """Every test starts with an empty in-memory store (test settings use `memory`)."""
    reset_storage_cache()
    yield
    reset_storage_cache()


@pytest.fixture
def storage():
    return get_storage()
