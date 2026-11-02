"""Chatty's tutoring turn, the Django replacement for `generateTutorTurn` (LAI-0703).

The model never picks the strategy (the hint ladder does, `strategy_for_hint_level`), never
sees mastery counts (only which prerequisite titles are known), and never offers choices
(the contract has none). Correctness and progress stay with the adventure engine.
"""

from ..contracts import TUTOR_OUTPUT_SCHEMA, TUTOR_OUTPUT_SCHEMA_VERSION, validate_tutor_turn
from ..fallbacks import tutor_authored_fallback, tutor_redirect
from ..models import ContextSource, RouteName
from ..prompts import TUTOR_PERSONA
from ..tutor_content import build_tutor_context, is_tutorable_skill, strategy_for_hint_level
from . import context as ctx
from .pipeline import TurnResult, TurnSpec, run_turn

REPLY_FIELDS = (
    "spokenText (string, comfortably under maxLength characters), strategy (exactly the "
    "requested strategy), representation (one of allowedRepresentations for "
    "SWITCH_REPRESENTATION, otherwise null), emotion (CHEERFUL, CURIOUS, CALM or ENCOURAGING), "
    "safetyDisposition (ALLOW, REDIRECT or STOP)."
)


class SkillNotInStep(Exception):
    """A DJANGO_SESSION tutor turn named a skill that is not the step's objective: 400."""


def request_tutor_turn(child, data: dict) -> TurnResult:
    skill_id = data["skillId"]
    if data["contextSource"] == ContextSource.DJANGO_SESSION:
        step = ctx.load_session_step(child, data["sessionId"], data["stepId"])
        if skill_id not in step.objective_ids:
            raise SkillNotInStep
        hint_level = step.hint_level
        authored_base_text = step.hint_text(hint_level)
        session_id, step_id, template_id = step.session_id, step.step_id, step.template_id
        client_text = {}
    else:
        hint_level = data["hintLevel"]
        authored_base_text = data.get("authoredBaseText")
        session_id, step_id = data.get("sessionId", ""), data.get("stepId", "")
        template_id = data["templateId"]
        client_text = {"authoredBaseText": authored_base_text}

    strategy = strategy_for_hint_level(hint_level)

    def fallback(reuse: bool) -> dict:
        return tutor_authored_fallback(strategy, authored_base_text, reuse_authored_text=reuse)

    # Not tutorable: authored content without a model call or audit row (the Amplify behaviour;
    # a skill with no reviewed word list must never open an unbounded prompt).
    if not is_tutorable_skill(skill_id):
        from .safety import screen_untrusted_text

        return TurnResult(fallback(not screen_untrusted_text(client_text)), "FALLBACK")

    quest_title, quest_stage_title = ctx.active_quest_copy(child)
    context = build_tutor_context(
        age_band=child.age_band,
        skill_id=skill_id,
        hint_level=hint_level,
        mastery_summaries=ctx.prerequisite_mastery(child, skill_id),
        quest_title=quest_title,
        quest_stage_title=quest_stage_title,
        # Server-derived hint text is trusted context; client text goes in `untrusted` only.
        authored_base_text=authored_base_text if not client_text else None,
    )
    context_dict = context.as_dict()
    trusted = {"adventureTemplateId": template_id, **context_dict}
    # The validator sees the same context the TypeScript one would, authored text included.
    validation_context = {**context_dict, "authoredBaseText": authored_base_text}

    spec = TurnSpec(
        route="tutor",
        route_name=RouteName.TUTOR,
        persona=TUTOR_PERSONA,
        output_schema=TUTOR_OUTPUT_SCHEMA,
        schema_name="tutor_turn",
        output_schema_version=TUTOR_OUTPUT_SCHEMA_VERSION,
        input_category=f"TUTOR_{strategy}",
        disposition_category=f"tutor-turn-{strategy.lower()}",
        context_source=data["contextSource"],
        trusted_context=trusted,
        untrusted_context=client_text,
        reply_fields=REPLY_FIELDS,
        validate=lambda raw: validate_tutor_turn(raw, validation_context),
        fallback=fallback,
        redirect=tutor_redirect,
        fake_hints={"strategy": strategy},
        session_id=session_id,
        step_id=step_id,
    )
    return run_turn(child, spec)
