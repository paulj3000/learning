"""The Writing Room's write-your-story activity: composing and screening a child's story.

The activity saves through the existing `StoryArtifact` (one per `AdventureSession`, parent
viewable and deletable). Three catalog adventures at `castle-writing-room`, one per age band
(`react/src/features/adventures/content/writingRoomStories.ts`), give the story its session.

**Only an Explorer's paragraph is the child's own text.** For the two younger bands the client
sends option ids and the server builds the text from the authored option labels, so a Sprout or
Pathfinder story can only ever contain authored words:

- Sprouts (3 to 4): one option from each of the picture, character and word steps.
- Pathfinders (5 to 6): word tiles, in the child's order, for two or three sentences.
- Explorers (7 to 8): one authored story starter, then a typed paragraph.

The typed paragraph is screened with the existing deterministic input checks
(`screen_untrusted_text`: prompt injection, private details, contact details, links, secrecy,
reward manipulation) and a short list of words no young child's story should hold. A
paragraph that fails is refused with a kind authored message and is neither stored nor logged:
this module never logs text, and the refusal names no category and never echoes the text.

No model reads, rewrites or comments on what the child wrote, and nothing here grades it: there is
no wrong story. Encouragement is authored in the client.
"""

import re
from dataclasses import dataclass

from apps.ai.content_safety import contains_url, requests_personal_information
from apps.ai.jscompat import js_regex
from apps.ai.services.safety import screen_untrusted_text
from apps.catalog import authoring
from apps.catalog.models import AdventureStep

LOCATION_SLUG = "castle-writing-room"
SOURCE = "CHILD"

#: Sentences a Pathfinder may leave out. Every other writing step is required.
OPTIONAL_STEPS = frozenset({"sentence-3"})
#: Step ids that take typed text. Everything else takes option ids.
TEXT_STEP_IDS = frozenset({"write-the-story"})

MAX_TILES = 8
EXPLORER_MIN_CHARACTERS = 30
EXPLORER_MAX_CHARACTERS = 500
#: Pathfinders and Sprouts: one authored phrase each.
MAX_OPTIONS_BY_BAND = {"SPROUT": 1, "PATHFINDER": MAX_TILES, "EXPLORER": 1}

# Words that should not be in a young child's saved story. Deliberately short and conservative
# (strong profanity and plainly hurtful phrases): scary-but-gentle words such as "dragon", "storm"
# or "sword" are fine in a pirate or castle story and are NOT screened here. A false positive
# costs the child one kind message; a false negative is the risk to minimise.
_UNSUITABLE = js_regex(
    r"\b(fuck\w*|shit\w*|bitch\w*|bastard|asshole|cunt|piss\w*"
    r"|kill (you|yourself|myself|him|her|them)|kys|suicide|stupid|idiot|ugly|hate you)\b"
)
_WHITESPACE = re.compile(r"\s+")


class WrittenStoryInvalid(Exception):
    """The request does not fit the adventure (a step it does not have, a missing step, an option
    it does not offer). Says nothing about the text."""


class WrittenStoryRefused(Exception):
    """The child's text did not pass the safety checks. Carries no text and no category."""


@dataclass(frozen=True)
class Part:
    step_id: str
    option_ids: tuple[str, ...]
    text: str | None


def clean_text(raw: str) -> str:
    return _WHITESPACE.sub(" ", raw).strip()


def text_is_safe(text: str) -> bool:
    """True when a child's paragraph passes every deterministic check. Reads, never stores."""
    if screen_untrusted_text({"story": text}):
        return False
    if contains_url(text) or requests_personal_information(text):
        return False
    return _UNSUITABLE.search(text) is None


def _sentence(words: str, *, punctuate: bool = True) -> str:
    """Capitalised, and ended with a full stop unless it is a story starter the child continues."""
    words = clean_text(words)
    if not words:
        raise WrittenStoryInvalid
    words = words[0].upper() + words[1:]
    if not punctuate or words[-1] in ".!?":
        return words
    return f"{words}."


def _labels(body: dict, option_ids: tuple[str, ...]) -> list[str]:
    options = {
        option["id"]: option["label"]
        for option in (body.get("presentation") or {}).get("options") or []
        if isinstance(option, dict)
    }
    if not option_ids or any(option_id not in options for option_id in option_ids):
        raise WrittenStoryInvalid
    if len(set(option_ids)) != len(option_ids):
        raise WrittenStoryInvalid
    return [options[option_id] for option_id in option_ids]


def compose_scenes(adventure, band: str, parts: list[Part]) -> list[dict]:
    """The scenes to store, in the adventure's step order, or raise.

    `WrittenStoryInvalid` for a request that does not fit the adventure; `WrittenStoryRefused`
    for text that fails the safety checks.
    """
    steps = [
        step
        for step in AdventureStep.objects.filter(adventure=adventure).order_by("position")
        if step.step_type in ("CREATIVE_CHOICE", "REFLECTION")
    ]
    known = {step.step_id: step for step in steps}
    given = {part.step_id: part for part in parts}
    if len(given) != len(parts) or set(given) - set(known):
        raise WrittenStoryInvalid
    required = {step_id for step_id in known if step_id not in OPTIONAL_STEPS}
    if not required <= set(given):
        raise WrittenStoryInvalid
    # A later sentence only after the one before it.
    ordered_ids = [step.step_id for step in steps if step.step_id in given]
    if "sentence-3" in given and "sentence-2" not in given:
        raise WrittenStoryInvalid

    limit = MAX_OPTIONS_BY_BAND.get(band, 1)
    scenes: list[dict] = []
    for step_id in ordered_ids:
        part = given[step_id]
        body = authoring.current_body(known[step_id])
        if step_id in TEXT_STEP_IDS or known[step_id].step_type == "REFLECTION":
            if part.option_ids or part.text is None:
                raise WrittenStoryInvalid
            text = clean_text(part.text)
            if not EXPLORER_MIN_CHARACTERS <= len(text) <= EXPLORER_MAX_CHARACTERS:
                raise WrittenStoryInvalid
            if not text_is_safe(text):
                raise WrittenStoryRefused
            scenes.append({"stepId": step_id, "text": text, "source": SOURCE})
            continue
        if part.text is not None or len(part.option_ids) > limit:
            raise WrittenStoryInvalid
        if band == "PATHFINDER" and len(part.option_ids) < 2:
            raise WrittenStoryInvalid  # a sentence is at least two tiles
        labels = _labels(body, part.option_ids)
        text = _sentence(" ".join(labels), punctuate=band != "EXPLORER")
        scenes.append({"stepId": step_id, "text": text, "source": SOURCE})
    return scenes
