"""LAI-0801: the structured editor reads and writes bodies through the kind's own schema."""

import copy

import pytest
from django.http import QueryDict

from apps.catalog import authoring, authoring_forms
from apps.catalog.importer import import_content
from apps.catalog.models import Location, NpcDefinition, Quest
from apps.catalog.tests.helpers import write_export
from apps.catalog.tests.test_authoring import collections_with_npc

pytestmark = [pytest.mark.postgres, pytest.mark.django_db]

SEP = authoring_forms.SEP


@pytest.fixture
def imported(tmp_path):
    collections = collections_with_npc()
    collections["npcs.json"]["npcs"][0]["dialogue"] = [
        {
            "id": "hello",
            "text": "Ahoy, friend!",
            "conditions": [],
            "choices": [{"id": "ask", "label": "What do you do?", "nextNodeId": "work"}],
        },
        {"id": "work", "text": "I mend ships.", "choices": [], "conditions": []},
    ]
    import_content(write_export(tmp_path / "v1", collections))


def kind_of(name):
    return authoring.kinds()[name]


def post_of(rows, **extra):
    """What a browser would submit for the rendered rows, unchanged."""
    post = QueryDict(mutable=True)
    for row in rows:
        if not row.name:
            continue
        if row.widget == "checkbox":
            post[f"{row.name}__present"] = "1"
            if row.value:
                post[row.name] = "on"
        elif row.widget == "multiselect":
            post.setlist(row.name, row.value)
        else:
            post[row.name] = "" if row.value is None else str(row.value)
    for key, value in extra.items():
        post[key.replace("__", SEP)] = value
    return post


def body_of(name, **keys):
    kind = kind_of(name)
    model = kind.model
    return copy.deepcopy(authoring.current_body(model.objects.get(**keys)))


@pytest.mark.parametrize(
    ("kind", "keys"),
    [
        ("place", {"slug": "bay"}),
        ("npc", {"npc_id": "pip"}),
        ("quest", {"slug": "repair"}),
        ("adventure", {"slug": "fix-bridge"}),
    ],
)
def test_an_unedited_form_returns_the_same_body(imported, kind, keys):
    body = body_of(kind, **keys)
    rows, unplaced = authoring_forms.rows_for(kind_of(kind), body)
    assert unplaced == []
    assert authoring_forms.read_body(kind_of(kind), post_of(rows), body) == body


def test_dialogue_is_a_list_of_rows_with_choices_nested(imported):
    body = body_of("npc", npc_id="pip")
    rows, _ = authoring_forms.rows_for(kind_of("npc"), body)
    headings = [r.label for r in rows if r.widget == "heading"]
    assert "Dialogue 1" in headings and "Dialogue 2" in headings and "Choices 1" in headings
    text = next(r for r in rows if r.path == "$.dialogue[0].text")
    assert (text.widget, text.value) == ("textarea", "Ahoy, friend!")
    assert any(op.startswith("add" + SEP + "dialogue") for r in rows for op, _ in r.controls)


def test_editing_one_field_changes_only_that_field(imported):
    body = body_of("npc", npc_id="pip")
    rows, _ = authoring_forms.rows_for(kind_of("npc"), body)
    post = post_of(rows)
    post[f"f{SEP}dialogue{SEP}0{SEP}text"] = "Welcome aboard!"
    edited = authoring_forms.read_body(kind_of("npc"), post, body)
    expected = copy.deepcopy(body)
    expected["dialogue"][0]["text"] = "Welcome aboard!"
    assert edited == expected


def test_the_id_cannot_be_changed_through_the_form(imported):
    body = body_of("place", slug="bay")
    rows, _ = authoring_forms.rows_for(kind_of("place"), body)
    post = post_of(rows)
    post[f"f{SEP}slug"] = "hijacked"
    assert authoring_forms.read_body(kind_of("place"), post, body)["slug"] == "bay"


def test_references_are_selectors_and_missing_ones_are_flagged(imported):
    body = body_of("quest", slug="repair")
    rows, _ = authoring_forms.rows_for(kind_of("quest"), body)
    giver = next(r for r in rows if r.path == "$.giverNpcId")
    assert giver.widget == "select" and ("pip", "pip") in giver.options
    assert not giver.unknown_reference
    body["giverNpcId"] = "ghost"
    rows, _ = authoring_forms.rows_for(kind_of("quest"), body)
    assert next(r for r in rows if r.path == "$.giverNpcId").unknown_reference

    solve = next(r for r in rows if r.path.endswith(".adventureSlug"))
    assert solve.widget == "select"
    assert ("fix-bridge", "fix-bridge") in solve.options


def test_enums_are_selects_and_lists_of_text_are_lines(imported):
    rows, _ = authoring_forms.rows_for(kind_of("quest"), body_of("quest", slug="repair"))
    kind = next(r for r in rows if r.path.endswith(".kind"))
    assert kind.widget == "select" and ("SOLVE", "SOLVE") in kind.options
    bay_rows, _ = authoring_forms.rows_for(kind_of("place"), body_of("place", slug="bay"))
    skills = next(r for r in bay_rows if r.path == "$.skills")
    assert (skills.widget, skills.value) == ("lines", "Counting")


