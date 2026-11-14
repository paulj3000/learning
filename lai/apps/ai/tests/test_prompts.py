"""Chatty's personas (LAI-0701). They were copied verbatim from `amplify/data/*Persona.ts`; that
source was removed with the Amplify backend (AMP-07), so Python is now the only copy.

A prompt's text is pinned to its version: changing the text without bumping the version (and
updating the pin) fails here, so audit rows keep naming the prompt they were produced with.
The pins equal the last Amplify sources (version 2 of each, verified at removal).
"""

import hashlib

import pytest

from apps.ai.prompts import COMPANION_PERSONA, PERSONAS, TUTOR_PERSONA

PINNED = {
    "chatty-companion": (2, "cb927be7df030f05afebb7ff62fe96dae3c5f982ad9a4e96e471e956f95e4527"),
    "chatty-tutor": (2, "e2083161f957540812e144ee036ece497a0ff7f8eae33593ee2d9c6c4d3880f1"),
}


@pytest.mark.parametrize("persona", [COMPANION_PERSONA, TUTOR_PERSONA], ids=lambda p: p.key)
def test_persona_text_is_pinned_to_its_version(persona):
    version, digest = PINNED[persona.key]
    assert persona.version == version
    assert hashlib.sha256(persona.system_prompt.encode()).hexdigest() == digest


def test_persona_sources_name_files_that_exist():
    from django.conf import settings

    for persona in PERSONAS.values():
        assert (settings.BASE_DIR.parent / persona.source).is_file(), persona.source


def test_the_personas_keep_their_safety_boundaries():
    for persona in PERSONAS.values():
        text = persona.system_prompt
        assert "Never claim to be human" in text
        assert "keep a secret" in text
        assert "address, phone" in text
        assert "safetyDisposition" in text


def test_the_tutor_persona_forbids_judging_the_child():
    assert "Never say or imply how good the child is" in TUTOR_PERSONA.system_prompt
