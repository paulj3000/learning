"""AM-16 checker (scripts/aws/verify-asset-delivery.py) against a local fake API.

The fake answers like the deployed resolver and delivery view (docs/ASSET_LIBRARY.md sections 7
and 8); each test bends one behaviour and expects the checker to notice. Nothing leaves loopback.
"""

import hashlib
import importlib.util
import json
import os
import stat
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/aws/verify-asset-delivery.py"
TOKEN = "parent-access-token-that-must-never-be-printed"
CHILD = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
GLB = b"glTF" + b"\x02\x00\x00\x00" + b"\x00" * 40
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 30
GOOD_TOKEN = "eyJ2IjoiYWJjIn0:1vXyZ:signature0123456789abcdef"


def load():
    spec = importlib.util.spec_from_file_location("verify_asset_delivery", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses look their module up while it loads
    spec.loader.exec_module(module)
    return module


verify = load()


class Fake:
    """What the fake API does; tests change fields to break one promise at a time."""

    def __init__(self):
        self.files = {
            "npc-pip": ("model.glb", GLB, "model/gltf-binary"),
            "sky-tile": ("image.png", PNG, "image/png"),
        }
        self.status = {"npc-pip": "resolved", "sky-tile": "resolved", "old-boat": "retired"}
        self.revoked: set[str] = set()
        self.resolver_cache = "private, no-cache"
        self.file_cache = "private, max-age=1800, immutable"
        self.serve_bytes: dict[str, bytes] = {}
        self.accept_any_token = False
        self.other_child_status = 404
        self.anonymous_resolver_status = 401


def make_handler(fake: Fake):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, status, body=b"", headers=None):
            self.send_response(status)
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            parts = urlsplit(self.path)
            if parts.path.startswith("/api/v1/children/"):
                child = parts.path.split("/")[4]
                if self.headers.get("Authorization") != f"Bearer {TOKEN}":
                    return self.send(fake.anonymous_resolver_status)
                if child != CHILD:
                    return self.send(fake.other_child_status)
                assets = []
                for ref in parse_qs(parts.query)["ids"][0].split(","):
                    entry = {"ref": ref, "id": ref, "status": fake.status.get(ref, "unavailable")}
                    if entry["status"] == "resolved":
                        name, data, content_type = fake.files[ref]
                        entry.update(
                            version=1,
                            kind="prop",
                            contentType=content_type,
                            sizeBytes=len(data),
                            sha256=hashlib.sha256(data).hexdigest(),
                            url=f"/api/v1/asset-files/{ref}.{GOOD_TOKEN}/{name}",
                            clips=["Idle"] if name.endswith(".glb") else None,
                        )
                    assets.append(entry)
                body = json.dumps({"assets": assets}).encode()
                return self.send(
                    200,
                    body,
                    {"Cache-Control": fake.resolver_cache, "Content-Type": "application/json"},
                )
            if parts.path.startswith("/api/v1/asset-files/"):
                token = parts.path.split("/")[4]
                ref, _, signature = token.partition(".")
                if ref in fake.revoked or ref not in fake.files:
                    return self.send(404)
                if signature != GOOD_TOKEN and not fake.accept_any_token:
                    return self.send(404)
                name, data, content_type = fake.files[ref]
                data = fake.serve_bytes.get(ref, data)
                return self.send(
                    200, data, {"Content-Type": content_type, "Cache-Control": fake.file_cache}
                )
            return self.send(404)

    return Handler


@pytest.fixture
def server():
    fake = Fake()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(fake))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    fake.base = f"http://127.0.0.1:{httpd.server_address[1]}"
    yield fake
    httpd.shutdown()


def run(fake, capsys, monkeypatch, *extra, ids="npc-pip,sky-tile"):
    monkeypatch.setenv(verify.TOKEN_ENV, TOKEN)
    code = verify.main(
        [
            "--api-base",
            fake.base,
            "--child",
            CHILD,
            "--ids",
            ids,
            "--other-child",
            OTHER,
            "--json",
            *extra,
        ]
    )
    out = capsys.readouterr().out
    assert TOKEN not in out and GOOD_TOKEN not in out  # neither credential is ever printed
    return code, {r["check"]: r for r in json.loads(out)}


def failures(results):
    return [name for name, r in results.items() if r["result"] == "fail"]


def test_a_healthy_django_delivery_passes_every_check(server, capsys, monkeypatch):
    code, results = run(server, capsys, monkeypatch, "--expect-delivery", "django")
    assert code == 0 and failures(results) == []
    names = " | ".join(results)
    for promise in (
        "refuses a request without a token",
        "private, no-cache",
        "SHA-256",
        "tampered URL is refused",
        "another family's child is a 404",
        "delivery mode is django",
        "cacheable privately and immutably",
    ):
        assert promise in names


