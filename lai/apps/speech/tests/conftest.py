import pytest
from django.core.cache import cache

from apps.speech import services
from apps.speech.polly import set_polly_client
from apps.speech.storage import reset_speech_storage_cache


@pytest.fixture(autouse=True)
def fresh_speech(settings):
    """Every test starts with a new fake Polly, an empty speech store and no stale counters."""
    set_polly_client(None)
    reset_speech_storage_cache()
    cache.clear()
    services._concurrency = None  # noqa: SLF001
    yield
    set_polly_client(None)
    reset_speech_storage_cache()
    services._concurrency = None  # noqa: SLF001
