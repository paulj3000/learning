"""Django migration collision audit across branches (LAI-ENG-002).

Reads git objects only: no checkout, no database, no Django import. For every branch given (default:
every remote `core/*` and `feature/*` branch updated in the last 14 days) it lists the
migrations the branch adds relative to the base (default `origin/main`) and reports:

- COLLISION: two different files with the same app and number on different branches (two leaves at
  merge time; the later branch renumbers on top of the earlier one);
- DIVERGENT: the same file name with different content on different branches (merging silently
  keeps one version);
- REWRITE: a branch modifies, deletes or renames a migration that is already on the base (never
  allowed: integration-policy, "Database models and migrations");
- STALE PARENT: a migration whose same-app dependency is neither the base's leaf nor a migration
  the branch adds (the branch was built on an old leaf).

Exit status 1 when anything but a COLLISION is found; collisions are expected while branches are
open and are resolved by the merge sequence
(docs/infrastructure/integration-plan-game-engine-core.md).

    python3 scripts/dev/migration_audit.py                       # recent core/* and feature/*
    python3 scripts/dev/migration_audit.py origin/core/ge-scoring origin/feature/storybook
    python3 scripts/dev/migration_audit.py --base origin/main --json
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field

MIGRATION_RE = re.compile(r"^lai/apps/([^/]+)/migrations/(\d{4})_[^/]*\.py$")
DEP_RE = re.compile(r"""\(\s*['"]([\w]+)['"]\s*,\s*['"]([\w]+)['"]\s*\)""")


def git(repo: str, *args: str) -> str:
    result = subprocess.run(  # noqa: S603 - fixed git arguments
        ["git", "-C", repo, *args],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {result.stderr.strip()}")
    return result.stdout


@dataclass
class Migration:
    app: str
    number: str
    name: str
    path: str
    blob: str
    dependencies: list[tuple[str, str]]


@dataclass
class Report:
    base: str
    branches: list[str]
    added: dict[str, list[dict]] = field(default_factory=dict)
    collisions: list[str] = field(default_factory=list)
    divergent: list[str] = field(default_factory=list)
    rewrites: list[str] = field(default_factory=list)
    stale_parents: list[str] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return bool(self.divergent or self.rewrites or self.stale_parents)


def dependencies_of(source: str) -> list[tuple[str, str]]:
    match = re.search(r"dependencies\s*=\s*\[(.*?)\]", source, re.S)
    return DEP_RE.findall(match.group(1)) if match else []


def base_leaves(repo: str, base: str) -> dict[str, set[str]]:
    """Per app, the migration names on the base that no other base migration depends on."""
    names: dict[str, set[str]] = defaultdict(set)
    parents: dict[str, set[str]] = defaultdict(set)
    listing = git(repo, "ls-tree", "-r", "--name-only", base, "--", "lai/apps")
    for path in listing.split():
        m = MIGRATION_RE.match(path)
        if not m:
            continue
        app = m.group(1)
        names[app].add(path.rsplit("/", 1)[1][:-3])
        for dep_app, dep_name in dependencies_of(git(repo, "show", f"{base}:{path}")):
            if dep_app == app:
                parents[app].add(dep_name)
    return {app: names[app] - parents[app] for app in names}


def added_migrations(repo: str, base: str, branch: str) -> list[Migration]:
    out = []
    diff = git(
        repo, "diff", "--name-only", "--diff-filter=A", f"{base}...{branch}", "--", "lai/apps"
    )
    for path in diff.split():
        m = MIGRATION_RE.match(path)
        if not m:
            continue
        source = git(repo, "show", f"{branch}:{path}")
        blob = git(repo, "rev-parse", f"{branch}:{path}").strip()[:10]
        out.append(
            Migration(
                m.group(1),
                m.group(2),
                path.rsplit("/", 1)[1][:-3],
                path,
                blob,
                dependencies_of(source),
            )
        )
    return out


def rewritten(repo: str, base: str, branch: str) -> list[str]:
    diff = git(
        repo, "diff", "--name-status", "--diff-filter=MDR", f"{base}...{branch}", "--", "lai/apps"
    )
    return [line for line in diff.splitlines() if "/migrations/" in line and line.endswith(".py")]


def recent_branches(repo: str, days: int) -> list[str]:
    refs = git(
        repo,
        "for-each-ref",
        "--format=%(refname:short) %(committerdate:unix)",
        "refs/remotes/origin/core",
        "refs/remotes/origin/feature",
    )
    cutoff = time.time() - days * 86400
    return sorted(
        ref for ref, stamp in (line.split() for line in refs.splitlines()) if int(stamp) >= cutoff
    )


def audit(repo: str, base: str, branches: list[str]) -> Report:
    report = Report(base=base, branches=branches)
    leaves = base_leaves(repo, base)
    by_number: dict[tuple[str, str], dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    by_name: dict[tuple[str, str], dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for branch in branches:
        added = added_migrations(repo, base, branch)
        report.added[branch] = [asdict(m) for m in added]
        own = {(m.app, m.name) for m in added}
        for m in added:
            by_number[(m.app, m.number)][m.name].append(branch)
            by_name[(m.app, m.name)][m.blob].append(branch)
            for dep_app, dep_name in m.dependencies:
                if dep_app != m.app or (dep_app, dep_name) in own:
                    continue
                if dep_name not in leaves.get(dep_app, set()):
                    report.stale_parents.append(
                        f"{branch}: {m.app}.{m.name} depends on {dep_app}.{dep_name}, "
                        f"not the {base} leaf {sorted(leaves.get(dep_app, set()))}"
                    )
        for line in rewritten(repo, base, branch):
            report.rewrites.append(f"{branch}: {line}")
    for (app, number), names in sorted(by_number.items()):
        if len(names) > 1:
            listed = "; ".join(f"{name} ({', '.join(bs)})" for name, bs in sorted(names.items()))
            report.collisions.append(f"{app} {number}: {listed}")
    for (app, name), blobs in sorted(by_name.items()):
        if len(blobs) > 1:
            listed = "; ".join(f"{blob} ({', '.join(bs)})" for blob, bs in sorted(blobs.items()))
            report.divergent.append(f"{app}.{name}: {listed}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Django migration collision audit (LAI-ENG-002).")
    parser.add_argument(
        "branches", nargs="*", help="refs to audit (default: recent core/* and feature/*)"
    )
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--repo", default=".")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    branches = args.branches or recent_branches(args.repo, args.days)
    report = audit(args.repo, args.base, branches)
    if args.json:
        print(json.dumps({**asdict(report), "failed": report.failed}, indent=2))
        return 1 if report.failed else 0
    print(f"migration audit against {args.base}: {len(branches)} branch(es)")
    for branch in branches:
        names = [f"{m['app']}.{m['name']}" for m in report.added[branch]]
        print(f"  {branch}: {', '.join(names) or 'no new migrations'}")
    for title, rows in (
        ("COLLISION (resolve by merge order and renumbering)", report.collisions),
        ("DIVERGENT (same name, different content)", report.divergent),
        ("REWRITE (changes a migration already on the base)", report.rewrites),
        ("STALE PARENT (depends on an old leaf)", report.stale_parents),
    ):
        print(f"{title}: {'none' if not rows else ''}")
        for row in rows:
            print(f"  {row}")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
