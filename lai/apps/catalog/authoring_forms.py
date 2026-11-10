"""Structured editors for authored content (ADR-047, LAI-0801).

One generic editor serves every authorable kind. It reads the kind's JSON Schema definition
(`content/schema/content.schema.json`, the same one publishing validates against) and turns a
draft body into form rows: text boxes, number boxes, checkboxes, selects for enums, repeatable
rows for lists of objects (dialogue nodes, quest stages, choices) and selectors for references
to other records (items, NPCs, quests, adventures). A kind with no schema definition (3D Area
copy, puzzles, challenge specs) is edited through the shape of its current body.

Nothing here saves. `rows_for` renders, `read_body` turns a POST back into a body and
`apply_operation` handles add, remove and move on repeatable rows. The admin saves the result as
a draft, where the normal validation runs and reports problems against the field that has them.
Free-form parts the schema does not describe stay JSON inside their own box; raw JSON for the
whole body stays behind its own permission (`catalog.edit_content_json`).
"""

import copy
import json
import re
from dataclasses import dataclass, field
from typing import Any

from apps.core import content_schema

from . import authoring

MISSING = object()
SEP = "|"
PREFIX = "f"
OP_FIELD = "op"

# Fields whose value is the key of another authored record, and which kind that is.
REFERENCE_KINDS = {
    "itemId": "item",
    "itemIds": "item",
    "completionItemId": "item",
    "giverNpcId": "npc",
    "npcId": "npc",
    "questId": "quest",
    "questIds": "quest",
    "adventureSlug": "adventure",
    "adventureSlugs": "adventure",
    "templateSlug": "adventure",
    "locationSlug": "place",
    "locationSlugs": "place",
    "homeLocationSlug": "place",
    "worldSlug": "island",
    "setId": "collectible-set",
    "objectiveCode": "learning-objective",
}
LONG_TEXT = {
    "text",
    "description",
    "narration",
    "fallbackText",
    "message",
    "explanation",
    "tagline",
    "prompt",
    "body",
    "summary",
    "copy",
    "hint",
}


@dataclass
class Row:
    """One line of the editor. `widget` is heading, text, textarea, number, checkbox, select,
    multiselect, lines or json."""

    widget: str
    label: str
    name: str = ""
    path: str = ""
    value: Any = ""
    options: list[tuple[str, str]] = field(default_factory=list)
    depth: int = 0
    required: bool = False
    help: str = ""
    errors: list[str] = field(default_factory=list)
    controls: list[tuple[str, str]] = field(default_factory=list)
    """(operation, button label) pairs shown on a heading."""
    unknown_reference: bool = False


