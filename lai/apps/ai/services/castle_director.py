"""The Castle Director (SC-R09-01): a model chooses one of the castle's authored ambient events.

`apps.regions.castle_events` recomputes the eligible set on the server and hands this module the
candidates (an id and a one-word mood tag each) and the authored turn behind every id. The
model sees only those ids and tags, plus the age band and room id. It writes no words: its answer
is an id, `validate_castle_choice` requires that id to be in the eligible set, and what the child
sees is the authored line. Every failure path in the one shared pipeline (`run_turn`) returns
`default_turn`, the deterministic default event. The route has no client text
(`untrusted_context` is empty) and writes nothing but the pipeline's audit row, safety event and
usage counters; the caller records the display counter.

A turn here is `{eventId, spokenText, safetyDisposition}`: `spokenText` is the authored lines
joined, so the pipeline's output-policy check also guards authored-copy regressions.
"""

from __future__ import annotations

from functools import partial

from ..contracts import (
    CASTLE_DIRECTOR_OUTPUT_SCHEMA,
    CASTLE_DIRECTOR_OUTPUT_SCHEMA_VERSION,
    validate_castle_choice,
)
from ..models import ContextSource, RouteName
from ..prompts import CASTLE_DIRECTOR_PERSONA
from .pipeline import TurnResult, TurnSpec, run_turn

REPLY_FIELDS = (
    "eventId (string, copied exactly from candidates), safetyDisposition (ALLOW, REDIRECT or STOP)."
)

#: The closed audit `input_category` for this route.
INPUT_CATEGORY = "CASTLE_DIRECTOR"


def build_spec(
    child,
    *,
    room_id: str,
    candidates: list[dict],
    turns: dict[str, dict],
    default_turn: dict,
) -> TurnSpec:
    """`candidates` is `[{id, tag}]`; `turns` maps each candidate id to its authored turn."""
    return TurnSpec(
        route="castle",
        route_name=RouteName.CASTLE_DIRECTOR,
        persona=CASTLE_DIRECTOR_PERSONA,
        output_schema=CASTLE_DIRECTOR_OUTPUT_SCHEMA,
        schema_name="castle_director",
        output_schema_version=CASTLE_DIRECTOR_OUTPUT_SCHEMA_VERSION,
        input_category=INPUT_CATEGORY,
        disposition_category="castle-director",
        context_source=ContextSource.DJANGO_CATALOG,
        trusted_context={
            "ageBand": child.age_band,
            "roomId": room_id,
            "candidates": [{"id": c["id"], "tag": c["tag"]} for c in candidates],
        },
        untrusted_context={},
        reply_fields=REPLY_FIELDS,
        validate=partial(validate_castle_choice, eligible=turns, default_turn=default_turn),
        fallback=lambda _reuse: dict(default_turn),
        redirect=lambda disposition: {**default_turn, "safetyDisposition": disposition},
        fake_hints={"candidateIds": [c["id"] for c in candidates]},
        step_id=room_id[:100],
    )


def request_castle_choice(
    child,
    *,
    room_id: str,
    candidates: list[dict],
    turns: dict[str, dict],
    default_turn: dict,
) -> TurnResult:
    spec = build_spec(
        child, room_id=room_id, candidates=candidates, turns=turns, default_turn=default_turn
    )
    return run_turn(child, spec)