def test_problems_attach_to_the_field_that_has_them(imported):
    body = body_of("npc", npc_id="pip")
    problems = ["$.dialogue[0].text: longer than 160 characters", "$: something general"]
    rows, unplaced = authoring_forms.rows_for(kind_of("npc"), body, problems)
    text = next(r for r in rows if r.path == "$.dialogue[0].text")
    assert text.errors == ["longer than 160 characters"]
    assert unplaced == ["$: something general"]


class TestRepeatableRows:
    def test_add_appends_a_valid_blank_row(self, imported):
        body = body_of("npc", npc_id="pip")
        operation = f"add{SEP}dialogue"
        grown = authoring_forms.apply_operation(kind_of("npc"), body, operation)
        assert len(grown["dialogue"]) == 3
        assert grown["dialogue"][2].get("id") == ""  # required keys exist, empty for the author

    def test_add_works_on_a_nested_list(self, imported):
        body = body_of("npc", npc_id="pip")
        grown = authoring_forms.apply_operation(
            kind_of("npc"), body, f"add{SEP}dialogue{SEP}1{SEP}choices"
        )
        assert len(grown["dialogue"][1]["choices"]) == 1

    def test_remove_up_and_down(self, imported):
        body = body_of("npc", npc_id="pip")
        removed = authoring_forms.apply_operation(
            kind_of("npc"), body, f"remove{SEP}dialogue{SEP}0"
        )
        assert [n["id"] for n in removed["dialogue"]] == ["work"]
        moved = authoring_forms.apply_operation(kind_of("npc"), body, f"up{SEP}dialogue{SEP}1")
        assert [n["id"] for n in moved["dialogue"]] == ["work", "hello"]
        down = authoring_forms.apply_operation(kind_of("npc"), body, f"down{SEP}dialogue{SEP}0")
        assert [n["id"] for n in down["dialogue"]] == ["work", "hello"]
        # edges do nothing
        same = authoring_forms.apply_operation(kind_of("npc"), body, f"up{SEP}dialogue{SEP}0")
        assert same == body

    def test_an_unknown_operation_is_refused(self, imported):
        with pytest.raises(authoring_forms.EditorError):
            authoring_forms.apply_operation(kind_of("npc"), body_of("npc", npc_id="pip"), "boom")

    def test_rows_removed_from_the_form_are_dropped(self, imported):
        body = body_of("npc", npc_id="pip")
        rows, _ = authoring_forms.rows_for(kind_of("npc"), body)
        post = post_of(rows)
        for key in [k for k in post if k.startswith(f"f{SEP}dialogue{SEP}1{SEP}")]:
            del post[key]
        assert len(authoring_forms.read_body(kind_of("npc"), post, body)["dialogue"]) == 1


class TestUnionsAndFreeForm:
    def test_a_reward_rule_trigger_is_a_kind_select_with_that_kinds_fields(self):
        body = {
            "id": "r1",
            "message": "Well done",
            "itemIds": [],
            "trigger": {"type": "QUEST_COMPLETED", "questId": "repair"},
        }
        rows, _ = authoring_forms.rows_for(kind_of("reward-rule"), body)
        trigger = next(r for r in rows if r.path == "$.trigger.type")
        assert trigger.widget == "select" and trigger.value == "QUEST_COMPLETED"
        assert any(r.path == "$.trigger.questId" for r in rows)
        assert not any(r.path == "$.trigger.templateSlug" for r in rows)

    def test_changing_the_trigger_kind_switches_the_fields_that_are_kept(self):
        body = {
            "id": "r1",
            "message": "Well done",
            "itemIds": [],
            "trigger": {"type": "QUEST_COMPLETED", "questId": "repair"},
        }
        rows, _ = authoring_forms.rows_for(kind_of("reward-rule"), body)
        post = post_of(rows)
        post[f"f{SEP}trigger{SEP}type"] = "ADVENTURE_COMPLETED"
        out = authoring_forms.read_body(kind_of("reward-rule"), post, body)
        assert out["trigger"]["type"] == "ADVENTURE_COMPLETED"
        assert "questId" not in out["trigger"]

    def test_a_kind_without_a_schema_is_edited_through_its_current_shape(self):
        kind = authoring.Kind(
            "demo", Location, "slug", "slug", None, lambda row: {}, lambda r, b, p: lambda: None
        )
        body = {
            "slug": "demo",
            "title": "Telescope",
            "copy": {"intro": "Look up", "tips": ["Wait", "Look"]},
            "ageBands": {"PATHFINDER": {"features": [{"id": "moon", "label": "Moon"}]}},
        }
        rows, _ = authoring_forms.rows_for(kind, body)
        post = post_of(rows)
        assert authoring_forms.read_body(kind, post, body) == body
        post[f"f{SEP}copy{SEP}intro"] = "Look closely"
        assert authoring_forms.read_body(kind, post, body)["copy"]["intro"] == "Look closely"
        grown = authoring_forms.apply_operation(
            kind, body, f"add{SEP}ageBands{SEP}PATHFINDER{SEP}features"
        )
        assert grown["ageBands"]["PATHFINDER"]["features"][1] == {"id": "", "label": ""}

    def test_malformed_json_in_a_free_form_box_is_reported_not_saved(self):
        kind = authoring.Kind(
            "demo", Location, "slug", "slug", None, lambda row: {}, lambda r, b, p: lambda: None
        )
        body = {"slug": "demo", "extra": {}}
        rows, _ = authoring_forms.rows_for(kind, body)
        post = post_of(rows)
        post[f"f{SEP}extra"] = "{not json"
        # an empty inferred object has no properties, so it is a JSON box
        with pytest.raises(authoring_forms.EditorError) as error:
            authoring_forms.read_body(kind, post, body)
        assert "not valid JSON" in error.value.problems[0]


