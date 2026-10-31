"""Import Amplify `ParentProfile` and `ChildProfile` records into Django (LAI-CHILD-001).

Runbook: docs/platform/AMPLIFY_PROFILE_IMPORT.md. Entry point: `manage.py import_amplify_profiles`.

Input is a JSON file of already-exported DynamoDB items (LAI-1101 produces it, read-only):
`{"parentProfiles": [...], "childProfiles": [...]}`, each item with Amplify's attribute names. This
module never calls AWS.

Rules:
- The parent is resolved only from the Cognito `sub` Amplify recorded as the owner (the child's
  `ownerSub`, else its `ParentProfile.owner`, which Amplify stores as `<sub>::<username>`). When
  both exist they must agree. An email address is never read, let alone matched.
- The child keeps its Amplify id, so progress already stored against it stays attached.
- Nothing existing is overwritten or deleted. A child already in Django with the same parent and
  the same settings is `unchanged`; any difference, a different parent, the three-profile cap, or
  what looks like the same child under a new id is reported for a person to decide.
- Planning only reads. `apply` writes the planned creations in one transaction, so a failed run
  writes nothing, and a re-run creates nothing it created before (idempotent by id).
- The report carries ids and outcomes, never a nickname, interest, display name or `sub`.
- Photos stay in Amplify Storage (LAI-1103); the report counts the profiles that have one.
"""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID

from django.db import transaction
from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_naive, make_aware, now

from . import services
from .models import MAX_CHILD_PROFILES, ParentAccount
from .serializers import ChildProfileWrite, ParentProfileWrite

COMPARED_FIELDS = (
    "nickname",
    "age_band",
    "avatar_key",
    "interests",
    "reading_mode",
    "session_minutes",
    "active",
    "ai_enabled",
)


class ImportFileError(ValueError):
    """The export file does not have the documented shape."""


@dataclass
class Outcome:
    kind: str  # "parent" or "child"
    amplify_id: str
    outcome: str
    account_id: str | None = None
    detail: str = ""

    def as_dict(self) -> dict:
        body = {"kind": self.kind, "amplifyId": self.amplify_id, "outcome": self.outcome}
        if self.account_id:
            body["accountId"] = self.account_id
        if self.detail:
            body["detail"] = self.detail
        return body


@dataclass
class Plan:
    outcomes: list[Outcome] = field(default_factory=list)
    parents_to_provision: dict[str, None] = field(default_factory=dict)  # sub -> (ordered set)
    parent_updates: list[tuple[str, dict]] = field(default_factory=list)  # (sub, fields)
    children_to_create: list[tuple[str, UUID, datetime, dict]] = field(default_factory=list)
    photos_left_in_amplify: int = 0

    def summary(self) -> dict:
        counts = Counter((item.kind, item.outcome) for item in self.outcomes)
        return {f"{kind}.{outcome}": total for (kind, outcome), total in sorted(counts.items())}

    def report(self, *, applied: bool) -> dict:
        return {
            "applied": applied,
            "summary": self.summary(),
            "photosLeftInAmplifyStorage": self.photos_left_in_amplify,
            "records": [item.as_dict() for item in self.outcomes],
        }


def owner_sub(owner) -> str | None:
    """Amplify's owner field is `<sub>::<username>` (or a bare `sub` in older rows)."""
    if not isinstance(owner, str) or not owner.strip():
        return None
    return owner.split("::", 1)[0].strip() or None


