"""Server-written audit rows, safety events and the turn metric (LAI-0702, LAI-0704).

Best effort, as in the Amplify client: a failed write never blocks or changes a child's turn. It
is logged as an exception type (ADR-025) and counted by the `ai.turn` line's `audit=failed`.

Every value written here was computed by the server. Nothing in a request body can choose a
validation status, disposition, category, severity or review status.
"""

import logging
from dataclasses import dataclass

from django.db import DatabaseError, transaction

from apps.core.request_context import get_request_id

from ..models import AIInteractionAudit, SafetyEvent, SafetyEventSeverity

logger = logging.getLogger("lai.ai")


@dataclass
class AuditFields:
    route_name: str
    prompt_template_version: int
    model_id: str
    input_category: str
    output_schema_version: int
    validation_status: str
    safety_disposition: str
    fallback_used: bool
    provider: str
    context_source: str
    guardrail_id: str = ""
    guardrail_version: str = ""
    guardrail_action: str = "NOT_APPLIED"
    failure_category: str = ""
    latency_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    session_id: str = ""
    step_id: str = ""


@dataclass(frozen=True)
class SafetyFields:
    category: str
    severity: str
    source: str
    action_taken: str


def record(child, audit: AuditFields, safety: SafetyFields | None) -> bool:
    """Writes the audit row and, when given, its safety event. Returns False on failure."""
    request_id = get_request_id()
    try:
        with transaction.atomic():
            row = AIInteractionAudit(
                child=child, request_id=request_id, **{k: v for k, v in vars(audit).items()}
            )
            row.save()
            if safety is not None:
                SafetyEvent(
                    child=child,
                    session_id=audit.session_id,
                    route_name=audit.route_name,
                    audit=row,
                    request_id=request_id,
                    category=safety.category,
                    severity=safety.severity,
                    source=safety.source,
                    action_taken=safety.action_taken,
                ).save()
        return True
    except DatabaseError:
        logger.exception("ai.audit write failed")
        return False


def severity_for(disposition: str) -> str:
    return SafetyEventSeverity.HIGH if disposition == "STOP" else SafetyEventSeverity.MEDIUM


def emit_metric(audit: AuditFields, *, source: str, audited: bool) -> None:
    """One line per turn, closed vocabulary only (no ids, no text). A CloudWatch metric filter
    on `ai.turn` counts fallbacks, blocks and failures (docs/AI_SERVICE.md section 7)."""
    logger.info(
        "ai.turn route=%s source=%s status=%s disposition=%s failure=%s guardrail=%s "
        "provider=%s context=%s latency_ms=%s audit=%s",
        audit.route_name,
        source,
        audit.validation_status,
        audit.safety_disposition,
        audit.failure_category or "-",
        audit.guardrail_action,
        audit.provider,
        audit.context_source,
        audit.latency_ms if audit.latency_ms is not None else "-",
        "ok" if audited else "failed",
    )
