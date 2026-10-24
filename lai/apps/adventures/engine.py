"""The authoritative adventure engine (LAI-0601, ADR-019 sub-decision 8).

A line-for-line port of the TypeScript engine, pinned by the golden vectors in
`tests/golden/adventure-engine.json` (`tests/golden/test_adventure_engine_python.py` runs every
case). Pure functions over the exported step records (`AdventureStep.source`), no Django, no
database. No behaviour is corrected here; quirks the vectors document are kept on purpose:

- number answers compare exactly (`4 == 4.0`, as in JavaScript); a boolean is never a number;
- a matching answer that repeats one correct pair as many times as there are pairs is correct;
- `next_hint_level` does not validate its input (`-1` gives `0`);
- reflection, narrative, world-change and complete steps are `not_applicable` for any answer.

TypeScript ports:
- `validate_step_answer`  <- engine/validators.ts `validateStepAnswer`
- `next_step_id`          <- engine/transitions.ts `getNextStepId`
- `next_hint_level`, `is_guided_completion`, `hint_text` <- engine/hints.ts
- `decide_submission`, `is_step_answer` <- engine/submission.ts
"""

from typing import Any

MAX_HINT_LEVEL = 5

Step = dict[str, Any]
Answer = dict[str, Any]

CORRECT, INCORRECT, PARTIAL, NOT_APPLICABLE = "correct", "incorrect", "partial", "not_applicable"
UNGRADED_KINDS = ("reflection", "narrative", "world-change", "complete")


class EngineError(ValueError):
    """An answer or step the engine cannot evaluate (the TypeScript functions throw)."""


class AnswerKindMismatch(EngineError):
    pass


class NoTransition(EngineError):
    pass


class _Undefined:
    """JavaScript's `undefined`: equal only to itself."""

    def __repr__(self) -> str:
        return "undefined"


_UNDEFINED = _Undefined()


def _prop(value: Any, key: str) -> Any:
    """`value[key]` in JavaScript: a missing property (or a primitive's) is `undefined`."""
    return value.get(key, _UNDEFINED) if isinstance(value, dict) else _UNDEFINED


def _js_truthy(value: Any) -> bool:
    """JavaScript `Boolean(value)` for JSON values: every object and list is true."""
    if isinstance(value, (dict, list)):
        return True
    return bool(value)


def _is_number(value: Any) -> bool:
    """JavaScript `typeof value === 'number'` for JSON values: bool is not a number in JS."""
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _same(a: Any, b: Any) -> bool:
    """JavaScript `===` for JSON scalars: no bool/number coercion, and 4 === 4.0."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_number(a) and _is_number(b):
        return a == b
    if a is _UNDEFINED or b is _UNDEFINED:
        return a is b
    return type(a) is type(b) and a == b


def validate_step_answer(step: Step, answer: Answer) -> str:
    presentation = step["presentation"]
    kind, answer_kind = presentation["kind"], answer.get("kind")

    if kind == "number-input" and answer_kind == "number-input":
        return CORRECT if _same(_prop(answer, "value"), presentation["correctValue"]) else INCORRECT

    if kind == "choice" and answer_kind == "choice":
        return CORRECT if _same(_prop(answer, "optionId"), presentation["correctOptionId"]) else INCORRECT

    if kind == "ordering" and answer_kind == "ordering":
        order, correct = answer["order"], presentation["correctOrder"]
        exact = len(order) == len(correct) and all(_same(x, y) for x, y in zip(order, correct))
        return CORRECT if exact else INCORRECT

    if kind == "matching" and answer_kind == "matching":
        expected = {pair["leftId"]: pair["rightId"] for pair in presentation["pairs"]}

        def matches(pair: Any) -> bool:
            # `expected.get(pair.leftId) === pair.rightId`, with JavaScript's `undefined`: a
            # missing key and a missing property are both _UNDEFINED, and equal to each other.
            if pair is None:
                raise EngineError("A matching pair is null.")  # TypeError in JavaScript
            left = _prop(pair, "leftId")
            try:
                got = expected.get(left, _UNDEFINED) if isinstance(left, str) else _UNDEFINED
            except TypeError:
                got = _UNDEFINED
            return _same(got, _prop(pair, "rightId"))

        pairs = answer["pairs"]
        if len(pairs) == len(presentation["pairs"]) and all(matches(p) for p in pairs):
            return CORRECT
        return PARTIAL if any(matches(p) for p in pairs) else INCORRECT

    if kind == "short-response" and answer_kind == "short-response":
        accepted = presentation["acceptedOptionIds"]
        option_id = _prop(answer, "optionId")
        return CORRECT if any(_same(option_id, option) for option in accepted) else INCORRECT

    if kind == "creative-choice" and answer_kind == "creative-choice":
        return NOT_APPLICABLE

    if kind in UNGRADED_KINDS:
        return NOT_APPLICABLE

    raise AnswerKindMismatch(f'Answer kind "{answer_kind}" does not match step "{step.get("id")}".')


def next_step_id(step: Step, correctness: str) -> str:
    transitions = step.get("transitions", [])
    for rule in transitions:
        if rule["when"] == correctness:
            return rule["nextStepId"]
    for rule in transitions:
        if rule["when"] == "always":
            return rule["nextStepId"]
    raise NoTransition(f'Step "{step.get("id")}" has no transition for "{correctness}".')


def next_hint_level(current_level: int | float) -> int | float:
    return min(current_level + 1, MAX_HINT_LEVEL)


def is_guided_completion(hint_level: int | float) -> bool:
    return hint_level >= MAX_HINT_LEVEL


def hint_text(step: Step, level: int | float) -> str | None:
    """`getHintText`: the ladder line for `level`, with JavaScript array indexing (a fractional
    or out-of-range index is `undefined`, never Python's negative-index wraparound)."""
    policy = step.get("hintPolicy")
    if level <= 0 or not _js_truthy(policy):
        return None
    ladder = policy.get("ladder", []) if isinstance(policy, dict) else []
    index = min(level, len(ladder)) - 1
    if not float(index).is_integer() or index < 0 or index >= len(ladder):
        return None
    return ladder[int(index)]


def decide_submission(step: Step, answer: Answer, hint_level: int | float) -> dict[str, Any]:
    """`decideSubmission`: retry and escalate on a hinted step, else advance."""
    correctness = validate_step_answer(step, answer)
    needs_retry = correctness in (INCORRECT, PARTIAL) and _js_truthy(step.get("hintPolicy"))
    if needs_retry:
        escalated = next_hint_level(hint_level)
        if is_guided_completion(escalated):
            return {"correctness": CORRECT, "supportLevel": escalated, "action": "ADVANCE",
                    "nextStepId": next_step_id(step, CORRECT)}
        return {"correctness": correctness, "supportLevel": escalated, "action": "RETRY"}
    return {"correctness": correctness, "supportLevel": hint_level, "action": "ADVANCE",
            "nextStepId": next_step_id(step, correctness)}


def is_step_answer(value: Any) -> bool:
    """`isStepAnswer`: the shallow shape check at the request boundary."""
    if not isinstance(value, dict) or "kind" not in value:
        return False
    kind = value["kind"]
    if kind == "number-input":
        return _is_number(value.get("value"))
    if kind in ("choice", "short-response", "creative-choice"):
        return isinstance(value.get("optionId"), str)
    if kind == "ordering":
        return isinstance(value.get("order"), list)
    if kind == "matching":
        return isinstance(value.get("pairs"), list)
    return kind in ("reflection", "narrative", "world-change")
