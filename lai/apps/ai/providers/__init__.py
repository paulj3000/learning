"""Model client selection from settings (LAI-0701).

`LAI_AI_PROVIDER`:
* `fake` (local and test default): `FakeModelClient`, no network.
* `bedrock`: `BedrockModelClient`; refuses to build without region, model and Guardrail.
* `disabled`: no client at all; every turn is authored fallback content.

Tests replace the client with `override_model_client` (or the `fake_model` fixture); production
code always calls `get_model_client()`.
"""

import threading
from contextlib import contextmanager

from django.conf import settings

from .base import ModelClient, ProviderConfigurationError

_override: ModelClient | None = None
# One Bedrock client per configuration, shared by every request in the process: it keeps the
# HTTPS connection pool and remembers which schemas are already compiled. Building a client per
# turn (as before) paid a TLS handshake each time and made "first call" meaningless.
_bedrock_clients: dict[tuple, ModelClient] = {}
_bedrock_lock = threading.Lock()


def get_model_client() -> ModelClient | None:
    if _override is not None:
        return _override
    provider = settings.LAI_AI_PROVIDER
    if provider == "disabled":
        return None
    if provider == "fake":
        from .fake import FakeModelClient

        return FakeModelClient()
    if provider == "bedrock":
        from .bedrock import BedrockModelClient

        arguments = {
            "region": settings.LAI_AI_BEDROCK_REGION,
            "model_id": settings.LAI_AI_MODEL_ID,
            "guardrail_id": settings.LAI_AI_GUARDRAIL_ID,
            "guardrail_version": settings.LAI_AI_GUARDRAIL_VERSION,
            "timeout_seconds": settings.LAI_AI_TIMEOUT_SECONDS,
            "structured_output": settings.LAI_AI_STRUCTURED_OUTPUT,
            "max_attempts": settings.LAI_AI_MAX_ATTEMPTS,
            "first_call_timeout_seconds": settings.LAI_AI_FIRST_CALL_TIMEOUT_SECONDS,
        }
        # A missing setting raises ProviderConfigurationError from the constructor each time
        # (fail closed); only a fully configured client is cached.
        key = tuple(sorted(arguments.items()))
        with _bedrock_lock:
            client = _bedrock_clients.get(key)
            if client is None:
                client = _bedrock_clients[key] = BedrockModelClient(**arguments)
        return client
    raise ProviderConfigurationError


def reset_model_client_cache() -> None:
    """Forget cached Bedrock clients (tests, and a settings change in a long-lived shell)."""
    with _bedrock_lock:
        _bedrock_clients.clear()


@contextmanager
def override_model_client(client: ModelClient | None):
    global _override
    previous, _override = _override, client
    try:
        yield client
    finally:
        _override = previous
