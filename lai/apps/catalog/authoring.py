"""Versioned content authoring (ADR-047, LAI-0810) and session version pinning (LAI-0813).

Every authorable record keeps its catalog row and gains immutable `ContentRevision`s. This
module is the only writer of revisions and the only code that copies a revision's body into a
row. Each record kind registers a `Kind`: how to read the row's current body, which JSON
Schema definition validates a body, and how a body is applied to the row (the same per-record
functions the importer uses, `apps.catalog.records`). Other apps register their own kinds
(`education`, `regions`) from `AppConfig.ready`.

Rules the service enforces, each covered by tests:

- A published revision never changes and nothing is ever deleted (ADR-047-Q3).
- Publishing re-validates in full and refuses with every problem listed; nothing is half-applied.
- An administrator's publish makes the record Django-owned (`ContentAuthority.DJANGO`); an import
  never changes a Django-owned record (`record_import`).
- Rollback publishes an earlier body as a new `ROLLBACK` revision; history only grows.
- A session pins the published revisions it starts with; `body_for(session, row)` returns the
  pinned body, so a publish during a visit cannot change that visit's dialogue or grading.
"""

import copy
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings
from django.contrib.admin.models import ADDITION, CHANGE, DELETION, LogEntry
from django.contrib.contenttypes.models import ContentType
from django.db import models, transaction
from django.utils.timezone import now

from apps.ai import content_safety
from apps.core import content_schema

from . import records
from .models import (
    ART_ASSET_KINDS,
    Adventure,
    AdventureStep,
    CollectibleSet,
    ContentAsset,
    ContentAuthority,
    ContentRelease,
    ContentRevision,
    ItemDefinition,
    LearningObjective,
    Location,
    NpcDefinition,
    Quest,
    RevisionOrigin,
    RevisionStatus,
    RewardRule,
    Story,
    World,
)

# The longest single piece of child-facing text a body may hold (CLAUDE.md section 13: short,
# readable aloud). Long-form authoring belongs to stories, which are not authorable here yet.
MAX_CHILD_TEXT = 600
# ADR-047 D: maximum lengths per age band. A text under an `ageBands` list is held to the
# shortest limit of the bands it lists; text outside any list gets the general limit.
BAND_TEXT_LIMITS = {"SPROUT": 160, "PATHFINDER": 320, "EXPLORER": MAX_CHILD_TEXT}
EM_DASH = "—"
MAX_REASON = 300

EDIT_PERMISSION = "catalog.edit_content_draft"
PUBLISH_PERMISSION = "catalog.publish_content"
EDIT_JSON_PERMISSION = "catalog.edit_content_json"


