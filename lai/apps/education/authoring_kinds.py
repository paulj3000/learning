"""`ChallengeSpec` as an authorable kind (ADR-047 B). Registered from `EducationConfig.ready`.

Its parameters are checked by the model's own `clean()` (TR-1 `validate_parameters`), the same
rule a seed or admin save runs. A `ChallengeAttempt` snapshots the parameters it was issued
with, and a region session pins the spec's version (LAI-0813), so a publish never regrades.
"""

import copy

from django.core.exceptions import ValidationError

from apps.catalog.authoring import Kind, register

from .models import ChallengeSpec

FIELDS = {
    "title": "title",
    "ageBand": "age_band",
    "skillId": "skill_id",
    "minValue": "min_value",
    "maxValue": "max_value",
    "responseMode": "response_mode",
    "choiceCount": "choice_count",
}


def _body(spec: ChallengeSpec) -> dict:
    return {"slug": spec.slug, **{key: getattr(spec, name) for key, name in FIELDS.items()}}


def _apply(spec: ChallengeSpec, body: dict, problems: list[str]):
    unknown = set(body) - {"slug", *FIELDS}
    if unknown:
        problems.append(f"$: unknown keys {', '.join(sorted(unknown))}")
    candidate = copy.copy(spec)
    for key, name in FIELDS.items():
        setattr(candidate, name, body.get(key))
    try:
        candidate.full_clean()
    except ValidationError as error:
        for name, messages in error.message_dict.items():
            problems.append(f"{name}: {'; '.join(messages)}")

    def finish() -> None:
        for key, name in FIELDS.items():
            setattr(spec, name, body[key])
        spec.save()

    return finish


def register_kinds() -> None:
    # The title is an admin-only label (never shown to a child), so no copy rules apply.
    register(Kind("challenge-spec", ChallengeSpec, "slug", "slug", None, _body, _apply, ()))