def plan_import(export: dict, *, provision_parents: bool = False) -> Plan:
    parents, children = _read_export(export)
    plan = Plan()
    accounts: dict[str, ParentAccount | None] = {}

    def account_for(sub):
        if sub not in accounts:
            accounts[sub] = ParentAccount.objects.filter(cognito_sub=sub).first()
        return accounts[sub]

    parent_subs: dict[str, str | None] = {}
    for item in parents:
        amplify_id = str(item.get("id") or "")
        sub = owner_sub(item.get("owner"))
        parent_subs[amplify_id] = sub
        if not sub:
            plan.outcomes.append(Outcome("parent", amplify_id, "unresolved_owner"))
            continue
        account = account_for(sub)
        if account is None:
            if not provision_parents:
                plan.outcomes.append(Outcome("parent", amplify_id, "not_provisioned"))
                continue
            plan.parents_to_provision[sub] = None
        elif account.admin_username is not None or not account.is_active:
            plan.outcomes.append(Outcome("parent", amplify_id, "account_not_eligible"))
            continue
        outcome, updates, detail = _parent_fields(account, item)
        if updates:
            plan.parent_updates.append((sub, updates))
        plan.outcomes.append(
            Outcome("parent", amplify_id, outcome, account and str(account.pk), detail)
        )

    planned_per_parent: Counter = Counter()
    seen_ids: set[UUID] = set()
    for item in children:
        amplify_id = str(item.get("id") or "")
        try:
            child_id = UUID(amplify_id)
        except ValueError:
            plan.outcomes.append(Outcome("child", amplify_id, "invalid_id"))
            continue
        if child_id in seen_ids:
            plan.outcomes.append(Outcome("child", amplify_id, "duplicate_in_export"))
            continue
        seen_ids.add(child_id)
        if item.get("avatarPhotoKey"):
            plan.photos_left_in_amplify += 1

        sub = owner_sub(item.get("ownerSub"))
        via_parent = parent_subs.get(str(item.get("parentProfileId") or ""))
        if sub and via_parent and sub != via_parent:
            plan.outcomes.append(Outcome("child", amplify_id, "owner_mismatch"))
            continue
        sub = sub or via_parent
        if not sub:
            plan.outcomes.append(Outcome("child", amplify_id, "unresolved_owner"))
            continue
        account = account_for(sub)
        if account is None and sub not in plan.parents_to_provision:
            if not provision_parents:
                plan.outcomes.append(Outcome("child", amplify_id, "parent_not_provisioned"))
                continue
            plan.parents_to_provision[sub] = None
        if account is not None and (account.admin_username is not None or not account.is_active):
            plan.outcomes.append(Outcome("child", amplify_id, "account_not_eligible"))
            continue
        account_id = account and str(account.pk)

        fields, problem = _child_fields(item)
        if problem:
            plan.outcomes.append(Outcome("child", amplify_id, "invalid", account_id, problem))
            continue

        existing = services.child_profile_for_import(child_id)
        if existing is not None:
            if account is None or existing.parent_id != account.pk:
                plan.outcomes.append(Outcome("child", amplify_id, "conflict_other_parent"))
            elif _differs(existing, fields):
                changed = ",".join(_differs(existing, fields))
                plan.outcomes.append(Outcome("child", amplify_id, "differs", account_id, changed))
            else:
                plan.outcomes.append(Outcome("child", amplify_id, "unchanged", account_id))
            continue

        owned = services.child_profiles_for_import(account) if account else []
        if any(
            child.nickname.strip().casefold() == fields["nickname"].strip().casefold()
            and child.age_band == fields["age_band"]
            for child in owned
        ):
            plan.outcomes.append(Outcome("child", amplify_id, "possible_duplicate", account_id))
            continue
        if len(owned) + planned_per_parent[sub] >= MAX_CHILD_PROFILES:
            plan.outcomes.append(Outcome("child", amplify_id, "limit_reached", account_id))
            continue

        planned_per_parent[sub] += 1
        plan.children_to_create.append((sub, child_id, _created_at(item), fields))
        plan.outcomes.append(Outcome("child", amplify_id, "create", account_id))
    return plan


def apply_plan(plan: Plan) -> Plan:
    """Write the plan's creations in one transaction. Re-plan first: never apply a stale plan."""
    with transaction.atomic():
        for sub in plan.parents_to_provision:
            services.provision_parent_account(sub)
        for sub, updates in plan.parent_updates:
            services.update_parent_profile(ParentAccount.objects.get(cognito_sub=sub), **updates)
        for sub, child_id, created_at, fields in plan.children_to_create:
            parent = ParentAccount.objects.get(cognito_sub=sub)
            services.import_child_profile(parent, child_id, created_at, **fields)
    return plan


def _read_export(export) -> tuple[list[dict], list[dict]]:
    if not isinstance(export, dict):
        raise ImportFileError("The export must be a JSON object.")
    parents = export.get("parentProfiles", [])
    children = export.get("childProfiles", [])
    if not isinstance(parents, list) or not isinstance(children, list):
        raise ImportFileError("parentProfiles and childProfiles must be lists.")
    if not all(isinstance(item, dict) for item in [*parents, *children]):
        raise ImportFileError("Every record must be a JSON object.")
    return parents, children


def _parent_fields(account, item) -> tuple[str, dict, str]:
    """Fill a blank Django display name or time zone from Amplify; never overwrite one.

    Each field is validated on its own with the `PATCH /me/` serializer: an invalid value is
    skipped and reported, and does not block the other.
    """
    fields, notes = {}, []
    for key in ("displayName", "timezone"):
        value = item.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        body = ParentProfileWrite(data={key: value}, partial=True)
        if body.is_valid():
            fields.update(body.model_fields())
        else:
            notes.append(f"invalid_{key}")
    if account is None:
        return "provision", fields, ",".join(notes)
    updates = {name: value for name, value in fields.items() if not getattr(account, name)}
    notes += [
        f"kept_{name}"
        for name, value in fields.items()
        if getattr(account, name) not in ("", value)
    ]
    return ("update" if updates else "unchanged"), updates, ",".join(notes)


def _child_fields(item) -> tuple[dict, str]:
    """Validate with the API's own request serializer, so an import accepts exactly what a parent
    could have entered. Amplify's optional fields get their accepted defaults."""
    interests = item.get("interests") or []
    data = {
        "nickname": item.get("nickname"),
        "ageBand": item.get("ageBand"),
        "avatarKey": item.get("avatarKey"),
        "interests": [value for value in interests if value is not None]
        if isinstance(interests, list)
        else interests,
        "readingMode": item.get("readingMode"),
        "sessionMinutes": item.get("sessionMinutes"),
        "active": item.get("active") is not False,
        "aiEnabled": item.get("aiEnabled") is not False,
    }
    body = ChildProfileWrite(data=data)
    if not body.is_valid():
        return {}, ",".join(sorted(body.errors))
    fields = body.model_fields()
    fields.setdefault("interests", [])
    return fields, ""


def _differs(existing, fields) -> list[str]:
    return [name for name in COMPARED_FIELDS if getattr(existing, name) != fields[name]]


def _created_at(item) -> datetime:
    value = parse_datetime(item["createdAt"]) if isinstance(item.get("createdAt"), str) else None
    if value is None:
        return now()
    return make_aware(value) if is_naive(value) else value
