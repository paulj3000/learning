"""Authored tutoring content and the tutor context builder (LAI-0701, LAI-0703).

A Python mirror of three TypeScript sources, in the same way `apps/education/challenges.py`
mirrors curriculum rules:

* `react/src/features/tutor/content/vocabulary.ts`: the permission and tripwire word lists;
* `content/exported/curriculum.json` (from `react/src/features/curriculum/content/`): each
  skill's authored title, description, representations and prerequisites;
* `react/src/features/tutor/strategy.ts` and `context.ts`: strategy selection and the context
  builder.

Drift is caught twice: `tests/golden/ai-safety.json` (generated from the TypeScript) checks
`build_tutor_context`, vocabulary and strategy for every skill, and
`apps/ai/tests/test_tutor_content.py` compares `SKILLS` with the content export. Editing a word
list here without the TypeScript (or the other way round) turns both red.
"""

import re
from dataclasses import dataclass, field

from .jscompat import js_regex, js_round
from .limits import MAX_HINT_LEVEL, MAX_SPOKEN_LENGTH_BY_AGE_BAND

CORE_TUTOR_VOCABULARY: tuple[str, ...] = (
    "again",
    "answer",
    "check",
    "guess",
    "idea",
    "look",
    "notice",
    "part",
    "picture",
    "problem",
    "puzzle",
    "same",
    "show",
    "sort",
    "step",
    "think",
    "try",
    "way",
)

SKILL_VOCABULARY: dict[str, tuple[str, ...]] = {
    "counting-sets": (
        "all together",
        "count",
        "counted",
        "counting",
        "each",
        "group",
        "how many",
        "last",
        "many",
        "number",
        "one at a time",
        "point",
        "set",
        "total",
    ),
    "comparing-lengths": (
        "compare",
        "end",
        "line up",
        "long",
        "longer",
        "longest",
        "match",
        "short",
        "shorter",
        "shortest",
        "side by side",
        "size",
        "taller",
    ),
    "addition-within-ten": (
        "add",
        "adding",
        "addition",
        "all together",
        "count",
        "counting",
        "group",
        "how many",
        "join",
        "more",
        "number",
        "plus",
        "sum",
        "total",
    ),
    "patterns": (
        "again",
        "color",
        "copy",
        "shape",
        "next",
        "order",
        "pattern",
        "patterns",
        "repeat",
        "repeating",
        "rule",
    ),
    "measurement": (
        "compare",
        "count",
        "counting",
        "end",
        "how many",
        "long",
        "longer",
        "measure",
        "measurement",
        "measuring",
        "ruler",
        "shorter",
        "size",
        "start",
        "unit",
    ),
    "subtraction-within-ten": (
        "away",
        "count",
        "counting",
        "fewer",
        "group",
        "how many",
        "left",
        "less",
        "minus",
        "number",
        "subtract",
        "subtracting",
        "subtraction",
        "take away",
    ),
    "observation": (
        "closer",
        "different",
        "look",
        "looking",
        "notice",
        "noticed",
        "same",
        "see",
        "shape",
        "watch",
    ),
    "classification": (
        "belong",
        "different",
        "group",
        "grouping",
        "kind",
        "match",
        "same",
        "set",
        "sort",
        "sorting",
        "together",
    ),
    "cause-and-effect": (
        "after",
        "because",
        "before",
        "happen",
        "happened",
        "happens",
        "made",
        "next",
        "reason",
        "so",
        "then",
        "why",
    ),
    "animal-science": (
        "animal",
        "animals",
        "eat",
        "eats",
        "food",
        "home",
        "live",
        "lives",
        "move",
        "moves",
        "nest",
        "wing",
        "wings",
    ),
}

CURRICULUM_TERMS: tuple[str, ...] = (
    "add",
    "adding",
    "addition",
    "algebra",
    "count",
    "counting",
    "decimal",
    "decimals",
    "divide",
    "dividing",
    "division",
    "equation",
    "estimate",
    "fraction",
    "fractions",
    "geometry",
    "graph",
    "half",
    "measure",
    "measuring",
    "measurement",
    "minus",
    "multiply",
    "multiplying",
    "multiplication",
    "negative",
    "pattern",
    "patterns",
    "percent",
    "place value",
    "classify",
    "classifying",
    "sorting",
    "plus",
    "ratio",
    "rounding",
    "subtract",
    "subtracting",
    "subtraction",
    "sum",
    "times table",
    "weigh",
    "weight",
)

