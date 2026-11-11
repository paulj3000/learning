"""Guards on .github/workflows/deploy-site.yml (LAI-INFRA-004), read as text (no YAML dependency).

- The site waits for a commit's Django release exactly when that commit touches a path
  deploy-django-ec2.yml releases, so the two path lists must not drift apart.
- Nothing in the site workflow may run until LAI_SITE_DEPLOY_ENABLED is 'true': Amplify Hosting
  stays the only frontend publisher until the owner switches it on.
"""

import re
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[2] / ".github/workflows"
SITE = (WORKFLOWS / "deploy-site.yml").read_text()
DJANGO = (WORKFLOWS / "deploy-django-ec2.yml").read_text()


def push_paths(workflow: str) -> list[str]:
    block = workflow.split("  push:\n", 1)[1].split("  workflow_dispatch:", 1)[0]
    return re.findall(r"^\s+- '([^']+)'$", block, flags=re.MULTILINE)


def backend_pattern() -> re.Pattern[str]:
    match = re.search(r"grep -qE '([^']+)'", SITE)
    assert match, "the backend wait step's path pattern is missing"
    return re.compile(match.group(1))


def example(path_glob: str) -> str:
    """A concrete file a push could change for one `paths` entry."""
    return path_glob.replace("/**", "/example.txt")


def test_every_path_django_releases_makes_the_site_wait():
    pattern = backend_pattern()
    paths = push_paths(DJANGO)
    assert "lai/**" in paths
    for path_glob in paths:
        assert pattern.search(example(path_glob)), path_glob


def test_site_only_changes_do_not_wait_for_django():
    pattern = backend_pattern()
    for path in (
        "react/src/app/App.tsx",
        "package-lock.json",
        "README.md",
        ".github/workflows/ci.yml",
    ):
        assert not pattern.search(path), path


def test_nothing_runs_until_the_owner_enables_it():
    jobs = SITE.split("\njobs:\n", 1)[1]
    names = re.findall(r"^  ([a-z][a-z-]*):\n", jobs, flags=re.MULTILINE)
    assert names == ["backend", "deploy-dev", "deploy-prod", "rollback"]
    parts = re.split(r"^  [a-z][a-z-]*:\n", jobs, flags=re.MULTILINE)[1:]
    bodies = dict(zip(names, parts, strict=True))
    for gated in ("backend", "rollback"):
        assert "vars.LAI_SITE_DEPLOY_ENABLED == 'true'" in bodies[gated], gated
    # The release jobs only run after the gated wait job succeeded.
    assert "needs: backend" in bodies["deploy-dev"]
    assert "needs.backend.result == 'success'" in bodies["deploy-prod"]


def test_each_environment_job_uses_its_own_github_environment():
    assert "name: site-dev" in SITE
    assert "name: site-prod" in SITE
    assert "name: site-${{ inputs.environment }}" in SITE
    assert "secrets." not in SITE  # OIDC only
