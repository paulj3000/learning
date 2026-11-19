"""Per-worktree development slots for concurrent agents (LAI-ENG-002).

Several agents work at once, each in its own git worktree, on one machine. Without a slot every
worktree uses the same defaults: PostgreSQL 5442, Django 8010, Vite 5183, and the database `lai`,
whose pytest database is `test_lai`. pytest-django drops and recreates its test database at the
start of a run, so two agents testing at the same time destroy each other's database. A slot gives
each worktree its own ports and its own database names.

Slot 0 is the owner's main checkout and keeps the defaults. Slots 1 to 9 are for agent worktrees.
Slot numbers name worktrees, not agents, and are assigned in
docs/infrastructure/multi-agent-local-environment.md.

Commands (standard library only; never touches another worktree, Docker or AWS):

    python3 scripts/dev/agent_slot.py show --slot 3            # print the values
    python3 scripts/dev/agent_slot.py write --slot 3           # write them into ./.env
    python3 scripts/dev/agent_slot.py check                    # preflight this worktree

`write` creates `.env` when it is missing and otherwise replaces only the lines it manages,
keeping every other line (secrets, Cognito ids) untouched. It never prints existing values.
"""

from __future__ import annotations

import argparse
import re
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

MAX_SLOT = 9
MANAGED_MARKER = (
    "# Managed by scripts/dev/agent_slot.py (LAI-ENG-002); edit the slot, not these lines."
)

# Defaults that slot 0 keeps (Makefile, docker-compose.yml, react/vite.config.ts,
# react/playwright.acceptance.config.ts, server/multiplayer/config.ts).
DEFAULT_POSTGRES_PORT = 5442
DEFAULT_DJANGO_PORT = 8010
DEFAULT_VITE_PORT = 5183
DEFAULT_E2E_DJANGO_PORT = 8765
DEFAULT_E2E_VITE_PORT = 5175
DEFAULT_MP_PORT = 2567
DEFAULT_DB = "lai"

_SLUG = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True)
class SlotValues:
    slot: int
    postgres_port: int
    django_port: int
    vite_port: int
    e2e_django_port: int
    e2e_vite_port: int
    mp_port: int
    postgres_db: str

    @property
    def test_database(self) -> str:
        """The database pytest-django creates and drops (`test_` + POSTGRES_DB)."""
        return f"test_{self.postgres_db}"

    def env_lines(self) -> list[str]:
        return [
            f"LAI_AGENT_SLOT={self.slot}",
            f"POSTGRES_PORT={self.postgres_port}",
            f"POSTGRES_DB={self.postgres_db}",
            f"DJANGO_DEV_PORT={self.django_port}",
            f"VITE_DEV_PORT={self.vite_port}",
            f"LAI_E2E_DJANGO_PORT={self.e2e_django_port}",
            f"LAI_E2E_VITE_PORT={self.e2e_vite_port}",
            f"MP_PORT={self.mp_port}",
        ]

    def ports(self) -> dict[str, int]:
        return {
            "POSTGRES_PORT": self.postgres_port,
            "DJANGO_DEV_PORT": self.django_port,
            "VITE_DEV_PORT": self.vite_port,
            "LAI_E2E_DJANGO_PORT": self.e2e_django_port,
            "LAI_E2E_VITE_PORT": self.e2e_vite_port,
            "MP_PORT": self.mp_port,
        }


MANAGED_KEYS = tuple(
    line.split("=", 1)[0] for line in SlotValues(0, 0, 0, 0, 0, 0, 0, "x").env_lines()
)


def slug_for(name: str) -> str:
    """A PostgreSQL-safe suffix from a worktree directory name (`wt-feature-X` -> `feature_x`)."""
    slug = _SLUG.sub("_", name.lower()).strip("_")
    if slug.startswith("wt_"):
        slug = slug[3:]
    # PostgreSQL identifiers are 63 bytes; `test_lai_` takes 9.
    return slug[:48] or "worktree"


def values_for(slot: int, worktree_name: str) -> SlotValues:
    if not 0 <= slot <= MAX_SLOT:
        raise ValueError(f"slot must be 0 to {MAX_SLOT}, got {slot}")
    if slot == 0:
        return SlotValues(
            0,
            DEFAULT_POSTGRES_PORT,
            DEFAULT_DJANGO_PORT,
            DEFAULT_VITE_PORT,
            DEFAULT_E2E_DJANGO_PORT,
            DEFAULT_E2E_VITE_PORT,
            DEFAULT_MP_PORT,
            DEFAULT_DB,
        )
    # Each family keeps its own decade so no two families or slots share a port:
    # PostgreSQL 5451-5459, Django 8020-8100, Vite 5193-5273, e2e Django 8775-8855,
    # e2e Vite 5185-5265 (ends in 5, never a Vite dev port, which ends in 3), multiplayer 2568-2576.
    return SlotValues(
        slot,
        5450 + slot,
        DEFAULT_DJANGO_PORT + 10 * slot,
        DEFAULT_VITE_PORT + 10 * slot,
        DEFAULT_E2E_DJANGO_PORT + 10 * slot,
        DEFAULT_E2E_VITE_PORT + 10 * slot,
        DEFAULT_MP_PORT + slot,
        f"{DEFAULT_DB}_{slug_for(worktree_name)}",
    )


