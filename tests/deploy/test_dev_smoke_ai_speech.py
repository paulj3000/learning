"""scripts/aws/smoke-ai-speech.sh: paid calls need two flags; free mode makes no paid call."""

import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts/aws/smoke-ai-speech.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("jq") is None, reason="needs bash and jq"
)


def run(home, *args):
    return subprocess.run(
        ["bash", str(SCRIPT), *args],
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin", "HOME": str(home)},
        timeout=60,
        check=False,
    )


@pytest.mark.parametrize("args", [["--paid"], ["--confirm-paid-calls"], ["--bogus"]])
def test_paid_calls_need_both_flags(tmp_path, args):
    result = run(tmp_path, *args)
    assert result.returncode == 2


def test_free_checks_never_call_inference_or_synthesis():
    text = SCRIPT.read_text()
    free, paid = text.split('if [ "$paid" = true ]; then', 1)
    for call in ("bedrock-runtime", "synthesize-speech", "apply-guardrail"):
        assert call not in free.split("set -Eeuo pipefail", 1)[1]
        assert call in paid
    assert "us.anthropic.claude-haiku-4-5-20251001-v1:0" in text
    assert "maxTokens=40" in text  # bounded output on the one paid turn
