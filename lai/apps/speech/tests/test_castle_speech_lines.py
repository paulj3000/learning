"""SC-R06-03: Storykeeper Castle's authored narration lines, seeded and spoken.

The seed is idempotent and never overwrites staff edits; the text is exactly its source (the
Painted Words bank and the Great Storybook pages); the lines are spoken through the existing
speech pipeline with the fake Polly provider (no AWS call), shared and cached, for the child's own
family only, and the same lines a parent who switched AI off still hears (they are authored).
"""

import json
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command

from apps.speech.castle_lines import (
    bank_words,
    castle_lines,
    page_line_id,
    storybook_pages,
    word_line_id,
)
from apps.speech.models import ClipScope, SpeechClip, SpeechLine
from apps.speech.polly import get_polly_client
from apps.speech.tests.helpers import post, profile

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

_LAI = Path(__file__).resolve().parents[3]
_PAGES_JSON = _LAI / "apps" / "regions" / "great_storybook_pages.json"


def run(*args):
    out = StringIO()
    call_command("seed_castle_speech_lines", *args, stdout=out)
    return out.getvalue()


def seeded():
    profile("narrator", "Joanna")
    run()


def test_without_the_narrator_voice_nothing_is_created():
    assert "VOICE NEEDED" in run()
    assert SpeechLine.objects.count() == 0


def test_word_lines_are_exactly_the_bank_words():
    seeded()
    words = bank_words()
    assert len(words) == len(set(words)) == 30
    for word in words:
        line = SpeechLine.objects.get(line_id=word_line_id(word))
        assert line.text == word
        assert (line.context, line.voice_profile.profile_id, line.enabled) == (
            "castle",
            "narrator",
            True,
        )


def test_page_lines_are_exactly_the_storybook_pages_text():
    seeded()
    pages = json.loads(_PAGES_JSON.read_text("utf-8"))["pages"]
    assert [page["id"] for page in storybook_pages()] == [page["id"] for page in pages]
    for page in pages:
        line = SpeechLine.objects.get(line_id=page_line_id(page["id"]))
        assert line.text == f"{page['title']}. {page['restoredText']}"
        assert "—" not in line.text


def test_every_line_is_created_once_and_the_seed_is_idempotent():
    seeded()
    assert SpeechLine.objects.count() == len(castle_lines())
    report = run()
    assert "Created 0 line(s)." in report
    assert SpeechLine.objects.count() == len(castle_lines())


def test_staff_edits_are_never_overwritten_but_are_reported():
    seeded()
    SpeechLine.objects.filter(line_id="castle-word-cat").update(text="kitty", enabled=False)
    report = run()
    line = SpeechLine.objects.get(line_id="castle-word-cat")
    assert (line.text, line.enabled) == ("kitty", False)
    assert "DIFFERS castle-word-cat" in report


def test_dry_run_writes_nothing():
    profile("narrator", "Joanna")
    assert f"Would create {len(castle_lines())} line(s)." in run("--dry-run")
    assert SpeechLine.objects.count() == 0


def test_the_seed_synthesizes_nothing():
    seeded()
    assert get_polly_client().calls == []
    assert SpeechClip.objects.count() == 0


class TestSpokenThroughTheExistingPipeline:
    def test_a_word_is_spoken_once_then_served_from_the_shared_cache(self, families, api, cognito):
        seeded()
        ref = {"kind": "line", "id": "castle-word-butterfly"}
        first = post(api(families.a), families.a1, ref).json()["speech"]
        second = post(api(families.a), families.a2, ref).json()["speech"]
        assert first["text"] == second["text"] == "butterfly"
        assert (first["cached"], second["cached"]) == (False, True)
        # One synthesis with the fake Polly provider; the clip is shared (authored), not per child.
        assert len(get_polly_client().calls) == 1
        assert SpeechClip.objects.get().scope == ClipScope.AUTHORED

    def test_a_page_is_spoken_with_its_own_text(self, families, api, cognito):
        seeded()
        page = storybook_pages()[0]
        speech = post(
            api(families.a), families.a1, {"kind": "line", "id": page_line_id(page["id"])}
        ).json()["speech"]
        assert speech["text"] == f"{page['title']}. {page['restoredText']}"

    def test_another_familys_child_is_a_404_and_makes_no_speech(self, families, api, cognito):
        seeded()
        response = post(api(families.b), families.a1, {"kind": "line", "id": "castle-word-cat"})
        assert response.status_code == 404
        assert get_polly_client().calls == []

    def test_authored_lines_follow_the_same_gates_as_other_authored_narration(
        self, families, api, cognito, settings
    ):
        """AI off does not silence authored lines (as for Keeper Quill); the speech switch does."""
        seeded()
        type(families.a1).objects.filter(pk=families.a1.pk).update(ai_enabled=False)
        ref = {"kind": "line", "id": "castle-word-sun"}
        assert post(api(families.a), families.a1, ref).status_code == 200
        settings.LAI_SPEECH_PROVIDER = "disabled"
        response = post(api(families.a), families.a1, {"kind": "line", "id": "castle-word-moon"})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "speech_disabled"

    def test_a_disabled_line_is_a_404_so_the_game_keeps_the_caption(self, families, api, cognito):
        seeded()
        SpeechLine.objects.filter(line_id="castle-word-dog").update(enabled=False)
        response = post(api(families.a), families.a1, {"kind": "line", "id": "castle-word-dog"})
        assert response.status_code == 404
