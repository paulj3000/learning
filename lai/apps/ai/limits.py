"""Bounds for AI turns (CLAUDE.md sections 3 and 7).

`MAX_SPOKEN_LENGTH_BY_AGE_BAND` mirrors `react/src/features/companion/limits.ts` and is enforced
twice: sent to the model as `maxLength`, and checked again on the response. The input bounds are
Django's (LAI-0704): the Amplify routes accepted any string length.
"""

MAX_SPOKEN_LENGTH_BY_AGE_BAND: dict[str, int] = {
    "SPROUT": 120,
    "PATHFINDER": 200,
    "EXPLORER": 320,
}

# `MAX_HINT_LEVEL` in react/src/features/adventures/engine/hints.ts.
MAX_HINT_LEVEL = 5

# Client-supplied fields (characters). Authored copy is short; anything longer is not authored.
MAX_TEMPLATE_ID = 100
MAX_STEP_SUMMARY = 300
MAX_AUTHORED_BASE_TEXT = 500
MAX_CORRELATION_ID = 100
MAX_CHOICE_IDS = 6
MAX_CHOICE_ID = 64
MAX_OBJECTIVE_CODE = 100
