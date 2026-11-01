"""Versioned content authoring (ADR-043, LAI-0810) and session version pinning (LAI-0813).

Every authorable record keeps its catalog row and gains immutable `ContentRevision`s. This
module is the only writer of revisions and the only code that copies a revision's body into a
row. Each record kind registers a `Kind`: how to read the row's current body, which JSON
Schema definition validates a body, and how a body is applied to the row (the same per-record
functions the importer uses, `apps.catalog.records`). Other apps register their own kinds
(`education`, `regions`) from `AppConfig.ready`.

Rules the service enforces, each covered by tests:

- A published revision never changes and nothing is ever deleted (ADR-043-Q3).
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

from django.contrib.contenttypes.models import ContentType
from django.db import models, transaction
from django.utils.timezone import now

from apps.core import content_schema

from . import records
from .models import (
    Adventure,
    AdventureStep,
    CollectibleSet,
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
    World,
)

# The longest single piece of child-facing text a body may hold (CLAUDE.md section 13: short,
# readable aloud). Long-form authoring belongs to stories, which are not authorable here yet.
MAX_CHILD_TEXT = 600
EM_DASH = "—"


class PublishRefused(Exception):
    """The body is not valid. `problems` lists every reason, safe to show an administrator."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


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


def copy_problems(body: dict, paths: tuple[str, ...]) -> list[str]:
    """CLAUDE.md section 13 rules for child-facing text an administrator writes."""
    problems = []
    for key in paths:
        scope = body if key == "" else body.get(key)
        for path, value in _strings(scope, "$" if key == "" else f"$.{key}"):
            if EM_DASH in value:
                problems.append(f"{path}: child-facing text must not use an em dash")
            if len(value) > MAX_CHILD_TEXT:
                problems.append(f"{path}: longer than {MAX_CHILD_TEXT} characters")
            lowered = value.lower()
            if ("<" in value and ">" in value) or "http://" in lowered or "https://" in lowered:
                problems.append(f"{path}: plain text only (no markup or links)")
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


def create_draft(row: models.Model, body: dict, *, user=None, note: str = "") -> ContentRevision:
    kind = kind_for(row)
    return ContentRevision.objects.create(
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


def update_draft(revision: ContentRevision, body: dict, *, note: str | None = None) -> None:
    if revision.status != RevisionStatus.DRAFT:
        raise PublishRefused(["Only a draft can be edited. Create a new draft instead."])
    revision.body = body
    if note is not None:
        revision.note = note
    revision.validation_report = validate(row_of(revision), body)
    revision.save(update_fields=["body", "note", "validation_report"])


def discard(revision: ContentRevision) -> None:
    if revision.status != RevisionStatus.DRAFT:
        raise PublishRefused(["Only a draft can be discarded."])
    revision.status = RevisionStatus.DISCARDED
    revision.save(update_fields=["status"])


def row_of(revision: ContentRevision) -> models.Model:
    return revision.content_type.get_object_for_this_type(pk=revision.object_id)


@transaction.atomic
def publish(revision: ContentRevision, *, user=None) -> ContentRevision:
    """Validate and publish a draft. The record becomes Django-owned unless the draft came
    from an import (an administrator choosing the exported version keeps it export-owned)."""
    revision = ContentRevision.objects.select_for_update().get(pk=revision.pk)
    if revision.status != RevisionStatus.DRAFT:
        raise PublishRefused([f"Version {revision.number} is not a draft."])
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
    revision.status = RevisionStatus.PUBLISHED
    revision.published_by = user
    revision.published_at = now()
    revision.validation_report = []
    revision.save(update_fields=["status", "published_by", "published_at", "validation_report"])
    authority = (
        ContentAuthority.EXPORT
        if revision.origin == RevisionOrigin.IMPORT
        else ContentAuthority.DJANGO
    )
    type(row).objects.filter(pk=row.pk).update(published_revision=revision, authority=authority)
    return revision


@transaction.atomic
def rollback(target: ContentRevision, *, user=None) -> ContentRevision:
    """Publish an earlier published body again, as a new revision (ADR-043 E)."""
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
    return publish(draft, user=user)


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


def _apply_world(row: World, body: dict, problems: list[str]):
    return _save(row, records.world_fields(body, f"island {row.slug!r}", problems))


def _apply_location(row: Location, body: dict, problems: list[str]):
    fields, world_slug = records.location_fields(body, f"place {row.slug!r}", problems)
    world = World.objects.filter(slug=world_slug).first()
    if world is None:
        problems.append(f"$.worldSlug: unknown island {world_slug!r}")
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


def _apply_objective(row: LearningObjective, body: dict, problems: list[str]):
    return _save(row, records.objective_fields(body, f"objective {row.code!r}", problems))


def _apply_npc(row: NpcDefinition, body: dict, problems: list[str]):
    fields, home = records.npc_fields(body, f"npc {row.npc_id!r}", problems)
    return _save(row, {**fields, "home_location": Location.objects.filter(slug=home).first()})


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