@pytest.mark.parametrize(
    "breakage, failing",
    [
        (lambda f: f.serve_bytes.update({"npc-pip": GLB[:-1] + b"\x01"}), "npc-pip: SHA-256"),
        (lambda f: setattr(f, "accept_any_token", True), "npc-pip: a tampered URL"),
        (lambda f: setattr(f, "resolver_cache", "public, max-age=60"), "private, no-cache"),
        (lambda f: setattr(f, "file_cache", "public, max-age=60"), "privately and immutably"),
        (lambda f: setattr(f, "other_child_status", 200), "another family's child"),
        (lambda f: setattr(f, "anonymous_resolver_status", 200), "without a token"),
        (lambda f: f.status.update({"sky-tile": "unavailable"}), "sky-tile: resolves as resolved"),
        (lambda f: f.serve_bytes.update({"sky-tile": b"GIF89a" + PNG[6:]}), "real image/png"),
    ],
)
def test_each_broken_promise_fails_the_run(server, capsys, monkeypatch, breakage, failing):
    breakage(server)
    code, results = run(server, capsys, monkeypatch)
    assert code == 1
    assert any(failing in name for name in failures(results)), failures(results)


def test_retirement_revokes_previously_issued_django_urls(server, capsys, monkeypatch, tmp_path):
    saved = tmp_path / "urls.json"
    code, _ = run(server, capsys, monkeypatch, "--save-urls", str(saved))
    assert code == 0
    assert stat.S_IMODE(os.stat(saved).st_mode) == 0o600
    assert set(json.loads(saved.read_text())) == {"npc-pip", "sky-tile"}

    server.status["npc-pip"] = "retired"
    server.revoked.add("npc-pip")
    code, results = run(
        server, capsys, monkeypatch, "--expect", "retired:npc-pip", "--revoked-urls", str(saved)
    )
    assert code == 0, failures(results)
    assert results["npc-pip: a URL issued before retirement now fails"]["result"] == "pass"

    server.revoked.clear()  # retirement that did not revoke
    code, results = run(
        server, capsys, monkeypatch, "--expect", "retired:npc-pip", "--revoked-urls", str(saved)
    )
    assert code == 1 and "npc-pip: a URL issued before retirement now fails" in failures(results)


def test_expected_retired_and_unavailable_ids(server, capsys, monkeypatch):
    code, results = run(
        server,
        capsys,
        monkeypatch,
        "--expect",
        "unavailable:never-made",
        "--expect",
        "retired:old-boat",
        ids="npc-pip,old-boat,never-made",
    )
    assert code == 0, failures(results)


@pytest.mark.parametrize(
    "argv, env",
    [
        (["--api-base", "http://api.example.com", "--child", CHILD, "--ids", "npc-pip"], TOKEN),
        (["--api-base", "https://api.example.com", "--child", "nope", "--ids", "npc-pip"], TOKEN),
        (["--api-base", "https://api.example.com", "--child", CHILD, "--ids", "Bad Id"], TOKEN),
        (
            [
                "--api-base",
                "https://api.example.com",
                "--child",
                CHILD,
                "--ids",
                "a",
                "--expect",
                "gone:a",
            ],
            TOKEN,
        ),
        (["--api-base", "https://api.example.com", "--child", CHILD, "--ids", "npc-pip"], ""),
    ],
)
def test_usage_errors_exit_2_before_any_request(monkeypatch, capsys, argv, env):
    monkeypatch.setenv(verify.TOKEN_ENV, env)
    assert verify.main(argv) == 2
    assert "usage error" in capsys.readouterr().err


@pytest.mark.parametrize(
    "url, expected",
    [
        (
            "https://api.example.com/api/v1/asset-files/abc:def/model.glb",
            "https://api.example.com/api/v1/asset-files/<token>/model.glb",
        ),
        (
            "https://d1.cloudfront.net/assets/models/npc-pip/7c0e.glb?Expires=1&Signature=x&Key-Pair-Id=K",
            "https://d1.cloudfront.net/assets/models/<id>/<version file>",
        ),
    ],
)
def test_redaction_drops_tokens_and_signatures(url, expected):
    assert verify.redact(url) == expected


def test_modes_and_tampering_for_signed_urls():
    cdn = "https://d1.cloudfront.net/assets/models/a/b.glb?Expires=1&Signature=Abc&Key-Pair-Id=K"
    s3 = "https://b.s3.us-west-1.amazonaws.com/assets/models/a/b.glb?X-Amz-Signature=abc"
    assert verify.delivery_mode(cdn) == "cloudfront" and verify.delivery_mode(s3) == "s3"
    assert verify.delivery_mode("/api/v1/asset-files/t/model.glb") == "django"
    assert "Signature=Bbc" in verify.tamper(cdn) and "X-Amz-Signature=Abc" in verify.tamper(s3)
