"""The Django personas are the Amplify ones, verbatim and at the same version (LAI-0701)."""

import re

import pytest
from django.conf import settings

from apps.ai.prompts import COMPANION_PERSONA, PERSONAS, TUTOR_PERSONA

REPO = settings.BASE_DIR.parent


def _typescript(source: str, version_name: str, prompt_name: str) -> tuple[int, str]:
    text = (REPO / source).read_text(encoding="utf-8")
    version = int(re.search(rf"export const {version_name} = (\d+);", text).group(1))
    prompt = re.search(rf"export const {prompt_name} = `(.*?)`\.trim\(\);", text, re.S).group(1)
    return version, prompt.strip()


@pytest.mark.parametrize(
    ("persona", "version_name", "prompt_name"),
    [
        (COMPANION_PERSONA, "CHATTY_PERSONA_VERSION", "CHATTY_SYSTEM_PROMPT"),
        (TUTOR_PERSONA, "TUTOR_PERSONA_VERSION", "TUTOR_SYSTEM_PROMPT"),
    ],
)
def test_persona_matches_its_amplify_source(persona, version_name, prompt_name):
    version, prompt = _typescript(persona.source, version_name, prompt_name)
    assert persona.version == version
    assert persona.system_prompt == prompt


def test_the_personas_keep_their_safety_boundaries():
    for persona in PERSONAS.values():
        text = persona.system_prompt
        assert "Never claim to be human" in text
        assert "keep a secret" in text
        assert "address, phone" in text
        assert "safetyDisposition" in text


def test_the_tutor_persona_forbids_judging_the_child():
    assert "Never say or imply how good the child is" in TUTOR_PERSONA.system_prompt
