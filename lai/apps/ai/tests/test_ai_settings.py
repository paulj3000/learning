"""AI settings fail closed (LAI-0704): production never runs the fake or an unguarded model."""

import pytest
from django.core.exceptions import ImproperlyConfigured

from apps.core.tests.test_settings import _load, _prod_env

GUARDED = {
    "LAI_AI_PROVIDER": "bedrock",
    "LAI_AI_BEDROCK_REGION": "us-west-1",
    "LAI_AI_MODEL_ID": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "LAI_AI_GUARDRAIL_ID": "gr-abc123",
    "LAI_AI_GUARDRAIL_VERSION": "1",
}


def test_production_defaults_to_authored_content_only(monkeypatch):
    _prod_env(monkeypatch, LAI_AI_PROVIDER=None)
    assert _load("config.settings.production").LAI_AI_PROVIDER == "disabled"


def test_production_never_runs_the_fake_model(monkeypatch):
    _prod_env(monkeypatch, LAI_AI_PROVIDER="fake")
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.production")


@pytest.mark.parametrize("missing", sorted(set(GUARDED) - {"LAI_AI_PROVIDER"}))
def test_production_bedrock_requires_region_model_and_guardrail(monkeypatch, missing):
    _prod_env(monkeypatch, **{**GUARDED, missing: None})
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.production")


def test_production_rejects_the_draft_guardrail(monkeypatch):
    _prod_env(monkeypatch, **{**GUARDED, "LAI_AI_GUARDRAIL_VERSION": "DRAFT"})
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.production")


def test_production_accepts_a_fully_guarded_bedrock(monkeypatch):
    _prod_env(monkeypatch, **GUARDED)
    prod = _load("config.settings.production")
    assert (prod.LAI_AI_PROVIDER, prod.LAI_AI_GUARDRAIL_ID) == ("bedrock", "gr-abc123")


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("LAI_AI_PROVIDER", "openai"),
        ("LAI_AI_TIMEOUT_SECONDS", "0"),
        ("LAI_AI_MAX_OUTPUT_TOKENS", "5000"),
        ("LAI_AI_TEMPERATURE", "1.5"),
        ("LAI_AI_CHILD_TURNS_PER_MINUTE", "0"),
        ("LAI_AI_MAX_ATTEMPTS", "9"),
        ("LAI_AI_PRICE_INPUT_PER_MTOK_USD", "-1"),
    ],
)
def test_base_settings_reject_unsafe_ai_values(monkeypatch, name, value):
    monkeypatch.setenv(name, value)
    with pytest.raises(ImproperlyConfigured):
        _load("config.settings.base")