class TestNumbersAndBooleans:
    def test_a_number_box_reads_ints_and_floats_and_rejects_text(self):
        kind = kind_of("npc")
        body = {"id": "pip", "dialogue": [{"id": "a", "text": "x", "awardsRelationshipPoints": 2}]}
        rows, _ = authoring_forms.rows_for(kind, body)
        post = post_of(rows)
        name = f"f{SEP}dialogue{SEP}0{SEP}awardsRelationshipPoints"
        post[name] = "2.5"
        assert (
            authoring_forms.read_body(kind, post, body)["dialogue"][0]["awardsRelationshipPoints"]
            == 2.5
        )
        post[name] = "lots"
        with pytest.raises(authoring_forms.EditorError):
            authoring_forms.read_body(kind, post, body)

    def test_an_unticked_checkbox_reads_false_and_an_untouched_optional_field_stays_absent(self):
        kind = kind_of("npc")
        body = {"id": "pip", "dialogue": [{"id": "a", "text": "x", "followUpOnly": True}]}
        rows, _ = authoring_forms.rows_for(kind, body)
        post = post_of(rows)
        del post[f"f{SEP}dialogue{SEP}0{SEP}followUpOnly"]
        out = authoring_forms.read_body(kind, post, body)
        assert out["dialogue"][0]["followUpOnly"] is False
        assert "awardsRelationshipPoints" not in out["dialogue"][0]


class TestPreviewAndChanges:
    def test_preview_lists_the_child_text_and_filters_by_age_band(self):
        body = {
            "id": "pip",
            "dialogue": [
                {"id": "a", "text": "For little ones", "ageBands": ["SPROUT"]},
                {"id": "b", "text": "For readers", "ageBands": ["EXPLORER"]},
                {"id": "c", "text": "For everyone"},
            ],
        }
        everyone = [t for _, t in authoring_forms.preview_lines(body)]
        assert everyone == ["For little ones", "For readers", "For everyone"]
        sprout = [t for _, t in authoring_forms.preview_lines(body, "SPROUT")]
        assert sprout == ["For little ones", "For everyone"]

    def test_changed_paths_name_what_differs(self):
        old = {"a": "1", "b": {"c": "2"}, "d": [1, 2]}
        new = {"a": "1", "b": {"c": "3"}, "d": [1, 2], "e": "x"}
        assert authoring_forms.changed_paths(old, new) == ["$.b.c: changed", "$.e: added"]


def test_every_authorable_kind_renders_and_round_trips_its_current_body(imported):
    """No kind is left without an editor: each published body renders and reads back unchanged."""
    checked = 0
    for kind in authoring.kinds().values():
        for row in kind.model.objects.all()[:3]:
            body = authoring.current_body(row)
            if authoring.validate(row, body):
                continue  # test data that is not schema-valid has no faithful form
            rows, _ = authoring_forms.rows_for(kind, body)
            assert authoring_forms.read_body(kind, post_of(rows), body) == body, kind.name
            checked += 1
    assert checked >= 3
    assert Quest.objects.exists() and NpcDefinition.objects.exists()


def test_every_record_of_the_real_export_round_trips_unchanged():
    """LAI-0820: the committed export, not only test data, survives the editor unchanged.

    This covers what the small fixtures do not: Firepeak's banded puzzle lines (LAI-0817),
    stories, reward-rule unions and every adventure with its steps.
    """
    import_content()
    failures, checked = [], 0
    for kind in authoring.kinds().values():
        for row in kind.model.objects.all():
            body = authoring.current_body(row)
            if not body:
                continue  # a row with no authored body yet (seed-created, nothing to edit)
            rows, _ = authoring_forms.rows_for(kind, body)
            if authoring_forms.read_body(kind, post_of(rows), body) != body:
                failures.append(f"{kind.name} {kind.key_of(row)}")
            checked += 1
    assert failures == []
    ember = NpcDefinition.objects.get(npc_id="professor-ember")
    assert sum("puzzleLine" in n for n in authoring.current_body(ember)["dialogue"]) == 19
    assert checked > 100
