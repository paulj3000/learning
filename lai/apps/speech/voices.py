"""Which Amazon Polly voices, engines and languages we allow (SM-P8-03).

A voice profile can only name a combination listed here. Not every Polly voice supports every
engine or language, so nothing is assumed: a voice that is not in this table cannot be configured,
and adding one is a code change that must be checked against the current Polly documentation
(the live verification gate in docs/audio/AMAZON_POLLY_INTEGRATION.md). Child-friendly English
voices only, for now.

`generative` and `long-form` voices take plain text only (no SSML prosody), so a profile's
speaking rate applies to `standard` and `neural` voices.
"""

from xml.sax.saxutils import escape

ENGINES = ("standard", "neural", "generative", "long-form")
SSML_ENGINES = frozenset({"standard", "neural"})

#: voice id -> language code -> engines it supports.
SUPPORTED_VOICES: dict[str, dict[str, tuple[str, ...]]] = {
    "Ivy": {"en-US": ("standard", "neural")},
    "Kevin": {"en-US": ("neural",)},
    "Justin": {"en-US": ("standard", "neural")},
    "Joanna": {"en-US": ("standard", "neural", "generative")},
    "Matthew": {"en-US": ("standard", "neural", "generative")},
    "Salli": {"en-US": ("standard", "neural")},
    "Ruth": {"en-US": ("neural", "long-form", "generative")},
    "Stephen": {"en-US": ("neural", "generative")},
    "Amy": {"en-GB": ("standard", "neural", "generative")},
    "Emma": {"en-GB": ("standard", "neural")},
    "Brian": {"en-GB": ("standard", "neural")},
}

LANGUAGES = tuple(sorted({code for langs in SUPPORTED_VOICES.values() for code in langs}))
MIN_RATE, MAX_RATE = 70, 130


def voice_problem(voice_id: str, language: str, engine: str) -> str | None:
    """Why this voice, language and engine cannot be used together, or None."""
    languages = SUPPORTED_VOICES.get(voice_id)
    if languages is None:
        return f"'{voice_id}' is not in the list of allowed voices."
    engines = languages.get(language)
    if engines is None:
        return (
            f"{voice_id} is not allowed for {language}. It is allowed for: {', '.join(languages)}."
        )
    if engine not in engines:
        return (
            f"{voice_id} ({language}) does not support the {engine} engine. "
            f"Use: {', '.join(engines)}."
        )
    return None


def build_request_text(text: str, engine: str, rate_percent: int) -> tuple[str, str]:
    """(text, TextType) for Polly. SSML only where the engine supports it; always escaped."""
    if engine in SSML_ENGINES and rate_percent != 100:
        return f'<speak><prosody rate="{rate_percent}%">{escape(text)}</prosody></speak>', "ssml"
    return text, "text"
