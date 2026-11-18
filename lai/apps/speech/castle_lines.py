"""Storykeeper Castle's authored narration lines (SC-R06-03), as data.

Two kinds of `SpeechLine`, both shared (authored) and spoken in the `narrator` voice:

- `castle-word-<word>`: a Painted Words pronunciation. The text is the bank word exactly, from
  `castle_speech_words.json` (which mirrors `paintedWordsBank.ts`; a Vitest test holds them equal).
- `castle-page-<page id>`: a Great Storybook page read aloud when it comes back. The text is
  `"<title>. <restoredText>"`, from `apps/regions/great_storybook_pages.json` (the server's copy of
  the client's `STORYBOOK_PAGES`), the same text as the client's `pageNarration`.

Nothing here is AI-generated and nothing is free text from a child. The React side builds the same
ids (`castleSpeechLines.ts`) and passes the same text as the on-screen caption, so a voice that
fails or is switched off leaves exactly these words on screen.
"""

import json
from dataclasses import dataclass
from pathlib import Path

VOICE_PROFILE_ID = "narrator"
CONTEXT = "castle"

_WORDS = json.loads((Path(__file__).parent / "castle_speech_words.json").read_text("utf-8"))
_PAGES = json.loads(
    (Path(__file__).resolve().parent.parent / "regions" / "great_storybook_pages.json").read_text(
        "utf-8"
    )
)


@dataclass(frozen=True)
class CastleLine:
    line_id: str
    text: str


def word_line_id(word: str) -> str:
    return f"castle-word-{word}"


def page_line_id(page_id: str) -> str:
    return f"castle-page-{page_id}"


def page_narration(page: dict) -> str:
    return f"{page['title']}. {page['restoredText']}"


def bank_words() -> list[str]:
    return list(_WORDS["words"])


def storybook_pages() -> list[dict]:
    return list(_PAGES["pages"])


def castle_lines() -> tuple[CastleLine, ...]:
    """Every castle narration line, words first, in source order."""
    words = tuple(CastleLine(word_line_id(word), word) for word in bank_words())
    pages = tuple(CastleLine(page_line_id(page["id"]), page_narration(page)) for page in storybook_pages())
    return words + pages
