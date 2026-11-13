"""The browser acceptance stack uses the deterministic fake speech provider, and only it does.

`tests/e2e/django_server.py` is a disposable local server for Playwright; it must never call
Amazon Polly or write to S3, and production settings must keep speech off unless configured.
"""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _e2e_env() -> dict[str, str]:
    tree = ast.parse((ROOT / "tests" / "e2e" / "django_server.py").read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "E2E_ENV" for t in node.targets
        ):
            env = {}
            for key, value in zip(node.value.keys, node.value.values, strict=True):
                if isinstance(key, ast.Constant) and isinstance(value, ast.Constant):
                    env[key.value] = value.value
            return env
    raise AssertionError("E2E_ENV not found")


def test_acceptance_stack_uses_fake_speech_in_memory():
    env = _e2e_env()
    assert env["LAI_SPEECH_PROVIDER"] == "fake"
    assert env["LAI_SPEECH_STORAGE"] == "memory"
    assert env["LAI_SPEECH_DELIVERY"] == "django"


def test_e2e_env_overrides_the_shell():
    # Assigned, not setdefault: an exported LAI_SPEECH_PROVIDER=polly cannot leak into this stack.
    source = (ROOT / "tests" / "e2e" / "django_server.py").read_text()
    assert "os.environ[name] = value" in source


def test_settings_keep_speech_off_by_default_and_fake_only_in_test_settings():
    base = (ROOT / "lai" / "config" / "settings" / "base.py").read_text()
    assert 'os.environ.get("LAI_SPEECH_PROVIDER", "disabled")' in base
    for name in ("production.py", "local.py"):
        path = ROOT / "lai" / "config" / "settings" / name
        if path.exists():
            assert 'LAI_SPEECH_PROVIDER = "fake"' not in path.read_text()