# One pattern per term, compiled once: whole-word, case-insensitive, as `new RegExp('\\b' + term
# + '\\b', 'i')` in `schema.ts`. Terms are plain words, so they need no escaping beyond re.escape.
_TERM_PATTERNS = [(term, js_regex(rf"\b{re.escape(term)}\b")) for term in CURRICULUM_TERMS]

REPRESENTATIONS: tuple[str, ...] = ("numeric", "visual", "word-problem", "game-interaction")


@dataclass(frozen=True, slots=True)
class Skill:
    id: str
    title: str
    description: str
    representations: tuple[str, ...]
    prerequisite_skill_ids: tuple[str, ...] = ()


# `content/exported/curriculum.json` `skills`, in export order.
SKILLS: tuple[Skill, ...] = (
    Skill(
        "counting-sets",
        "Counting sets of objects",
        "Count a set of objects one at a time and give the total.",
        ("visual", "game-interaction"),
    ),
    Skill(
        "comparing-lengths",
        "Comparing and ordering lengths",
        "Compare two or more objects by length, directly or by sight.",
        ("visual", "game-interaction"),
    ),
    Skill(
        "addition-within-ten",
        "Addition within ten",
        "Add two small groups to find a total of ten or fewer.",
        ("numeric", "visual", "game-interaction"),
        ("counting-sets",),
    ),
    Skill(
        "patterns",
        "Recognizing and continuing patterns",
        "Identify a repeating pattern and predict what comes next.",
        ("visual", "game-interaction"),
        ("counting-sets",),
    ),
    Skill(
        "measurement",
        "Measuring and comparing size",
        "Measure an object using a non-standard or standard unit and compare results.",
        ("visual", "numeric", "game-interaction"),
        ("comparing-lengths",),
    ),
    Skill(
        "subtraction-within-ten",
        "Subtraction within ten",
        "Take away part of a group of ten or fewer and find how many remain.",
        ("numeric", "word-problem"),
        ("addition-within-ten",),
    ),
    Skill(
        "multiplication-facts",
        "Multiplication facts",
        "Find the total of equal groups, such as 6 groups of 7.",
        ("numeric", "visual", "word-problem"),
        ("addition-within-ten",),
    ),
    Skill(
        "observation",
        "Careful observation of the natural world",
        "Look closely at something and say what you notice about it.",
        ("visual", "game-interaction"),
    ),
    Skill(
        "classification",
        "Sorting things by what they are",
        "Put things into groups by shape, colour, or what they are used for.",
        ("visual", "game-interaction"),
        ("observation",),
    ),
    Skill(
        "cause-and-effect",
        "Understanding cause and effect",
        "Say what happens next, and why one thing made another thing happen.",
        ("visual", "word-problem", "game-interaction"),
        ("observation",),
    ),
    Skill(
        "animal-science",
        "Learning how animals live and behave",
        "Find out what an animal eats, where it lives, and how it moves.",
        ("visual", "word-problem"),
        ("observation",),
    ),
)
_SKILLS_BY_ID = {skill.id: skill for skill in SKILLS}

TUTOR_STRATEGIES: tuple[str, ...] = (
    "EXPLAIN",
    "ASK_GUIDING_QUESTION",
    "GIVE_HINT",
    "ENCOURAGE",
    "SWITCH_REPRESENTATION",
)
# The hint ladder's rungs, in order (`TUTOR_STRATEGY_BY_HINT_LEVEL`).
TUTOR_STRATEGY_BY_HINT_LEVEL: tuple[str, ...] = (
    "ENCOURAGE",
    "ASK_GUIDING_QUESTION",
    "GIVE_HINT",
    "SWITCH_REPRESENTATION",
    "EXPLAIN",
)

KNOWN_STATUSES = frozenset({"PROFICIENT", "MASTERED"})


