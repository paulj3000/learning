"""The economy is off by default and provisional values can never award in production (GE-100).
No database: settings and source only."""

import ast
from pathlib import Path

from django.conf import settings

from apps.scoring import policies

SETTINGS = Path(__file__).resolve().parents[3] / "config" / "settings"


def _env_bool_default(source: str, name: str):
    for node in ast.walk(ast.parse(source)):
        if (
            isinstance(node, ast.Call)
            and getattr(node.func, "id", "") == "env_bool"
            and isinstance(node.args[0], ast.Constant)
            and node.args[0].value == name
        ):
            return node.args[1].value
    raise AssertionError(f"{name} is not read with env_bool")


def test_scoring_and_unapproved_values_default_to_off_in_base_settings():
    source = (SETTINGS / "base.py").read_text()
    assert _env_bool_default(source, "LAI_SCORING_ENABLED") is False
    assert _env_bool_default(source, "LAI_SCORING_ALLOW_UNAPPROVED") is False


def test_the_test_settings_leave_scoring_off_unless_a_test_turns_it_on():
    assert settings.LAI_SCORING_ENABLED is False
    assert settings.LAI_SCORING_ALLOW_UNAPPROVED is False
    assert policies.engine_enabled() is False and policies.unapproved_allowed() is False


def test_production_settings_refuse_unapproved_values():
    source = (SETTINGS / "production.py").read_text()
    assert "if LAI_SCORING_ALLOW_UNAPPROVED:" in source
    assert 'raise ImproperlyConfigured("LAI_SCORING_ALLOW_UNAPPROVED' in source


def test_production_settings_never_switch_scoring_on():
    source = (SETTINGS / "production.py").read_text()
    assert "LAI_SCORING_ENABLED = True" not in source