class EditorError(ValueError):
    """The submitted form could not be read (for example malformed JSON in a free-form box)."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


# --- Schema helpers ------------------------------------------------------------------------------


def _root() -> dict:
    return content_schema._load_schema(str(content_schema.schema_path()))


def resolve(schema: dict, root: dict) -> dict:
    while "$ref" in schema:
        schema = content_schema._resolve(schema["$ref"], root)
    return schema


def infer(value: Any) -> dict:
    """A schema for a kind that has none, from the shape of its current body."""
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int | float):
        return {"type": "number"}
    if isinstance(value, list):
        return {"type": "array", "items": infer(value[0]) if value else {"type": "string"}}
    if isinstance(value, dict):
        if not value:
            return {"type": "object"}  # nothing to infer from: free-form JSON
        return {"type": "object", "properties": {k: infer(v) for k, v in value.items()}}
    return {"type": "string"}


def kind_schema(kind: authoring.Kind, body: dict) -> tuple[dict, dict, bool]:
    """(root, body schema, inferred?) for a kind."""
    root = _root()
    if kind.schema_definition and kind.schema_definition in root["$defs"]:
        schema = root["$defs"][kind.schema_definition]
        if kind.name == "adventure":  # steps are their own records, edited as such
            schema = {
                **schema,
                "properties": {k: v for k, v in schema["properties"].items() if k != "steps"},
                "required": [r for r in schema.get("required", []) if r != "steps"],
            }
        return root, schema, False
    return root, infer(body), True


def label_for(name: str) -> str:
    spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", name).replace("_", " ").replace("-", " ")
    return spaced.strip().capitalize()


def _joined(parts: tuple) -> str:
    return SEP.join(str(p) for p in parts)


def _error_path(parts: tuple) -> str:
    out = "$"
    for part in parts:
        out += f"[{part}]" if isinstance(part, int) else f".{part}"
    return out


def _is_object(schema: dict) -> bool:
    return schema.get("type") == "object" and "properties" in schema


def _discriminator(variants: list[dict]) -> str | None:
    """The property every `oneOf` variant fixes with a `const` (usually `type`), if any."""
    if not variants or not all(_is_object(v) for v in variants):
        return None
    common = set.intersection(*(set(v["properties"]) for v in variants))
    for name in sorted(common):
        if all("const" in v["properties"][name] for v in variants):
            return name
    return None


def blank(schema: dict, root: dict, sample: Any = MISSING) -> Any:
    """A new empty value for a repeatable row. Optional properties stay absent."""
    schema = resolve(schema, root)
    if "oneOf" in schema:
        return blank(schema["oneOf"][0], root)
    kind = schema.get("type")
    if kind == "object":
        if "properties" not in schema:
            return {}
        required = schema.get("required", [])
        return {
            name: blank(schema["properties"][name], root)
            for name in required
            if name in schema["properties"]
        }
    if kind == "array":
        return []
    if kind == "boolean":
        return False
    if kind in ("number", "integer"):
        return schema.get("minimum", 0)
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    return ""


# --- Rendering ----------------------------------------------------------------------------------


class _Context:
    def __init__(self, root: dict, errors: list[str], inferred: bool):
        self.root = root
        self.inferred = inferred
        self.errors: dict[str, list[str]] = {}
        self.unplaced: list[str] = []
        for problem in errors:
            path, _, message = problem.partition(": ")
            self.errors.setdefault(path.strip(), []).append(message or problem)
        self._references: dict[str, list[tuple[str, str]]] = {}

    def options_for(self, reference_kind: str) -> list[tuple[str, str]]:
        if reference_kind not in self._references:
            kind = authoring.kinds()[reference_kind]
            keys = sorted(str(k) for k in kind.model.objects.values_list(kind.key_field, flat=True))
            self._references[reference_kind] = [(k, k) for k in keys]
        return self._references[reference_kind]


def rows_for(
    kind: authoring.Kind, body: dict, problems: list[str] | None = None
) -> tuple[list[Row], list[str]]:
    """The editor rows for `body`, and the problems that matched no row."""
    root, schema, inferred = kind_schema(kind, body)
    ctx = _Context(root, problems or [], inferred)
    rows: list[Row] = []
    _render_object_fields(ctx, resolve(schema, root), body, (), rows, 0, protected={kind.body_key})
    placed = {r.path for r in rows}
    unplaced = [
        f"{path}: {message}"
        for path, messages in ctx.errors.items()
        for message in messages
        if path not in placed
    ]
    return rows, unplaced


def _render_object_fields(ctx, schema, value, parts, rows, depth, protected=frozenset()):
    value = value if isinstance(value, dict) else {}
    required = set(schema.get("required", []))
    for name, sub in schema.get("properties", {}).items():
        if name in protected:
            rows.append(
                Row(
                    "text",
                    label_for(name) + " (fixed)",
                    path=_error_path((*parts, name)),
                    value=value.get(name, ""),
                    depth=depth,
                    help="A record's id never changes.",
                )
            )
            rows[-1].name = ""  # read-only
            continue
        _render(
            ctx, name, sub, value.get(name, MISSING), (*parts, name), rows, depth, name in required
        )


def _render(ctx, name, schema, value, parts, rows, depth, required):  # noqa: PLR0913
    schema = resolve(schema, ctx.root)
    label = label_for(name if isinstance(name, str) else str(name))
    path = _error_path(parts)
    errors = ctx.errors.get(path, [])
    help_text = schema.get("description", "")

    if "oneOf" in schema:
        variants = [resolve(v, ctx.root) for v in schema["oneOf"]]
        disc = _discriminator(variants)
        if disc is not None:
            _render_union(ctx, label, variants, disc, value, parts, rows, depth, errors)
            return
        schema = {"type": "object"}  # an undiscriminated union stays JSON

    kind = schema.get("type")
    reference = REFERENCE_KINDS.get(name) if isinstance(name, str) else None
    field_name = f"{PREFIX}{SEP}{_joined(parts)}"

    if kind == "object":
        if not _is_object(schema):
            rows.append(
                Row(
                    "json",
                    label,
                    field_name,
                    path,
                    _json(value),
                    depth=depth,
                    errors=errors,
                    required=required,
                    help=help_text or "Free-form JSON for this part.",
                )
            )
            return
        rows.append(Row("heading", label, path=path, depth=depth, errors=errors, help=help_text))
        present = value if isinstance(value, dict) else {}
        _render_object_fields(ctx, schema, present, parts, rows, depth + 1)
        return

    if kind == "array":
        _render_array(
            ctx, name, label, schema, value, parts, rows, depth, errors, reference, required
        )
        return

    current = "" if value is MISSING else value
    if "enum" in schema:
        options = [(str(v), str(v)) for v in schema["enum"]]
        rows.append(
            Row(
                "select",
                label,
                field_name,
                path,
                current,
                options,
                depth,
                required,
                help_text,
                errors,
            )
        )
    elif kind == "boolean":
        rows.append(
            Row(
                "checkbox",
                label,
                field_name,
                path,
                bool(current),
                depth=depth,
                required=required,
                help=help_text,
                errors=errors,
            )
        )
    elif kind in ("number", "integer"):
        rows.append(
            Row(
                "number",
                label,
                field_name,
                path,
                current,
                depth=depth,
                required=required,
                help=help_text,
                errors=errors,
            )
        )
    elif reference:
        options = ctx.options_for(reference)
        known = {k for k, _ in options}
        rows.append(
            Row(
                "select",
                label,
                field_name,
                path,
                current,
                options,
                depth,
                required,
                help_text,
                errors,
                unknown_reference=bool(current) and current not in known,
            )
        )
    else:
        long = name in LONG_TEXT or schema.get("maxLength", 0) > 160 or "\n" in str(current)
        rows.append(
            Row(
                "textarea" if long else "text",
                label,
                field_name,
                path,
                current,
                depth=depth,
                required=required,
                help=help_text,
                errors=errors,
            )
        )


def _render_union(ctx, label, variants, disc, value, parts, rows, depth, errors):
    present = value if isinstance(value, dict) else {}
    consts = [v["properties"][disc]["const"] for v in variants]
    chosen = present.get(disc, consts[0])
    variant = variants[consts.index(chosen)] if chosen in consts else variants[0]
    rows.append(Row("heading", label, path=_error_path(parts), depth=depth, errors=errors))
    rows.append(
        Row(
            "select",
            label_for(disc),
            f"{PREFIX}{SEP}{_joined((*parts, disc))}",
            _error_path((*parts, disc)),
            chosen,
            [(str(c), str(c)) for c in consts],
            depth + 1,
            True,
            "Save after changing this to see that kind's fields.",
        )
    )
    rest = {**variant, "properties": {k: v for k, v in variant["properties"].items() if k != disc}}
    _render_object_fields(ctx, rest, present, parts, rows, depth + 1)


def _render_array(ctx, name, label, schema, value, parts, rows, depth, errors, reference, required):
    items = resolve(schema.get("items", {}), ctx.root)
    present = value if isinstance(value, list) else []
    field_name = f"{PREFIX}{SEP}{_joined(parts)}"
    path = _error_path(parts)
    item_is_object = _is_object(items) or (
        ctx.inferred and present and all(isinstance(v, dict) for v in present)
    )
    if "oneOf" in items and _discriminator([resolve(v, ctx.root) for v in items["oneOf"]]):
        item_is_object = True
    if item_is_object:
        rows.append(
            Row(
                "heading",
                label,
                path=path,
                depth=depth,
                errors=errors,
                controls=[(f"add{SEP}{_joined(parts)}", f"Add {label.lower()}")],
            )
        )
        for index, item in enumerate(present):
            item_parts = (*parts, index)
            item_schema = infer(item) if ctx.inferred else items
            controls = [(f"remove{SEP}{_joined(item_parts)}", "Remove")]
            if index > 0:
                controls.append((f"up{SEP}{_joined(item_parts)}", "Move up"))
            if index < len(present) - 1:
                controls.append((f"down{SEP}{_joined(item_parts)}", "Move down"))
            rows.append(
                Row(
                    "heading",
                    f"{label} {index + 1}",
                    path=_error_path(item_parts),
                    depth=depth + 1,
                    controls=controls,
                    errors=ctx.errors.get(_error_path(item_parts), []),
                )
            )
            resolved = resolve(item_schema, ctx.root)
            if "oneOf" in resolved:
                _render_union(
                    ctx,
                    f"{label} {index + 1}",
                    [resolve(v, ctx.root) for v in resolved["oneOf"]],
                    _discriminator([resolve(v, ctx.root) for v in resolved["oneOf"]]),
                    item,
                    item_parts,
                    rows,
                    depth + 2,
                    [],
                )
            else:
                _render_object_fields(ctx, resolved, item, item_parts, rows, depth + 2)
        return
    if "enum" in items or reference:
        options = (
            [(str(v), str(v)) for v in items["enum"]]
            if "enum" in items
            else ctx.options_for(reference)
        )
        known = {k for k, _ in options}
        rows.append(
            Row(
                "multiselect",
                label,
                field_name,
                path,
                [str(v) for v in present],
                options,
                depth,
                required,
                schema.get("description", ""),
                errors,
                unknown_reference=any(str(v) not in known for v in present),
            )
        )
        return
    if items.get("type") in ("string", "number", "integer", None) and not (
        ctx.inferred and present and isinstance(present[0], list | dict)
    ):
        rows.append(
            Row(
                "lines",
                label,
                field_name,
                path,
                "\n".join(str(v) for v in present),
                depth=depth,
                required=required,
                errors=errors,
                help="One entry per line.",
            )
        )
        return
    rows.append(
        Row(
            "json",
            label,
            field_name,
            path,
            _json(present),
            depth=depth,
            errors=errors,
            help="Free-form JSON for this part.",
        )
    )


def _json(value: Any) -> str:
    return "" if value is MISSING else json.dumps(value, indent=2, ensure_ascii=False)


# --- Reading a submitted form --------------------------------------------------------------------


def read_body(kind: authoring.Kind, post, base: dict) -> dict:
    """Rebuild a body from a POST. Parts of `base` the form does not show are kept."""
    root, schema, inferred = kind_schema(kind, base)
    ctx = _Context(root, [], inferred)
    problems: list[str] = []
    schema = resolve(schema, root)
    result = _read_object(ctx, schema, post, base, (), problems, protected={kind.body_key})
    if problems:
        raise EditorError(problems)
    return result if isinstance(result, dict) else base


def _blank(value: Any) -> bool:
    """Nothing the author typed: used so an untouched optional part stays absent."""
    if isinstance(value, dict):
        return all(_blank(v) for v in value.values())
    return value is None or value is False or value == "" or value == []


def _name(parts: tuple) -> str:
    return f"{PREFIX}{SEP}{_joined(parts)}"


def _read_object(ctx, schema, post, base, parts, problems, protected=frozenset()):
    base = base if isinstance(base, dict) else {}
    out: dict = {k: copy.deepcopy(v) for k, v in base.items() if k not in schema["properties"]}
    required = set(schema.get("required", []))
    for name, sub in schema["properties"].items():
        if name in protected:
            if name in base:
                out[name] = base[name]
            continue
        value = _read(
            ctx, sub, post, base.get(name, MISSING), (*parts, name), problems, name in required
        )
        if value is not MISSING:
            out[name] = value
    return out


def _read(ctx, schema, post, base, parts, problems, required):  # noqa: PLR0911, PLR0912
    schema = resolve(schema, ctx.root)
    if "oneOf" in schema:
        variants = [resolve(v, ctx.root) for v in schema["oneOf"]]
        disc = _discriminator(variants)
        if disc is None:
            return _read_json(post, parts, problems, required)
        return _read_union(ctx, variants, disc, post, base, parts, problems)
    kind = schema.get("type")
    name = _name(parts)
    if kind == "object":
        if not _is_object(schema):
            return _read_json(post, parts, problems, required)
        value = _read_object(ctx, schema, post, base, parts, problems)
        untouched = not required and base is MISSING and _blank(value)
        return MISSING if untouched or (not required and not value) else value
    if kind == "array":
        items = _read_array(ctx, schema, post, base, parts, problems, required)
        return MISSING if base is MISSING and not required and items == [] else items
    if kind == "boolean":
        ticked = f"{name}__present" in post and post.get(name) in ("on", "true", "1")
        return MISSING if base is MISSING and not required and not ticked else ticked
    raw = post.get(name)
    if raw is None:
        return base if base is not MISSING else MISSING
    raw = raw.strip() if "\n" not in raw else raw.strip("\n")
    if raw == "":
        return "" if required and kind not in ("number", "integer") else MISSING
    if kind in ("number", "integer"):
        try:
            number = float(raw)
        except ValueError:
            problems.append(f"{_error_path(parts)}: enter a number")
            return base
        return int(number) if kind == "integer" or number.is_integer() else number
    return raw


def _read_union(ctx, variants, disc, post, base, parts, problems):
    consts = [v["properties"][disc]["const"] for v in variants]
    chosen = post.get(_name((*parts, disc)))
    if chosen not in consts:
        chosen = (base or {}).get(disc, consts[0]) if isinstance(base, dict) else consts[0]
    variant = variants[consts.index(chosen)] if chosen in consts else variants[0]
    rest = {**variant, "properties": {k: v for k, v in variant["properties"].items() if k != disc}}
    out = _read_object(ctx, rest, post, base if isinstance(base, dict) else {}, parts, problems)
    out = {k: v for k, v in out.items() if k in variant["properties"] or k == disc}
    return {**out, disc: chosen}


def _read_json(post, parts, problems, required):
    raw = post.get(_name(parts))
    if raw is None or not raw.strip():
        return MISSING if not required else {}
    try:
        return json.loads(raw)
    except ValueError:
        problems.append(f"{_error_path(parts)}: not valid JSON")
        return MISSING


def _indices(post, parts) -> list[int]:
    prefix = _name(parts) + SEP
    found = set()
    for key in post:
        if key.startswith(prefix):
            head = key[len(prefix) :].split(SEP, 1)[0]
            if head.isdigit():
                found.add(int(head))
    return sorted(found)


def _read_array(ctx, schema, post, base, parts, problems, required):
    items = resolve(schema.get("items", {}), ctx.root)
    present = base if isinstance(base, list) else []
    name = _name(parts)
    union = "oneOf" in items and _discriminator([resolve(v, ctx.root) for v in items["oneOf"]])
    if (
        _is_object(items)
        or union
        or (ctx.inferred and present and all(isinstance(v, dict) for v in present))
    ):
        out = []
        for index in _indices(post, parts):
            item_base = present[index] if index < len(present) else {}
            item_schema = infer(item_base) if ctx.inferred else items
            item_schema = resolve(item_schema, ctx.root)
            item_parts = (*parts, index)
            if "oneOf" in item_schema:
                variants = [resolve(v, ctx.root) for v in item_schema["oneOf"]]
                out.append(
                    _read_union(
                        ctx,
                        variants,
                        _discriminator(variants),
                        post,
                        item_base,
                        item_parts,
                        problems,
                    )
                )
            else:
                out.append(_read_object(ctx, item_schema, post, item_base, item_parts, problems))
        return out
    if "enum" in items or REFERENCE_KINDS.get(parts[-1] if parts else "", None):
        values = post.getlist(name) if hasattr(post, "getlist") else list(post.get(name, []))
        return [v for v in values if v]
    if items.get("type") in ("string", "number", "integer", None) and not (
        ctx.inferred and present and isinstance(present[0], list | dict)
    ):
        raw = post.get(name)
        if raw is None:
            return base if base is not MISSING else MISSING
        lines = [line.strip() for line in raw.splitlines() if line.strip()]
        if items.get("type") in ("number", "integer"):
            try:
                return [float(v) if "." in v else int(v) for v in lines]
            except ValueError:
                problems.append(f"{_error_path(parts)}: enter numbers, one per line")
                return base
        return lines if lines or required else MISSING
    return _read_json(post, parts, problems, required)


# --- Add, remove, move ---------------------------------------------------------------------------


def _walk(body: Any, parts: list[str]) -> Any:
    node = body
    for part in parts:
        node = node[int(part)] if isinstance(node, list) else node[part]
    return node


def apply_operation(kind: authoring.Kind, body: dict, operation: str) -> dict:
    """Apply `add|path`, `remove|path|index`, `up|path|index` or `down|path|index`."""
    verb, *parts = operation.split(SEP)
    root, schema, inferred = kind_schema(kind, body)
    body = copy.deepcopy(body)
    if verb == "add":
        target = _walk(body, parts)
        if not isinstance(target, list):
            # an optional list that does not exist yet
            holder = _walk(body, parts[:-1]) if len(parts) > 1 else body
            holder[parts[-1]] = target = []
        sample = target[0] if target else MISSING
        if sample is not MISSING and (inferred or not _schema_items(schema, root, parts)):
            target.append(_blank_like(sample))
        else:
            items = _schema_items(schema, root, parts)
            target.append(blank(items, root) if items else {})
    elif verb in ("remove", "up", "down"):
        index = int(parts[-1])
        target = _walk(body, parts[:-1])
        if verb == "remove" and 0 <= index < len(target):
            del target[index]
        elif verb == "up" and 0 < index < len(target):
            target[index - 1], target[index] = target[index], target[index - 1]
        elif verb == "down" and 0 <= index < len(target) - 1:
            target[index + 1], target[index] = target[index], target[index + 1]
    else:
        raise EditorError([f"Unknown operation {verb!r}."])
    return body


def _schema_items(schema: dict, root: dict, parts: list[str]) -> dict | None:
    node = resolve(schema, root)
    for part in parts:
        node = resolve(node, root)
        if part.isdigit():
            node = resolve(node.get("items", {}), root)
        elif "properties" in node and part in node["properties"]:
            node = node["properties"][part]
        else:
            return None
    node = resolve(node, root)
    return node.get("items") if node.get("type") == "array" else None


def _blank_like(sample: Any) -> Any:
    if isinstance(sample, dict):
        return {k: _blank_like(v) for k, v in sample.items()}
    if isinstance(sample, list):
        return []
    if isinstance(sample, bool):
        return False
    if isinstance(sample, int | float):
        return 0
    return ""


# --- Preview -------------------------------------------------------------------------------------


def preview_lines(body: Any, band: str | None = None, path: str = "$") -> list[tuple[str, str]]:
    """The text a child would read, in order. With `band`, lines for other age bands are left
    out (a dict that lists `ageBands` without `band` is skipped)."""
    if isinstance(body, str):
        return [(path, body)]
    if isinstance(body, list):
        out = []
        for index, item in enumerate(body):
            out += preview_lines(item, band, f"{path}[{index}]")
        return out
    if isinstance(body, dict):
        bands = body.get("ageBands")
        if band and isinstance(bands, list) and band not in bands:
            return []
        out = []
        for key, item in body.items():
            if key in ("id", "slug", "ageBands") or key.endswith(("Id", "Ids", "Slug", "Slugs")):
                continue
            out += preview_lines(item, band, f"{path}.{key}")
        return out
    return []


def changed_paths(old: Any, new: Any, path: str = "$") -> list[str]:
    """Where `new` differs from `old`, for the "what changes" panel."""
    if isinstance(old, dict) and isinstance(new, dict):
        out: list[str] = []
        for key in sorted(set(old) | set(new)):
            if key not in old:
                out.append(f"{path}.{key}: added")
            elif key not in new:
                out.append(f"{path}.{key}: removed")
            else:
                out += changed_paths(old[key], new[key], f"{path}.{key}")
        return out
    if isinstance(old, list) and isinstance(new, list) and len(old) == len(new):
        out = []
        for index, (a, b) in enumerate(zip(old, new, strict=True)):
            out += changed_paths(a, b, f"{path}[{index}]")
        return out
    return [] if old == new else [f"{path}: changed"]
