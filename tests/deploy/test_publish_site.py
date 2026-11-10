"""scripts/aws/publish-site.sh (LAI-INFRA-004), run for real against a fake `aws`.

The fake keeps an in-memory bucket as files under a temporary directory and records every call,
so the tests check what lands where, with which Cache-Control, and in which order. Nothing here
touches AWS or the network.
"""

import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/aws/publish-site.sh"
SHA_1 = "1" * 40
SHA_2 = "2" * 40

pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")

# A tiny `aws`: s3 sync / cp (local to bucket, bucket to bucket), s3api head-object, and
# cloudfront create-invalidation / wait. Objects are files under $FAKE_S3/<bucket>/<key> with a
# sidecar <key>.meta.json holding Cache-Control.
FAKE_AWS = r"""
import json, os, sys
from pathlib import Path

root = Path(os.environ["FAKE_S3"])
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")

def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default

def put(key_path, data, cache):
    key_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.write_bytes(data)
    Path(str(key_path) + ".meta.json").write_text(json.dumps({"cache": cache}))

def s3path(url):
    bucket, _, key = url[len("s3://"):].partition("/")
    return root / bucket / key

if args[:2] == ["s3", "sync"]:
    src, dst = Path(args[2]), s3path(args[3])
    excludes = [args[i + 1] for i, a in enumerate(args) if a == "--exclude"]
    from fnmatch import fnmatch
    for f in sorted(src.rglob("*")):
        if f.is_file():
            rel = f.relative_to(src).as_posix()
            if any(fnmatch(rel, pattern) for pattern in excludes):
                continue
            put(dst / rel, f.read_bytes(), opt("--cache-control"))
elif args[:2] == ["s3", "cp"]:
    src, dst = args[2], s3path(args[3])
    data = s3path(src).read_bytes() if src.startswith("s3://") else Path(src).read_bytes()
    put(dst, data, opt("--cache-control"))
elif args[:2] == ["s3api", "head-object"]:
    sys.exit(0 if (root / opt("--bucket") / opt("--key")).is_file() else 254)
elif args[:2] == ["cloudfront", "create-invalidation"]:
    print("I123")
elif args[:2] == ["cloudfront", "wait"]:
    pass
else:
    sys.exit(f"fake aws: unexpected {args}")
"""


@pytest.fixture
def site(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (tmp_path / "fake_aws.py").write_text(FAKE_AWS)
    fake = bin_dir / "aws"
    fake.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{tmp_path / "fake_aws.py"}" "$@"\n')
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    s3 = tmp_path / "s3"
    s3.mkdir()
    log = tmp_path / "aws.log"
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_S3": str(s3)}
    env["FAKE_LOG"] = str(log)

    def run(*args):
        return subprocess.run(["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True)

    def calls():
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def obj(key):
        path = s3 / "web" / key
        meta = json.loads(Path(str(path) + ".meta.json").read_text())
        return path.read_text(), meta["cache"]

    return run, calls, obj, tmp_path


def invalidated_paths(calls):
    call = next(call for call in calls if call[:2] == ["cloudfront", "create-invalidation"])
    start = call.index("--paths") + 1
    return call[start : call.index("--query")]


def build(tmp_path, name, shell_text, asset):
    dist = tmp_path / name
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(shell_text)
    (dist / "assets" / asset).write_text("js")
    (dist / "favicon.svg").write_text("svg")
    return dist


def test_publish_uploads_hashed_files_first_and_the_shell_last(site):
    run, calls, obj, tmp = site
    dist = build(tmp, "dist", "<html>release 1</html>", "index-aaa.js")
    result = run("publish", str(dist), "web", "E123", SHA_1)
    assert result.returncode == 0, result.stderr

    assert obj("assets/index-aaa.js") == ("js", "public, max-age=31536000, immutable")
    assert obj("favicon.svg") == ("svg", "public, max-age=3600")
    assert obj("index.html") == ("<html>release 1</html>", "no-cache")
    assert obj(f"_releases/{SHA_1}/index.html")[0] == "<html>release 1</html>"

    log = calls()
    shell = next(
        i
        for i, call in enumerate(log)
        if call[:2] == ["s3", "cp"] and call[3] == "s3://web/index.html"
    )
    syncs = [i for i, call in enumerate(log) if call[:2] == ["s3", "sync"]]
    assert syncs and max(syncs) < shell
    assert invalidated_paths(calls()) == ["/index.html"]
    # The general sync never touches the shell or the release copies.
    general = [call for call in calls() if call[:2] == ["s3", "sync"] and call[3] == "s3://web/"][0]
    assert "index.html" in general and "_releases/*" in general


def test_publish_never_deletes_the_previous_release_files(site):
    run, calls, obj, tmp = site
    assert (
        run("publish", str(build(tmp, "d1", "r1", "index-aaa.js")), "web", "E123", SHA_1).returncode
        == 0
    )
    assert (
        run("publish", str(build(tmp, "d2", "r2", "index-bbb.js")), "web", "E123", SHA_2).returncode
        == 0
    )
    assert obj("assets/index-aaa.js")[0] == "js"  # an open tab on release 1 still loads
    assert obj("index.html")[0] == "r2"
    assert not any("--delete" in call or call[:2] == ["s3", "rm"] for call in calls())


def test_rollback_restores_an_earlier_shell_without_a_rebuild(site):
    run, calls, obj, tmp = site
    run("publish", str(build(tmp, "d1", "r1", "index-aaa.js")), "web", "E123", SHA_1)
    run("publish", str(build(tmp, "d2", "r2", "index-bbb.js")), "web", "E123", SHA_2)
    result = run("rollback", "web", "E123", SHA_1)
    assert result.returncode == 0, result.stderr
    assert obj("index.html") == ("r1", "no-cache")
    assert calls()[-2][:2] == ["cloudfront", "create-invalidation"]


def test_rollback_refuses_a_release_that_was_never_published(site):
    run, _, obj, tmp = site
    run("publish", str(build(tmp, "d1", "r1", "index-aaa.js")), "web", "E123", SHA_1)
    result = run("rollback", "web", "E123", SHA_2)
    assert result.returncode == 1
    assert "no release" in result.stderr
    assert obj("index.html")[0] == "r1"


def test_publish_ships_the_game_shell_when_the_build_has_one(site):
    run, calls, obj, tmp = site
    dist = build(tmp, "dist", "app", "index-aaa.js")
    (dist / "game").mkdir()
    (dist / "game" / "index.html").write_text("game")
    assert run("publish", str(dist), "web", "E123", SHA_1).returncode == 0
    assert obj("game/index.html") == ("game", "no-cache")
    assert invalidated_paths(calls()) == ["/index.html", "/game/index.html"]


@pytest.mark.parametrize(
    "args",
    [
        ("publish", "dist", "web", "E123", "abc"),
        ("rollback", "web", "E123", "HEAD"),
        ("deploy",),
    ],
)
def test_bad_arguments_are_refused_before_any_aws_call(site, args):
    run, calls, _, tmp = site
    result = run(*args)
    assert result.returncode == 2
    assert calls() == []