class PublishRefused(Exception):
    """The body is not valid. `problems` lists every reason, safe to show an administrator."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


class NotPermitted(PermissionError):
    """The person lacks the permission this step needs (checked here, not only in the admin)."""


class RetireNeedsConfirmation(Exception):
    """Open sessions use the record. `sessions` names them; confirm by passing exactly these."""

    def __init__(self, sessions: list[str]):
        super().__init__(f"{len(sessions)} open session(s) use this record")
        self.sessions = sessions


def independent_approval_required() -> bool:
    """Owner-set option (ADR-047-Q1): off by default, one administrator may edit and publish."""
    return bool(getattr(settings, "LAI_CONTENT_INDEPENDENT_APPROVAL", False))


def _require(user, permission: str) -> None:
    allowed = (
        user is not None
        and getattr(user, "is_active", False)
        and getattr(user, "is_staff", False)
        and user.has_perm(permission)
    )
    if not allowed:
        raise NotPermitted(f"This step needs the {permission.split('.')[-1]} permission.")


def _log(user, row_or_revision, flag: int, message: str) -> None:
    """One Django admin-log entry on the revision (ADR-047 D). No child data is recorded."""
    if user is None or not getattr(user, "pk", None):
        return
    revision = row_or_revision
    LogEntry.objects.create(
        user_id=user.pk,
        content_type=ContentType.objects.get_for_model(ContentRevision),
        object_id=str(revision.pk),
        object_repr=str(revision)[:200],
        action_flag=flag,
        change_message=message[:1000],
    )


@dataclass(frozen=True)
class Kind:
    """How one record kind is authored.

    `apply(row, body, problems)` validates references and sets the row's columns from `body`,
    appending problems instead of raising; it returns a callable that saves the row and its
    relations, run only when there are no problems.
    """

    name: str
    model: type[models.Model]
    key_field: str
    body_key: str
    schema_definition: str | None
    read_body: Callable[[models.Model], dict]
    apply: Callable[[models.Model, dict, list[str]], Callable[[], None]]
    child_facing_paths: tuple[str, ...] = field(default=("",))
    """Body keys whose strings a child reads ("" = the whole body)."""
    schema_body: Callable[[models.Model, dict], dict] | None = None
    """The record as the schema sees it, when the body leaves part of it to other rows."""

    def key_of(self, row: models.Model) -> str:
        return str(getattr(row, self.key_field))


_KINDS: dict[str, Kind] = {}


def register(kind: Kind) -> None:
    _KINDS[kind.name] = kind


def kinds() -> dict[str, Kind]:
    return dict(_KINDS)


def kind_for(row_or_model) -> Kind:
    model = row_or_model if isinstance(row_or_model, type) else type(row_or_model)
    for kind in _KINDS.values():
        if kind.model is model:
            return kind
    raise LookupError(f"{model.__name__} is not an authorable kind")


def _identity(row: models.Model) -> dict[str, Any]:
    return {
        "content_type": ContentType.objects.get_for_model(type(row)),
        "object_id": str(row.pk),
    }


def revisions_for(row: models.Model):
    return ContentRevision.objects.filter(**_identity(row)).order_by("-number")


def current_body(row: models.Model) -> dict:
    """The body of the row's published content, as the row holds it (a copy, safe to edit)."""
    return copy.deepcopy(kind_for(row).read_body(row))


# --- Validation ----------------------------------------------------------------------------------


