"""One Django backbone (ADR-033, POST-MERGE-03): regression checks for the consolidation.

Every model that owns a child's data goes through the one `ChildOwnedModel` base (ownership,
UUID keys, `for_child`, the cross-child link check), no model concept is defined twice, and
the retired parallel catalogs are gone.
"""

from django.apps import apps

from apps.core.models import ChildOwnedModel

# Rows keyed to a child that are not child-owned records in their own right.
NOT_CHILD_OWNED = {
    "users.ChildProfile",  # the child itself
    "game_sessions.CoopParticipant",  # membership of a household session, reached through it
}


def _project_models():
    return [m for m in apps.get_models() if m.__module__.startswith("apps.")]


def _label(model) -> str:
    return f"{model._meta.app_label}.{model.__name__}"


def test_every_model_holding_a_childs_data_uses_the_one_child_owned_base():
    child_profile = apps.get_model("users", "ChildProfile")
    offenders = [
        _label(model)
        for model in _project_models()
        if _label(model) not in NOT_CHILD_OWNED
        and any(
            getattr(field, "related_model", None) is child_profile for field in model._meta.fields
        )
        and not issubclass(model, ChildOwnedModel)
    ]
    assert offenders == []


def test_no_model_name_is_defined_twice_across_apps():
    names = [model.__name__ for model in _project_models()]
    assert sorted({n for n in names if names.count(n) > 1}) == []


def test_the_parallel_treasure_rush_catalog_apps_are_not_installed():
    labels = {config.label for config in apps.get_app_configs()}
    assert labels.isdisjoint({"islands"})
    assert "adventures" not in labels  # the engine package has no models and is not an app
