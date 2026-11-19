"""Forecast a merge sequence without merging anything (LAI-ENG-002, GE-090).

Replays `git merge-tree --write-tree` for each branch in order on top of the base, carrying each
step's result forward in an unreferenced commit object (`git commit-tree`). No branch, ref, index,
worktree or stash is touched; the objects are garbage-collected later like any dangling commit.

Text conflicts are what `git merge` would stop on. Migration-number collisions merge without a
text conflict (two `0003_*.py` files simply coexist), so pair this with
`scripts/dev/migration_audit.py`.

    python3 scripts/dev/merge_forecast.py origin/core/gameengine origin/core/ge-scoring \\
        origin/feature/firepeak-volcano-adventure origin/feature/north-pole-adventure
    python3 scripts/dev/merge_forecast.py --base origin/main --json <refs...>

Exit status: 0 when every step is clean, 1 when any step conflicts.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass

CODE_PREFIXES = ("lai/", "react/src/", "game/", "server/", "infra/", "scripts/", "lambda/")
GENERATED_PREFIXES = ("content/exported/", "content/derived/", "tests/golden/")


def git(repo: str, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(  # noqa: S603 - fixed git arguments
        ["git", "-C", repo, *args],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    if check and result.returncode not in (0, 1):
        raise RuntimeError(f"git {' '.join(args)}: {result.stderr.strip()}")
    return result


@dataclass
class Step:
    ref: str
    sha: str
    clean: bool
    conflicts: list[str]

    @property
    def kinds(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {"code": [], "generated": [], "docs": []}
        for path in self.conflicts:
            if path.startswith(GENERATED_PREFIXES):
                out["generated"].append(path)
            elif path.startswith(CODE_PREFIXES) or path.endswith((".yml", ".json", ".ts")):
                out["code"].append(path)
            else:
                out["docs"].append(path)
        return out


def forecast(repo: str, base: str, refs: list[str]) -> list[Step]:
    head = git(repo, "rev-parse", base).stdout.strip()
    steps = []
    for ref in refs:
        sha = git(repo, "rev-parse", ref).stdout.strip()
        result = git(repo, "merge-tree", "--write-tree", "--name-only", "--no-messages", head, sha)
        lines = [line for line in result.stdout.split("\n") if line.strip()]
        if not lines:
            raise RuntimeError(f"merge-tree produced no tree for {ref}: {result.stderr.strip()}")
        tree, conflicts = lines[0], lines[1:]
        steps.append(Step(ref, sha[:10], result.returncode == 0, conflicts))
        commit = git(repo, "commit-tree", tree, "-p", head, "-p", sha, "-m", f"forecast {ref}")
        head = commit.stdout.strip()
    return steps


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Forecast a merge sequence (LAI-ENG-002).")
    parser.add_argument("refs", nargs="+", help="branches in merge order")
    parser.add_argument("--base", default="origin/main")
    parser.add_argument("--repo", default=".")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    steps = forecast(args.repo, args.base, args.refs)
    if args.json:
        print(json.dumps([{**asdict(s), "kinds": s.kinds} for s in steps], indent=2))
    else:
        print(f"merge forecast onto {args.base} (nothing is merged)")
        for step in steps:
            if step.clean:
                print(f"  + {step.ref} @{step.sha}: clean")
                continue
            print(f"  + {step.ref} @{step.sha}: {len(step.conflicts)} conflicted file(s)")
            for kind, paths in step.kinds.items():
                for path in paths:
                    print(f"      [{kind}] {path}")
    return 0 if all(s.clean for s in steps) else 1


if __name__ == "__main__":
    sys.exit(main())