def get_skill(skill_id: str) -> Skill | None:
    return _SKILLS_BY_ID.get(skill_id)


def list_prerequisites(skill_id: str) -> list[Skill]:
    skill = get_skill(skill_id)
    if skill is None:
        return []
    return [p for p in (get_skill(i) for i in skill.prerequisite_skill_ids) if p is not None]


def allowed_vocabulary_for_skill(skill_id: str) -> list[str] | None:
    """`allowedVocabularyForSkill`: core plus skill words, de-duplicated and sorted."""
    words = SKILL_VOCABULARY.get(skill_id)
    if words is None:
        return None
    # JavaScript's default sort compares UTF-16 code units; every word here is ASCII.
    return sorted(set(CORE_TUTOR_VOCABULARY) | set(words))


def is_tutorable_skill(skill_id: str) -> bool:
    return get_skill(skill_id) is not None and allowed_vocabulary_for_skill(skill_id) is not None


def strategy_for_hint_level(hint_level: float) -> str:
    clamped = min(max(js_round(hint_level), 1), MAX_HINT_LEVEL)
    return TUTOR_STRATEGY_BY_HINT_LEVEL[clamped - 1]


def disallowed_curriculum_terms(text: str, allowed_vocabulary: list[str] | tuple[str, ...]):
    allowed = {word.lower() for word in allowed_vocabulary}
    return [
        term
        for term, pattern in _TERM_PATTERNS
        if term.lower() not in allowed and pattern.search(text)
    ]


@dataclass(frozen=True, slots=True)
class TutorContext:
    """Everything the tutor route may know (`TutorContext` in `tutor/types.ts`)."""

    age_band: str
    strategy: str
    max_length: int
    skill_title: str
    skill_description: str
    allowed_vocabulary: tuple[str, ...]
    known_prerequisite_titles: tuple[str, ...]
    allowed_representations: tuple[str, ...]
    hint_level: int
    quest_title: str | None = None
    quest_stage_title: str | None = None
    authored_base_text: str | None = None
    extra: dict = field(default_factory=dict, compare=False, repr=False)

    def as_dict(self) -> dict:
        """The TypeScript shape, with absent optionals omitted (JSON-normalised)."""
        data = {
            "ageBand": self.age_band,
            "strategy": self.strategy,
            "maxLength": self.max_length,
            "skillTitle": self.skill_title,
            "skillDescription": self.skill_description,
            "allowedVocabulary": list(self.allowed_vocabulary),
            "knownPrerequisiteTitles": list(self.known_prerequisite_titles),
            "allowedRepresentations": list(self.allowed_representations),
            "questTitle": self.quest_title,
            "questStageTitle": self.quest_stage_title,
            "hintLevel": self.hint_level,
            "authoredBaseText": self.authored_base_text,
        }
        return {key: value for key, value in data.items() if value is not None}


def build_tutor_context(
    *,
    age_band: str,
    skill_id: str,
    hint_level: int,
    mastery_summaries: list[dict] | None = None,
    quest_title: str | None = None,
    quest_stage_title: str | None = None,
    authored_base_text: str | None = None,
) -> TutorContext | None:
    """`buildTutorContext`. `mastery_summaries` is `[{skillId, status}]`, statuses only."""
    skill = get_skill(skill_id)
    allowed = allowed_vocabulary_for_skill(skill_id)
    if skill is None or allowed is None:
        return None
    status_by_skill = {s["skillId"]: s["status"] for s in mastery_summaries or []}
    known = tuple(
        p.title for p in list_prerequisites(skill_id) if status_by_skill.get(p.id) in KNOWN_STATUSES
    )
    return TutorContext(
        age_band=age_band,
        strategy=strategy_for_hint_level(hint_level),
        max_length=MAX_SPOKEN_LENGTH_BY_AGE_BAND[age_band],
        skill_title=skill.title,
        skill_description=skill.description,
        allowed_vocabulary=tuple(allowed),
        known_prerequisite_titles=known,
        allowed_representations=skill.representations,
        hint_level=hint_level,
        quest_title=quest_title,
        quest_stage_title=quest_stage_title,
        authored_base_text=authored_base_text,
    )
