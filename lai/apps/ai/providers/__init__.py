"""Model client selection from settings (LAI-0701).

`LAI_AI_PROVIDER`:
* `fake` (local and test default): `FakeModelClient`, no network.
* `bedrock`: `BedrockModelClient`; refuses to build without region, model and Guardrail.
* `disabled`: no client at all; every turn is authored fallback content.

Tests replace the client with `override_model_client` (or the `fake_model` fixture); production
code always calls `get_model_client()`.
"""

from contextlib import contextmanager

from django.conf import settings

from .base import ModelClient, ProviderConfigurationError

_override: ModelClient | None = None


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

        return BedrockModelClient(
            region=settings.LAI_AI_BEDROCK_REGION,
            model_id=settings.LAI_AI_MODEL_ID,
            guardrail_id=settings.LAI_AI_GUARDRAIL_ID,
            guardrail_version=settings.LAI_AI_GUARDRAIL_VERSION,
            timeout_seconds=settings.LAI_AI_TIMEOUT_SECONDS,
            structured_output=settings.LAI_AI_STRUCTURED_OUTPUT,
            max_attempts=settings.LAI_AI_MAX_ATTEMPTS,
        )
    raise ProviderConfigurationError


@contextmanager
def override_model_client(client: ModelClient | None):
    global _override
    previous, _override = _override, client
    try:
        yield client
    finally:
        _override = previous
