"""Engineering documentation check (docs/engineering/documentation-policy.md, ADR-072).

Fails when:
- a required root instruction file, engineering policy, adventure standard or template is missing;
- a governed document (CLAUDE.md, AGENTS.md, docs/engineering/**, docs/adventures/**) other than a
  template has no ``Status`` line in its first 15 lines;
- a relative Markdown link in a governed document does not resolve to a file or directory;
- a mandatory template lacks one of its required ``##`` sections;
- any Markdown file in the repository contains an unresolved merge-conflict marker.

ADR identifier uniqueness is checked by ``npm run adr:check`` (scripts/check-adrs.ts), not here.
Standard library only, no network. ``--root <dir>`` points it at another tree (used by its test).
Run with ``make docs-check`` or ``python3 scripts/check_engineering_docs.py``.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import unquote

ROOT_FILES = ["CLAUDE.md", "AGENTS.md"]

ENGINEERING_DOCS = [
    f"docs/engineering/{name}.md"
    for name in (
        "README",
        "development-workflow",
        "architecture-rules",
        "testing-policy",
        "branch-policy",
        "security-policy",
        "definition-of-done",
        "coding-standards",
        "multi-agent-workflow",
        "trello-workflow",
        "integration-policy",
        "release-policy",
        "documentation-policy",
    )
]

ADVENTURE_DOCS = [
    f"docs/adventures/{name}.md"
    for name in (
        "README",
        "adventure-standard",
        "jumping-standard",
        "scoring-standard",
        "accessibility-standard",
        "realm-standard",
        "quest-standard",
        "challenge-standard",
        "asset-standard",
        "npc-standard",
        "audio-standard",
        "educational-content-standard",
    )
]

# Templates and the "## " sections each must contain (case-insensitive prefix match).
TEMPLATE_SECTIONS: dict[str, list[str]] = {
    "docs/engineering/templates/feature-specification.md": [
        "Feature identifier",
        "Objective",
        "Business or educational value",
        "Requirements",
        "Nonrequirements",
        "Architecture",
        "Dependencies",
        "Data models",
        "API contracts",
        "Frontend changes",
        "Security implications",
        "Parallel work packages",
        "Serial work packages",
        "Testing strategy",
        "Acceptance criteria",
        "Deployment implications",
        "Owner decisions required",
    ],
    "docs/engineering/templates/task-specification.md": [],
    "docs/engineering/templates/implementation-plan.md": [],
    "docs/engineering/templates/agent-handoff.md": [
        "Agent ID",
        "Ticket ID",
        "Branch",
        "Worktree",
        "Commit SHA",
        "Completed work",
        "Remaining work",
        "Tests executed",
        "Test results",
        "Changed components",
        "Shared component changes",
        "Known defects",
        "Blockers",
        "Next recommended action",
    ],
    "docs/engineering/templates/pull-request.md": [],
    "docs/engineering/templates/qa-checklist.md": [],
    "docs/engineering/templates/defect-report.md": [],
    "docs/engineering/templates/release-notes.md": [],
    "docs/engineering/templates/completion-report.md": [
        "Original scope",
        "Implemented scope",
        "Deferred scope",
        "Test evidence",
        "Commits",
        "Pull requests",
        "Documentation updates",
        "Trello updates",
        "Integration requirements",
        "Owner QA requirements",
        "Deployment status",
    ],
    "docs/engineering/templates/adr.md": [
        "Context",
        "Decision",
        "Alternatives considered",
        "Consequences",
        "Security implications",
        "Implementation impact",
        "Related tickets",
        "Related ADRs",
        "Owner approval",
    ],
    "docs/adventures/templates/realm-specification.md": [],
    "docs/adventures/templates/adventure-specification.md": [],
    "docs/adventures/templates/quest-specification.md": [],
    "docs/adventures/templates/challenge-specification.md": [],
}

GOVERNED_DIRS = ["docs/engineering", "docs/adventures"]
SKIPPED_DIRS = {
    ".git",
    ".venv",
    "node_modules",
    "dist",
    "cdk.out",
    "playwright-report",
    "test-results",
    "__pycache__",
}
CONFLICT_MARKER = re.compile(r"^(<{7}|>{7})( |$)")
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
STATUS = re.compile(r"^[^\w\n]*Status\b", re.MULTILINE)
SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*:", re.IGNORECASE)
FENCE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE = re.compile(r"`[^`\n]*`")
HEADING = re.compile(r"^#{2,3} (.+)$")


def _markdown_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    found: list[Path] = []
    for path in sorted(directory.iterdir()):
        if path.name in SKIPPED_DIRS:
            continue
        if path.is_dir():
            found.extend(_markdown_files(path))
        elif path.suffix == ".md":
            found.append(path)
    return found


def check(root: Path) -> tuple[list[str], int, int]:
    """Return (errors, governed document count, relative link count)."""
    errors: list[str] = []
    required = ROOT_FILES + ENGINEERING_DOCS + ADVENTURE_DOCS + list(TEMPLATE_SECTIONS)
    errors.extend(
        f"{path}: required document is missing" for path in required if not (root / path).exists()
    )

    governed = [root / name for name in ROOT_FILES if (root / name).exists()]
    for directory in GOVERNED_DIRS:
        governed.extend(_markdown_files(root / directory))

    link_count = 0
    for file in governed:
        rel = file.relative_to(root).as_posix()
        text = file.read_text(encoding="utf-8")
        head = "\n".join(text.splitlines()[:15])
        if "/templates/" not in rel and not STATUS.search(head):
            errors.append(f'{rel}: no "Status:" line in the first 15 lines')
        stripped = INLINE_CODE.sub("", FENCE.sub("", text))
        for match in LINK.finditer(stripped):
            target = match.group(1)
            if SCHEME.match(target) or target.startswith("#"):
                continue
            if target.startswith("<") and target.endswith(">"):
                continue  # template placeholder
            link_count += 1
            path = unquote(target.split("#", 1)[0])
            resolved = root / path.lstrip("/") if path.startswith("/") else file.parent / path
            if not resolved.exists():
                errors.append(f'{rel}: broken link "{target}"')

    for path, sections in TEMPLATE_SECTIONS.items():
        file = root / path
        if not file.exists():
            continue
        headings = [
            match.group(1).strip().lower()
            for line in file.read_text(encoding="utf-8").splitlines()
            if (match := HEADING.match(line))
        ]
        for section in sections:
            if not any(heading.startswith(section.lower()) for heading in headings):
                errors.append(f'{path}: missing required section "## {section}"')

    for file in _markdown_files(root):
        for number, line in enumerate(file.read_text(encoding="utf-8").splitlines(), start=1):
            if CONFLICT_MARKER.match(line):
                rel = file.relative_to(root).as_posix()
                errors.append(f"{rel}:{number}: unresolved merge-conflict marker")

    return errors, len(governed), link_count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args(argv)
    errors, governed, links = check(args.root.resolve())
    if errors:
        print(f"Engineering docs check failed with {len(errors)} problem(s):", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print(
        f"Engineering docs check passed: {governed} governed documents, {links} relative links."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
