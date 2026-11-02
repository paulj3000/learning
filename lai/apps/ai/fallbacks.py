"""Authored, non-AI turns (CLAUDE.md section 7: every response has a fallback authored in code).

Copied from `react/src/features/companion/fallback.ts` and `react/src/features/tutor/fallback.ts`;
the golden vectors (`companionFallbackTurns`, `tutorFallbackTurns`) prove the copy is identical.
Child-facing, readable aloud, no em dashes.

The `*_authored_fallback` functions port the private `authoredFallback` helpers of
`companion/api.ts` and `tutor/api.ts`. One Django difference: authored text supplied by a client
is only reused when `reuse_authored_text` is true, which the pipeline sets only after that text
passed the input screen. A blocked request never echoes its own text back.
"""

import copy

FALLBACK_TURNS: dict[str, dict] = {
    "NARRATE": {
        "spokenText": "Let's see what's next on the island!",
        "emotion": "CURIOUS",
        "intent": "NARRATE",
        "safetyDisposition": "ALLOW",
    },
    "ASK": {
        "spokenText": "What do you think we should try?",
        "emotion": "CURIOUS",
        "intent": "ASK",
        "safetyDisposition": "ALLOW",
    },
    "HINT": {
        "spokenText": "Take a closer look. You can do this!",
        "emotion": "ENCOURAGING",
        "intent": "HINT",
        "safetyDisposition": "ALLOW",
    },
    "CELEBRATE": {
        "spokenText": "Great work! The island is glad you helped.",
        "emotion": "CHEERFUL",
        "intent": "CELEBRATE",
        "safetyDisposition": "ALLOW",
    },
    "REDIRECT": {
        "spokenText": (
            "Let's save that for a grown-up to help with. Want to keep exploring the island?"
        ),
        "emotion": "CALM",
        "intent": "REDIRECT",
        "safetyDisposition": "REDIRECT",
    },
}

FALLBACK_TUTOR_TURNS: dict[str, dict] = {
    "EXPLAIN": {
        "spokenText": "Let's walk through it together, one step at a time.",
        "strategy": "EXPLAIN",
        "emotion": "CALM",
        "safetyDisposition": "ALLOW",
    },
    "ASK_GUIDING_QUESTION": {
        "spokenText": "What do you notice first when you look at it?",
        "strategy": "ASK_GUIDING_QUESTION",
        "emotion": "CURIOUS",
        "safetyDisposition": "ALLOW",
    },
    "GIVE_HINT": {
        "spokenText": "Take a closer look. You can do this!",
        "strategy": "GIVE_HINT",
        "emotion": "ENCOURAGING",
        "safetyDisposition": "ALLOW",
    },
    "ENCOURAGE": {
        "spokenText": "You are working hard on this. Keep going!",
        "strategy": "ENCOURAGE",
        "emotion": "ENCOURAGING",
        "safetyDisposition": "ALLOW",
    },
    "SWITCH_REPRESENTATION": {
        "spokenText": "Let's try looking at it a different way.",
        "strategy": "SWITCH_REPRESENTATION",
        "emotion": "CHEERFUL",
        "safetyDisposition": "ALLOW",
    },
}

TUTOR_REDIRECT_TURN: dict = {
    "spokenText": "Let's save that one for a grown-up. Want to keep going with our adventure?",
    "strategy": "ENCOURAGE",
    "emotion": "CALM",
    "safetyDisposition": "REDIRECT",
}

# Rungs that are meant to withhold the hint, so they never reuse the step's hint text.
_WITHHOLDING_STRATEGIES = frozenset({"ENCOURAGE", "ASK_GUIDING_QUESTION"})


def companion_authored_fallback(
    intent: str, authored_base_text: str | None, *, reuse_authored_text: bool
) -> dict:
    turn = copy.deepcopy(FALLBACK_TURNS[intent])
    if intent == "HINT" and authored_base_text and reuse_authored_text:
        turn["spokenText"] = authored_base_text
    return turn


def companion_redirect(disposition: str) -> dict:
    return {**copy.deepcopy(FALLBACK_TURNS["REDIRECT"]), "safetyDisposition": disposition}


def tutor_authored_fallback(
    strategy: str, authored_base_text: str | None, *, reuse_authored_text: bool
) -> dict:
    turn = copy.deepcopy(FALLBACK_TUTOR_TURNS[strategy])
    if authored_base_text and reuse_authored_text and strategy not in _WITHHOLDING_STRATEGIES:
        turn["spokenText"] = authored_base_text
    return turn


def tutor_redirect(disposition: str) -> dict:
    return {**copy.deepcopy(TUTOR_REDIRECT_TURN), "safetyDisposition": disposition}
