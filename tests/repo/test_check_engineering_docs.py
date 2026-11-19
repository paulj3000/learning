"""Unit tests for scripts/check_engineering_docs.py (ADR-072 documentation check)."""

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_SPEC = importlib.util.spec_from_file_location(
    "check_engineering_docs", ROOT / "scripts" / "check_engineering_docs.py"
)
assert _SPEC and _SPEC.loader
docs_check = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(docs_check)

# Built from parts so this file does not itself contain a conflict marker.
OURS = "<" * 7


def _write(root: Path, path: str, text: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


@pytest.fixture
def tree(tmp_path: Path) -> Path:
    """A tree that satisfies every rule."""
    for path in docs_check.ROOT_FILES + docs_check.ENGINEERING_DOCS + docs_check.ADVENTURE_DOCS:
        _write(tmp_path, path, "# Doc\n\nStatus: Mandatory policy\n")
    for path, sections in docs_check.TEMPLATE_SECTIONS.items():
        body = "\n\n".join(["# Template"] + [f"## {s}\n\n<value>" for s in sections])
        _write(tmp_path, path, body)
    return tmp_path


def _errors(root: Path) -> list[str]:
    return docs_check.check(root)[0]


def test_complete_tree_with_resolving_links_passes(tree: Path) -> None:
    _write(
        tree,
        "docs/engineering/README.md",
        "**Status:** Guidance\n\n[Branches](branch-policy.md#naming) [Root](../../CLAUDE.md) "
        "[Web](https://example.org) [Anchor](#top) [Slot](<placeholder>) `[code](missing.md)`\n\n"
        "```\n[x](nope.md)\n```\n",
    )
    assert _errors(tree) == []
    assert docs_check.main(["--root", str(tree)]) == 0


def test_missing_required_document_is_reported(tree: Path) -> None:
    (tree / "AGENTS.md").unlink()
    assert "AGENTS.md: required document is missing" in _errors(tree)


def test_broken_relative_link_is_reported(tree: Path) -> None:
    _write(tree, "docs/adventures/README.md", "Status: Guidance\n\nSee [jumping](jumping.md).\n")
    assert 'docs/adventures/README.md: broken link "jumping.md"' in _errors(tree)
    assert docs_check.main(["--root", str(tree)]) == 1


def test_policy_without_status_line_is_reported(tree: Path) -> None:
    _write(tree, "docs/engineering/release-policy.md", "# Release\n\nNo header.\n")
    assert 'docs/engineering/release-policy.md: no "Status:" line in the first 15 lines' in (
        _errors(tree)
    )


def test_template_missing_required_section_is_reported(tree: Path) -> None:
    _write(
        tree,
        "docs/engineering/templates/agent-handoff.md",
        "# Handoff\n\n## Agent ID\n\n## Ticket ID\n",
    )
    errors = _errors(tree)
    assert (
        'docs/engineering/templates/agent-handoff.md: missing required section "## Branch"'
        in errors
    )


def test_conflict_marker_in_any_markdown_file_is_reported(tree: Path) -> None:
    _write(tree, "docs/other/NOTES.md", f"text\n{OURS} HEAD\nmine\n")
    assert "docs/other/NOTES.md:2: unresolved merge-conflict marker" in _errors(tree)


def test_required_lists_match_the_documented_structure() -> None:
    assert len(docs_check.ENGINEERING_DOCS) == 13
    assert len(docs_check.ADVENTURE_DOCS) == 12
    assert len(docs_check.TEMPLATE_SECTIONS) == 14
