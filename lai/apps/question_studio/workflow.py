"""Review, approval and publishing (LAI-AQS-016 to 019).

Generation, validation, approval and publishing are separate operations, each permission-checked
and recorded as a `ReviewEvent`. Every function takes the acting user and re-checks permission
itself, so the Admin, a bulk action and a test all go through the same gate.

    DRAFT -> NEEDS_REVIEW -> APPROVED -> PUBLISHED
       \\________\\_________\\--> REJECTED -> DRAFT (reopen)

Editing an APPROVED question sends it back to DRAFT and clears its validation: an approval
covers exactly the content that was validated. A PUBLISHED question is frozen; a correction is a
new draft (`start_correction`) whose publication supersedes the old revision.
"""

from django.db import IntegrityError, transaction
from django.utils.timezone import now

from . import validation
from .generation import NotPermitted, StudioError
from .models import (
    Question,
    QuestionRevision,
    ReviewEvent,
    ReviewStatus,
    RevisionStatus,
    ValidationStatus,
)

EDITABLE = (
    "stem",
    "choices",
    "correct_answer",
    "accepted_answers",
    "operation",
    "operands",
    "hint",
    "explanation",
    "difficulty",
    "topic",
    "skill_code",
    "grade",
    "world",
    "location",
    "adventure",
)


class InvalidTransition(StudioError):
    code = "invalid_transition"


class NotValidated(StudioError):
    code = "not_validated"


class BlockedByValidation(StudioError):
    code = "blocked_by_validation"


class ConcurrentPublish(StudioError):
    code = "concurrent_publish"


def _require(user, codename: str) -> None:
    if not (
        user and user.is_active and user.is_staff and user.has_perm(f"question_studio.{codename}")
    ):
        raise NotPermitted


def _locked(question: Question) -> Question:
    return Question.objects.select_for_update().get(pk=question.pk)


def _record(question, user, action, before, note="") -> None:
    ReviewEvent.objects.create(
        question=question,
        actor=user,
        action=action,
        from_status=before,
        to_status=question.review_status,
        note=note[:300],
    )


def _move(
    question: Question, user, to: str, action: str, note: str = "", *, stamp: bool = False
) -> None:
    before = question.review_status
    question.review_status = to
    if stamp:
        question.reviewed_by, question.reviewed_at = user, now()
    question.save(update_fields=["review_status", "reviewed_by", "reviewed_at", "updated_at"])
    _record(question, user, action, before, note)


@transaction.atomic
def edit(question: Question, user, changes: dict, note: str = "") -> Question:
    """Apply staff edits, then revalidate. Approved content falls back to DRAFT."""
    _require(user, "change_question")
    question = _locked(question)
    if question.review_status == ReviewStatus.PUBLISHED:
        raise InvalidTransition("A published question is frozen; start a correction instead.")
    if question.review_status == ReviewStatus.REJECTED and question.revisions.exists():
        # Retired or superseded: it was withdrawn from play. Editing it back to DRAFT would let
        # it be republished beside its correction (QA-AQS-D1); write a new question instead.
        raise InvalidTransition("A retired or superseded question is frozen.")
    before = question.review_status
    changed = []
    for name, value in changes.items():
        if name in EDITABLE and getattr(question, name) != value:
            setattr(question, name, value)
            changed.append(name)
    if not changed:
        return question
    if question.review_status in (
        ReviewStatus.APPROVED,
        ReviewStatus.NEEDS_REVIEW,
        ReviewStatus.REJECTED,
    ):
        question.review_status = ReviewStatus.DRAFT
    question.validation_status = ValidationStatus.UNVALIDATED
    question.reviewed_by, question.reviewed_at = None, None
    question.save()
    _record(question, user, "edited", before, note or ", ".join(changed))
    validation.run_validation(question)
    return Question.objects.get(pk=question.pk)


@transaction.atomic
def revalidate(question: Question, user) -> Question:
    _require(user, "change_question")
    question = _locked(question)
    if question.review_status == ReviewStatus.PUBLISHED:
        raise InvalidTransition("A published question is not revalidated.")
    findings = validation.run_validation(question)
    question = Question.objects.get(pk=question.pk)
    _record(question, user, "validated", question.review_status, question.validation_status)
    if (
        question.review_status == ReviewStatus.APPROVED
        and validation.status_for(findings) == ValidationStatus.FAIL
    ):
        _move(question, user, ReviewStatus.DRAFT, "approval_withdrawn", "validation now fails")
    return Question.objects.get(pk=question.pk)


def _require_validated(question: Question) -> None:
    if question.validation_run == 0 or question.validation_status == ValidationStatus.UNVALIDATED:
        raise NotValidated("Validate the question first.")
    if question.validation_status == ValidationStatus.FAIL or validation.blocking(question):
        raise BlockedByValidation("Blocking validation findings remain.")


@transaction.atomic
def submit_for_review(question: Question, user) -> Question:
    _require(user, "change_question")
    question = _locked(question)
    if question.review_status != ReviewStatus.DRAFT:
        raise InvalidTransition("Only a draft can be submitted.")
    _require_validated(question)
    _move(question, user, ReviewStatus.NEEDS_REVIEW, "submitted")
    return question