def _strings(value: Any, path: str = "$") -> Iterable[tuple[str, str]]:
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _strings(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _strings(item, f"{path}[{index}]")


def _band_limit(bands: list[str] | None) -> int:
    known = [BAND_TEXT_LIMITS[b] for b in bands or [] if b in BAND_TEXT_LIMITS]
    return min(known) if known else MAX_CHILD_TEXT


def _texts(value: Any, path: str, limit: int) -> Iterable[tuple[str, str, int]]:
    """Strings with the length limit that applies to each (an `ageBands` list narrows it)."""
    if isinstance(value, str):
        yield path, value, limit
    elif isinstance(value, dict):
        bands = value.get("ageBands")
        if isinstance(bands, list) and all(isinstance(b, str) for b in bands):
            limit = min(limit, _band_limit(bands))
        for key, item in value.items():
            yield from _texts(item, f"{path}.{key}", limit)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _texts(item, f"{path}[{index}]", limit)


def safety_categories(text: str) -> list[str]:
    """Content-safety screening shared with Question Studio (`apps.ai.content_safety`, no model).

    A hit means a person must rewrite the text; the screen never edits it.
    """
    found = list(content_safety.boundary_violations(text))
    if content_safety.requests_personal_information(text):
        found.append("personal-information")
    return sorted(set(found))


def copy_problems(body: dict, paths: tuple[str, ...]) -> list[str]:
    """CLAUDE.md section 13 rules and content-safety screening for child-facing text."""
    problems = []
    for key in paths:
        scope = body if key == "" else body.get(key)
        for path, value, limit in _texts(scope, "$" if key == "" else f"$.{key}", MAX_CHILD_TEXT):
            if EM_DASH in value:
                problems.append(f"{path}: child-facing text must not use an em dash")
            if len(value) > limit:
                problems.append(f"{path}: longer than {limit} characters")
            lowered = value.lower()
            if ("<" in value and ">" in value) or "http://" in lowered or "https://" in lowered:
                problems.append(f"{path}: plain text only (no markup or links)")
            elif content_safety.contains_url(value):
                problems.append(f"{path}: plain text only (no web addresses)")
            for category in safety_categories(value):
                problems.append(f"{path}: failed the child-safety check ({category})")
    return problems


def validate(row: models.Model, body: object) -> list[str]:
    """Every problem with publishing `body` for `row`. Never writes."""
    kind = kind_for(row)
    if not isinstance(body, dict):
        return ["$: must be a JSON object"]
    problems: list[str] = []
    if body.get(kind.body_key) != kind.key_of(row):
        problems.append(
            f"$.{kind.body_key}: must stay {kind.key_of(row)!r} (a record's id never changes)"
        )
    if kind.schema_definition:
        checked = kind.schema_body(row, body) if kind.schema_body else body
        try:
            content_schema.validate_record(kind.schema_definition, checked)
        except content_schema.ContentSchemaError as error:
            problems.extend(error.errors[:20])
    problems.extend(copy_problems(body, kind.child_facing_paths))
    if not problems:
        kind.apply(row, body, problems)  # reference checks only; nothing is saved
    return problems


# --- Writing revisions ---------------------------------------------------------------------------


def _next_number(row: models.Model) -> int:
    latest = revisions_for(row).values_list("number", flat=True).first()
    return (latest or 0) + 1


def _supersede_current(row: models.Model) -> None:
    for revision in revisions_for(row).filter(status=RevisionStatus.PUBLISHED):
        revision.status = RevisionStatus.SUPERSEDED
        revision.save(update_fields=["status"])


def record_published(
    row: models.Model,
    body: dict,
    *,
    origin: str,
    release: ContentRelease | None = None,
    note: str = "",
) -> ContentRevision:
    """Record content the row already holds as its published revision (import, seed, migration).

    The caller has already written the row's columns; this only adds history and the pointer.
    Authority is unchanged.
    """
    kind = kind_for(row)
    _supersede_current(row)
    at = now()
    revision = ContentRevision.objects.create(
        kind=kind.name,
        record_key=kind.key_of(row),
        number=_next_number(row),
        body=body,
        status=RevisionStatus.PUBLISHED,
        origin=origin,
        content_release=release,
        note=note,
        created_at=at,
        published_at=at,
        **_identity(row),
    )
    type(row).objects.filter(pk=row.pk).update(published_revision=revision)
    row.published_revision = revision
    return revision


def record_import_draft(row: models.Model, body: dict, release: ContentRelease) -> bool:
    """An export change for a Django-owned record, kept as a draft for an administrator.

    Returns True when a new draft was recorded, False when the same export body is already
    recorded (as a draft or as the last import) so repeated imports add nothing.
    """
    kind = kind_for(row)
    last_import = (
        revisions_for(row).filter(origin=RevisionOrigin.IMPORT).values_list("body", flat=True)
    ).first()
    if last_import == body:
        return False
    ContentRevision.objects.create(
        kind=kind.name,
        record_key=kind.key_of(row),
        number=_next_number(row),
        body=body,
        status=RevisionStatus.DRAFT,
        origin=RevisionOrigin.IMPORT,
        content_release=release,
        note="Export changed after this record was edited in Django Admin; not published.",
        **_identity(row),
    )
    return True


def create_draft(row: models.Model, body: dict, *, user, note: str = "") -> ContentRevision:
    _require(user, EDIT_PERMISSION)
    kind = kind_for(row)
    draft = ContentRevision.objects.create(
        kind=kind.name,
        record_key=kind.key_of(row),
        number=_next_number(row),
        body=body,
        status=RevisionStatus.DRAFT,
        origin=RevisionOrigin.ADMIN,
        based_on=row.published_revision,
        created_by=user,
        note=note,
        validation_report=validate(row, body),
        **_identity(row),
    )
    _log(user, draft, ADDITION, f"Started draft {draft.number}.")
    return draft


def use_exported_version(row: models.Model, *, user) -> ContentRevision:
    """Start a draft from the latest exported (IMPORT) body of a Django-owned record (ADR-047 J).

    The draft keeps the IMPORT origin, so publishing it hands the record back to the export.
    Nothing is applied until it is published normally.
    """
    _require(user, EDIT_PERMISSION)
    exported = (
        revisions_for(row)
        .filter(origin=RevisionOrigin.IMPORT)
        .exclude(status=RevisionStatus.DISCARDED)
        .first()
    )
    if exported is None:
        raise PublishRefused(["This record has no exported version."])
    if exported.status == RevisionStatus.PUBLISHED or exported.body == current_body(row):
        raise PublishRefused(["The exported version is already the published one."])
    if exported.status == RevisionStatus.DRAFT:
        return exported  # the import already kept it as a draft; reopen that one
    draft = ContentRevision.objects.create(
        kind=exported.kind,
        record_key=exported.record_key,
        number=_next_number(row),
        body=exported.body,
        status=RevisionStatus.DRAFT,
        origin=RevisionOrigin.IMPORT,
        based_on=row.published_revision,
        created_by=user,
        note=f"Uses the exported version (version {exported.number}).",
        validation_report=validate(row, exported.body),
        **_identity(row),
    )
    _log(user, draft, ADDITION, f"Started draft {draft.number} from the exported version.")
    return draft


def update_draft(revision: ContentRevision, body: dict, *, user, note: str | None = None) -> None:
    _require(user, EDIT_PERMISSION)
    if revision.status != RevisionStatus.DRAFT:
        raise PublishRefused(["Only a draft can be edited. Create a new draft instead."])
    revision.body = body
    if note is not None:
        revision.note = note
    revision.validation_report = validate(row_of(revision), body)
    revision.save(update_fields=["body", "note", "validation_report"])
    _log(user, revision, CHANGE, f"Saved draft {revision.number}.")


def discard(revision: ContentRevision, *, user) -> None:
    _require(user, EDIT_PERMISSION)
    if revision.status not in (RevisionStatus.DRAFT, RevisionStatus.REJECTED):
        raise PublishRefused(["Only a draft or a returned version can be discarded."])
    revision.status = RevisionStatus.DISCARDED
    revision.save(update_fields=["status"])
    _log(user, revision, DELETION, f"Discarded version {revision.number} (kept in history).")


def row_of(revision: ContentRevision) -> models.Model:
    return revision.content_type.get_object_for_this_type(pk=revision.object_id)


# --- Review: submit, withdraw, return, reopen (LAI-0818) ----------------------------------------


@transaction.atomic
def submit(revision: ContentRevision, *, user) -> ContentRevision:
    """Send a draft to an approver. Only a draft with no problems can be submitted."""
    _require(user, EDIT_PERMISSION)
    revision = ContentRevision.objects.select_for_update().get(pk=revision.pk)
    if revision.status != RevisionStatus.DRAFT:
        raise PublishRefused([f"Version {revision.number} is not a draft."])
    problems = validate(row_of(revision), revision.body)
    if problems:
        revision.validation_report = problems
        revision.save(update_fields=["validation_report"])
        raise PublishRefused(problems)
    revision.status = RevisionStatus.SUBMITTED
    revision.submitted_by, revision.submitted_at = user, now()
    revision.rejection_reason = ""
    revision.validation_report = []
    revision.save(
        update_fields=[
            "status",
            "submitted_by",
            "submitted_at",
            "rejection_reason",
            "validation_report",
        ]
    )
    _log(user, revision, CHANGE, f"Submitted version {revision.number} for approval.")
    return revision


@transaction.atomic
def withdraw(revision: ContentRevision, *, user) -> ContentRevision:
    """Take a submitted version back to a draft (the person who submitted it, or any editor)."""
    _require(user, EDIT_PERMISSION)
    revision = ContentRevision.objects.select_for_update().get(pk=revision.pk)
    if revision.status != RevisionStatus.SUBMITTED:
        raise PublishRefused([f"Version {revision.number} is not waiting for approval."])
    revision.status = RevisionStatus.DRAFT
    revision.save(update_fields=["status"])
    _log(user, revision, CHANGE, f"Withdrew version {revision.number} to a draft.")
    return revision


@transaction.atomic
def reject(revision: ContentRevision, *, user, reason: str) -> ContentRevision:
    """Return a submitted version to its author with a reason an author can act on."""
    _require(user, PUBLISH_PERMISSION)
    reason = (reason or "").strip()
    if not reason:
        raise PublishRefused(["Say why the version is being returned."])
    if len(reason) > MAX_REASON:
        raise PublishRefused([f"The reason is longer than {MAX_REASON} characters."])
    revision = ContentRevision.objects.select_for_update().get(pk=revision.pk)
    if revision.status != RevisionStatus.SUBMITTED:
        raise PublishRefused([f"Version {revision.number} is not waiting for approval."])
    if independent_approval_required() and revision.submitted_by_id == user.pk:
        raise PublishRefused(["A different administrator must review this version."])
    revision.status = RevisionStatus.REJECTED
    revision.reviewed_by, revision.reviewed_at = user, now()
    revision.rejection_reason = reason
    revision.save(update_fields=["status", "reviewed_by", "reviewed_at", "rejection_reason"])
    _log(user, revision, CHANGE, f"Returned version {revision.number}: {reason}")
    return revision


@transaction.atomic
def reopen(revision: ContentRevision, *, user) -> ContentRevision:
    """Make a returned version editable again. The reason stays on record."""
    _require(user, EDIT_PERMISSION)
    revision = ContentRevision.objects.select_for_update().get(pk=revision.pk)
    if revision.status != RevisionStatus.REJECTED:
        raise PublishRefused([f"Version {revision.number} was not returned."])
    revision.status = RevisionStatus.DRAFT
    revision.save(update_fields=["status"])
    _log(user, revision, CHANGE, f"Reopened version {revision.number} as a draft.")
    return revision


@transaction.atomic
def publish(revision: ContentRevision, *, user) -> ContentRevision:
    """Validate and publish a draft or a submitted version. The record becomes Django-owned
    unless the draft came from an import (choosing the exported version keeps it export-owned).

    With independent approval on, only a submitted version can be published, and never by the
    person who submitted it.
    """
    _require(user, PUBLISH_PERMISSION)
    revision = ContentRevision.objects.select_for_update().get(pk=revision.pk)
    if revision.status not in (RevisionStatus.DRAFT, RevisionStatus.SUBMITTED):
        raise PublishRefused([f"Version {revision.number} is not a draft."])
    if independent_approval_required():
        if revision.status != RevisionStatus.SUBMITTED:
            raise PublishRefused(["Submit this version for approval first."])
        if revision.submitted_by_id == user.pk:
            raise PublishRefused(["A different administrator must approve this version."])
    return _publish(revision, user=user, message="Published")


def _publish(revision: ContentRevision, *, user, message: str) -> ContentRevision:
    row = type(row_of(revision)).objects.select_for_update().get(pk=revision.object_id)
    kind = kind_for(row)
    problems = validate(row, revision.body)
    if problems:
        revision.validation_report = problems
        revision.save(update_fields=["validation_report"])
        raise PublishRefused(problems)
    finish = kind.apply(row, revision.body, problems)
    if problems:  # validate() already ran apply; this is a defensive second look
        raise PublishRefused(problems)
    finish()
    _supersede_current(row)
    was_submitted = revision.status == RevisionStatus.SUBMITTED
    revision.status = RevisionStatus.PUBLISHED
    revision.published_by = user
    revision.published_at = now()
    revision.validation_report = []
    fields = ["status", "published_by", "published_at", "validation_report"]
    if was_submitted:
        revision.reviewed_by, revision.reviewed_at = user, revision.published_at
        fields += ["reviewed_by", "reviewed_at"]
    revision.save(update_fields=fields)
    authority = (
        ContentAuthority.EXPORT
        if revision.origin == RevisionOrigin.IMPORT
        else ContentAuthority.DJANGO
    )
    type(row).objects.filter(pk=row.pk).update(published_revision=revision, authority=authority)
    _log(user, revision, CHANGE, f"{message} version {revision.number}.")
    return revision


@transaction.atomic
def rollback(target: ContentRevision, *, user) -> ContentRevision:
    """Publish an earlier published body again, as a new revision (ADR-047 E).

    A restored body was published before, so it is not sent for a second approval, even when
    independent approval is on; it is still fully validated and screened, and needs the
    publish permission.
    """
    _require(user, PUBLISH_PERMISSION)
    if target.status not in (RevisionStatus.SUPERSEDED, RevisionStatus.PUBLISHED):
        raise PublishRefused(["Only a version that was published can be restored."])
    row = row_of(target)
    kind = kind_for(row)
    draft = ContentRevision.objects.create(
        kind=kind.name,
        record_key=kind.key_of(row),
        number=_next_number(row),
        body=target.body,
        status=RevisionStatus.DRAFT,
        origin=RevisionOrigin.ROLLBACK,
        based_on=target,
        created_by=user,
        note=f"Restores version {target.number}.",
        **_identity(row),
    )
    return _publish(
        ContentRevision.objects.select_for_update().get(pk=draft.pk),
        user=user,
        message=f"Restored version {target.number} as",
    )


# --- Retirement (ADR-047 D and E) ----------------------------------------------------------------


def open_sessions_using(row: models.Model) -> list[str]:
    """Open sessions that pinned this record, named by short session id (no child data)."""
    from apps.game_sessions.models import OPEN_STATUSES, AdventureSession

    sessions = AdventureSession.objects.filter(
        status__in=OPEN_STATUSES,
        pinned_revisions__content_type=ContentType.objects.get_for_model(type(row)),
        pinned_revisions__object_id=str(row.pk),
    ).distinct()
    return sorted(str(pk)[:8] for pk in sessions.values_list("pk", flat=True))


@transaction.atomic
def set_active(
    row: models.Model, active: bool, *, user, confirm_sessions: list[str] | None = None
) -> None:
    """Retire (`active=False`) or restore a record that has a catalog `active` switch.

    Retiring a record an open session uses needs `confirm_sessions` to name exactly those
    sessions. Recorded in the Django admin log.
    """
    _require(user, PUBLISH_PERMISSION)
    if not hasattr(row, "active"):
        raise PublishRefused(["This kind of record has no active switch."])
    if not active:
        using = open_sessions_using(row)
        if using and sorted(confirm_sessions or []) != using:
            raise RetireNeedsConfirmation(using)
    type(row).objects.filter(pk=row.pk).update(active=active)
    row.active = active
    record_active_change(row, user)


def record_active_change(row: models.Model, user) -> None:
    """Admin-log a retirement or restoration (also used by the record's own admin page)."""
    revision = row.published_revision
    if revision is not None:
        kind = kind_for(row)
        verb = "Restored" if row.active else "Retired"
        _log(user, revision, CHANGE, f"{verb} {kind.name} {kind.key_of(row)}.")


# --- Session pinning (LAI-0813) ------------------------------------------------------------------


def pin(session, rows: Iterable[models.Model]) -> None:
    """Pin the published revision of each row to `session` (once; a pin never moves)."""
    pinned_types = {
        (revision.content_type_id, revision.object_id)
        for revision in session.pinned_revisions.all()
    }
    to_add = []
    for row in rows:
        if row is None or row.published_revision_id is None:
            continue
        key = (ContentType.objects.get_for_model(type(row)).pk, str(row.pk))
        if key not in pinned_types:
            pinned_types.add(key)
            to_add.append(row.published_revision_id)
    if to_add:
        session.pinned_revisions.add(*to_add)


def body_for(session, row: models.Model) -> dict:
    """The body `session` started with for `row`, or the row's published body if not pinned."""
    if session is not None:
        pinned = session.pinned_revisions.filter(**_identity(row)).values_list("body", flat=True)
        body = pinned.first()
        if body is not None:
            return copy.deepcopy(body)
    return current_body(row)


# --- Catalog kinds -------------------------------------------------------------------------------


def _save(row: models.Model, fields: dict, relations: Callable[[], None] | None = None):
    def finish() -> None:
        for name, value in fields.items():
            setattr(row, name, value)
        row.save()
        if relations is not None:
            relations()

    return finish


def _source(row) -> dict:
    return dict(row.source)


def _check_art(body: dict, problems: list[str]) -> None:
    """An optional `artAssetId` must name an image definition in the asset library (AP-03;
    ADR-047 decision D, "asset ids to `ContentAsset` of the right kind"). Whether it
    has a published version is a delivery question: until it does, children see the drawn
    fallback, so publishing the record is not blocked on the asset."""
    asset_id = body.get("artAssetId")
    if asset_id is None:
        return
    asset = ContentAsset.objects.filter(asset_id=asset_id).first()
    if asset is None:
        problems.append(f"$.artAssetId: unknown asset {asset_id!r}")
    elif asset.kind not in ART_ASSET_KINDS:
        problems.append(f"$.artAssetId: {asset_id!r} is a {asset.kind}, not an image")


def _apply_world(row: World, body: dict, problems: list[str]):
    _check_art(body, problems)
    return _save(row, records.world_fields(body, f"island {row.slug!r}", problems))


def _apply_location(row: Location, body: dict, problems: list[str]):
    fields, world_slug = records.location_fields(body, f"place {row.slug!r}", problems)
    world = World.objects.filter(slug=world_slug).first()
    if world is None:
        problems.append(f"$.worldSlug: unknown island {world_slug!r}")
    _check_art(body, problems)
    return _save(row, {**fields, "world": world})


def _apply_adventure(row: Adventure, body: dict, problems: list[str]):
    where = f"adventure {row.slug!r}"
    if "steps" in body:
        problems.append("$.steps: edit each step as its own record")
    step_ids = set(row.steps.values_list("step_id", flat=True))
    fields = records.adventure_fields(body, step_ids, where, problems)
    if fields["location_slug"] != row.location_slug:
        problems.append("$.locationSlug: an Adventure stays in its Place")
    return _save(row, fields)


def _apply_step(row: AdventureStep, body: dict, problems: list[str]):
    where = f"step {row.adventure_id}:{row.step_id}"
    return _save(row, records.step_fields(body, row.position, where, problems))


def _apply_quest(row: Quest, body: dict, problems: list[str]):
    adventure_slugs = set(Adventure.objects.values_list("slug", flat=True))
    fields, solved = records.quest_fields(body, adventure_slugs, f"quest {row.slug!r}", problems)
    item_ids = set(ItemDefinition.objects.values_list("item_id", flat=True))
    for stage in body.get("stages", []):
        for objective in stage.get("objectives", []):
            for item_id in [objective.get("itemId"), *objective.get("itemIds", [])]:
                if item_id and item_id not in item_ids:
                    problems.append(f"objective {objective.get('id')!r}: unknown item {item_id!r}")
    giver = body.get("giverNpcId")
    if giver and not NpcDefinition.objects.filter(npc_id=giver).exists():
        problems.append(f"$.giverNpcId: unknown NPC {giver!r}")

    def relations() -> None:
        row.adventures.set(Adventure.objects.filter(slug__in=solved))

    return _save(row, fields, relations)


def _apply_story(row: Story, body: dict, problems: list[str]):
    adventure_slugs = set(Adventure.objects.values_list("slug", flat=True))
    fields, solved = records.story_fields(body, adventure_slugs, f"story {row.slug!r}", problems)

    def relations() -> None:
        row.adventures.set(Adventure.objects.filter(slug__in=solved))

    return _save(row, fields, relations)


def _apply_objective(row: LearningObjective, body: dict, problems: list[str]):
    return _save(row, records.objective_fields(body, f"objective {row.code!r}", problems))


def _apply_npc(row: NpcDefinition, body: dict, problems: list[str]):
    where = f"npc {row.npc_id!r}"
    fields, home = records.npc_fields(body, where, problems)
    location = Location.objects.select_related("world").filter(slug=home).first()
    bands = tuple(location.world.supported_age_bands) if location else ()
    records.npc_dialogue_problems(body, bands or records.ALL_AGE_BANDS, where, problems)
    quests = set(Quest.objects.values_list("slug", flat=True))
    adventures = set(Adventure.objects.values_list("slug", flat=True))
    for index, node in enumerate(body.get("dialogue", [])):
        if node.get("questId") and node["questId"] not in quests:
            problems.append(f"$.dialogue[{index}].questId: unknown quest {node['questId']!r}")
        slug = node.get("adventureSlug")
        if slug and slug not in adventures:
            problems.append(f"$.dialogue[{index}].adventureSlug: unknown adventure {slug!r}")
    return _save(row, {**fields, "home_location": location})


def _apply_set(row: CollectibleSet, body: dict, problems: list[str]):
    fields, completion = records.collectible_set_fields(body, f"set {row.set_id!r}", problems)
    item = ItemDefinition.objects.filter(item_id=completion).first() if completion else None
    if completion and item is None:
        problems.append(f"$.completionItemId: unknown item {completion!r}")
    return _save(row, {**fields, "completion_item": item})


def _apply_item(row: ItemDefinition, body: dict, problems: list[str]):
    fields, set_id = records.item_fields(body, f"item {row.item_id!r}", problems)
    collectible_set = CollectibleSet.objects.filter(set_id=set_id).first() if set_id else None
    if set_id and collectible_set is None:
        problems.append(f"$.setId: unknown collectible set {set_id!r}")
    return _save(row, {**fields, "collectible_set": collectible_set})


def _apply_rule(row: RewardRule, body: dict, problems: list[str]):
    fields, granted = records.reward_rule_fields(body, f"rule {row.rule_id!r}", problems)
    items = list(ItemDefinition.objects.filter(item_id__in=granted))
    missing = set(granted) - {item.item_id for item in items}
    for item_id in sorted(missing):
        problems.append(f"$.itemIds: unknown item {item_id!r}")
    return _save(row, fields, lambda: row.items.set(items))


for _kind in (
    Kind("island", World, "slug", "slug", "island", _source, _apply_world),
    Kind("place", Location, "slug", "slug", "location", _source, _apply_location),
    Kind(
        "adventure",
        Adventure,
        "slug",
        "slug",
        "adventure",
        _source,
        _apply_adventure,
        schema_body=lambda row, body: {
            **body,
            "steps": [step.source for step in row.steps.order_by("position")],
        },
    ),
    Kind("adventure-step", AdventureStep, "step_id", "id", "adventureStep", _source, _apply_step),
    Kind("quest", Quest, "slug", "id", "quest", _source, _apply_quest),
    Kind("story", Story, "slug", "slug", "story", _source, _apply_story),
    Kind(
        "learning-objective",
        LearningObjective,
        "code",
        "code",
        "learningObjective",
        _source,
        _apply_objective,
    ),
    Kind("npc", NpcDefinition, "npc_id", "id", "npc", _source, _apply_npc),
    Kind("collectible-set", CollectibleSet, "set_id", "id", "collectibleSet", _source, _apply_set),
    Kind("item", ItemDefinition, "item_id", "id", "item", _source, _apply_item),
    Kind("reward-rule", RewardRule, "rule_id", "id", "rewardRule", _source, _apply_rule),
):
    register(_kind)