def merge_env(existing: str, values: SlotValues) -> str:
    """Replace the managed lines in an .env text; keep every other line in order."""
    kept = []
    for line in existing.splitlines():
        key = line.split("=", 1)[0].strip()
        if line.strip() == MANAGED_MARKER or key in MANAGED_KEYS:
            continue
        kept.append(line)
    while kept and not kept[-1].strip():
        kept.pop()
    block = [MANAGED_MARKER, *values.env_lines()]
    return "\n".join([*kept, "", *block] if kept else block) + "\n"


def read_slot(env_text: str) -> int | None:
    for line in reversed(env_text.splitlines()):
        if line.startswith("LAI_AGENT_SLOT="):
            value = line.split("=", 1)[1].strip()
            return int(value) if value.isdigit() else None
    return None


def port_free(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _git(root: Path, *args: str) -> str:
    # Fixed git arguments from this script, never user input; git from PATH like the Makefile.
    result = subprocess.run(  # noqa: S603
        ["git", "-C", str(root), *args],  # noqa: S607
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def preflight(root: Path, probe=port_free) -> tuple[list[str], list[str]]:
    """Errors and warnings for this worktree. Reads only this worktree."""
    errors: list[str] = []
    warnings: list[str] = []
    branch = _git(root, "symbolic-ref", "--short", "-q", "HEAD")
    if branch in {"main", "master"}:
        errors.append(f"branch is {branch}: agents never work on main (branch-policy.md)")
    git_dir = _git(root, "rev-parse", "--git-dir")
    common_dir = _git(root, "rev-parse", "--git-common-dir")
    if git_dir and common_dir and Path(root, git_dir).resolve() == Path(root, common_dir).resolve():
        warnings.append("this is the main checkout, not a linked worktree (slot 0 is the owner's)")
    env_path = root / ".env"
    env_text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    slot = read_slot(env_text)
    if slot is None:
        warnings.append(
            "no LAI_AGENT_SLOT in .env: this worktree uses the shared defaults "
            "(PostgreSQL 5442, test_lai); run `agent_slot.py write --slot N`"
        )
        slot = 0
    values = values_for(slot, root.name)
    for key, port in values.ports().items():
        if not probe(port):
            warnings.append(f"{key} {port} is in use (yours, or another worktree on the same slot)")
    for path, hint in ((root / "node_modules", "npm ci"), (root / ".venv", "make py-install")):
        if not path.exists():
            warnings.append(f"{path.name} missing: run `{hint}` in this worktree")
    warnings.extend(borrowed_node_modules(root))
    return errors, warnings


def _owning_worktree(target: Path) -> Path | None:
    """The worktree root (directory holding package-lock.json) that a node_modules path lives in."""
    for candidate in (target, *target.parents):
        if candidate.name == "node_modules":
            return candidate.parent
    return None


def borrowed_node_modules(root: Path, min_links: int = 20) -> list[str]:
    """Warn when node_modules is borrowed from another worktree (LAI-ENG-002, 2026-11-19).

    Seen when the disk filled: a worktree's node_modules was a symlink, or a directory of
    symlinks, into another worktree's install. That other worktree's `npm ci` then deletes this
    worktree's dependencies mid-run, and a different lockfile means the wrong versions are tested.
    """
    modules = root / "node_modules"
    if not modules.exists():
        return []
    sources: dict[Path, int] = {}
    if modules.is_symlink():
        owner = _owning_worktree(modules.resolve())
        if owner:
            sources[owner] = 1
    else:
        for entry in modules.iterdir():
            if entry.is_symlink():
                owner = _owning_worktree(entry.resolve())
                if owner and owner != root.resolve():
                    sources[owner] = sources.get(owner, 0) + 1
    out = []
    for owner, count in sorted(sources.items()):
        if not modules.is_symlink() and count < min_links:
            continue
        how = "is a symlink to" if modules.is_symlink() else f"links {count} packages into"
        out.append(
            f"node_modules {how} {owner}/node_modules: an `npm ci` there removes them here. "
            "Run `npm ci` in this worktree when disk allows"
        )
        ours, theirs = root / "package-lock.json", owner / "package-lock.json"
        if ours.exists() and theirs.exists() and ours.read_bytes() != theirs.read_bytes():
            out.append(
                f"package-lock.json differs from {owner.name}'s: the borrowed node_modules does "
                "not match this branch's dependencies, so test results here are not reliable"
            )
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--root", type=Path, default=Path.cwd(), help="worktree root (default: cwd)"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("show", "write"):
        cmd = sub.add_parser(name)
        cmd.add_argument("--slot", type=int, required=True)
    sub.add_parser("check")
    args = parser.parse_args(argv)
    root = args.root.resolve()

    if args.command in {"show", "write"}:
        try:
            values = values_for(args.slot, root.name)
        except ValueError as error:
            print(f"agent_slot: {error}", file=sys.stderr)
            return 2
        if args.command == "show":
            print("\n".join(values.env_lines()))
            print(f"# pytest database: {values.test_database}")
            return 0
        env_path = root / ".env"
        existing = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
        env_path.write_text(merge_env(existing, values), encoding="utf-8")
        print(
            f"agent_slot: wrote slot {values.slot} to {env_path} "
            f"(pytest database {values.test_database})"
        )
        return 0

    errors, warnings = preflight(root)
    for line in errors:
        print(f"ERROR   {line}")
    for line in warnings:
        print(f"WARNING {line}")
    if not errors and not warnings:
        print("agent_slot: preflight clean")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