@transaction.atomic
def approve(question: Question, user, note: str = "") -> Question:
    _require(user, "approve_question")
    question = _locked(question)
    if question.review_status not in (ReviewStatus.DRAFT, ReviewStatus.NEEDS_REVIEW):
        raise InvalidTransition(f"Cannot approve a {question.review_status} question.")
    _require_validated(question)
    _move(question, user, ReviewStatus.APPROVED, "approved", note, stamp=True)
    return question


@transaction.atomic
def reject(question: Question, user, note: str = "") -> Question:
    _require(user, "approve_question")
    question = _locked(question)
    if question.review_status in (ReviewStatus.PUBLISHED, ReviewStatus.REJECTED):
        raise InvalidTransition(f"Cannot reject a {question.review_status} question.")
    _move(question, user, ReviewStatus.REJECTED, "rejected", note, stamp=True)
    return question


@transaction.atomic
def reopen(question: Question, user) -> Question:
    _require(user, "approve_question")
    question = _locked(question)
    if question.review_status != ReviewStatus.REJECTED or question.revisions.exists():
        raise InvalidTransition("Only a rejected, never-published question can be reopened.")
    _move(question, user, ReviewStatus.DRAFT, "reopened")
    return question


@transaction.atomic
def publish(question: Question, user) -> QuestionRevision:
    """Freeze an approved, validated question as a new ACTIVE revision. The question row is
    locked, so two staff publishing at once get one revision and one ConcurrentPublish."""
    _require(user, "publish_question")
    question = _locked(question)
    if question.review_status != ReviewStatus.APPROVED:
        raise InvalidTransition("Only an approved question can be published.")
    _require_validated(question)
    # Re-run the checks at the moment of publishing: a duplicate may have appeared since approval.
    fresh = validation.collect(question)
    if validation.status_for(fresh) == ValidationStatus.FAIL:
        raise BlockedByValidation("A blocking finding appeared since approval; revalidate.")
    number = (
        question.revisions.order_by("-number").values_list("number", flat=True).first() or 0
    ) + 1
    try:
        with transaction.atomic():
            revision = QuestionRevision.objects.create(
                question=question,
                number=number,
                content=question.content(),
                content_hash=question.content_hash,
                subject=question.subject,
                grade=question.grade,
                topic=question.topic,
                skill_code=question.skill_code,
                difficulty=question.difficulty,
                question_type=question.question_type,
                adventure_id=question.adventure_id,
                published_by=user,
            )
    except IntegrityError:
        raise ConcurrentPublish from None
    _move(question, user, ReviewStatus.PUBLISHED, "published", f"revision {number}")
    if question.replaces_id:
        _supersede(question.replaces, user)
    return revision


def _supersede(old: Question, user) -> None:
    old = _locked(old)
    old.revisions.filter(status=RevisionStatus.ACTIVE).update(
        status=RevisionStatus.SUPERSEDED, retired_at=now()
    )
    if old.review_status == ReviewStatus.PUBLISHED:
        _move(old, user, ReviewStatus.REJECTED, "superseded", "replaced by a correction")


@transaction.atomic
def start_correction(question: Question, user) -> Question:
    """A new draft copy of a published question. Publishing it supersedes the original's
    revision; attempts already issued from the old revision keep their own snapshot."""
    _require(user, "change_question")
    question = _locked(question)
    if question.review_status != ReviewStatus.PUBLISHED:
        raise InvalidTransition("Only a published question needs a correction.")
    if question.replacements.filter(
        review_status__in=[ReviewStatus.DRAFT, ReviewStatus.NEEDS_REVIEW, ReviewStatus.APPROVED]
    ).exists():
        raise InvalidTransition("A correction is already in progress.")
    copy = Question.objects.create(
        **{
            f: getattr(question, f) for f in EDITABLE if f not in ("world", "location", "adventure")
        },
        world=question.world,
        location=question.location,
        adventure=question.adventure,
        subject=question.subject,
        question_type=question.question_type,
        replaces=question,
        source_model=question.source_model,
        prompt_version=question.prompt_version,
    )
    ReviewEvent.objects.create(
        question=copy,
        actor=user,
        action="correction_started",
        to_status=copy.review_status,
        note=f"of {question.pk}",
    )
    validation.run_validation(copy)
    return Question.objects.get(pk=copy.pk)


@transaction.atomic
def retire(revision: QuestionRevision, user, note: str = "") -> QuestionRevision:
    """Withdraw a revision from play. The question becomes REJECTED; history is untouched."""
    _require(user, "retire_revision")
    revision = QuestionRevision.objects.select_for_update().get(pk=revision.pk)
    if revision.status != RevisionStatus.ACTIVE:
        raise InvalidTransition("Only an active revision can be retired.")
    revision.status, revision.retired_at = RevisionStatus.RETIRED, now()
    revision.save()
    question = _locked(revision.question)
    if question.review_status == ReviewStatus.PUBLISHED:
        _move(question, user, ReviewStatus.REJECTED, "retired", note)
    return revision


def bulk(action, questions, user, **kwargs) -> tuple[list[Question], list[tuple[Question, str]]]:
    """Apply `action` to each question independently. A refusal for one (permission, state,
    validation) never blocks the others; the caller reports `(done, [(question, code)])`."""
    done, refused = [], []
    for question in questions:
        try:
            action(question, user, **kwargs)
            done.append(question)
        except StudioError as error:
            refused.append((question, error.code))
    return done, refused
