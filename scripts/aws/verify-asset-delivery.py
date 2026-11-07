#!/usr/bin/env python3
"""AM-16: read-only acceptance checks for asset delivery on a deployed environment.

Runs against a deployed Django API (dev first) with a parent's Cognito access token, and checks
what the child-facing asset path promises (docs/ASSET_LIBRARY.md sections 7 to 9):

- the resolver needs a token, answers `private, no-cache`, and hides other families' children;
- each expected asset resolves (or is `retired` / `unavailable` when told so);
- every delivered file is fetched WITHOUT a token and matches its published version exactly
  (content type, size, SHA-256), and is cacheable as the mode says;
- a tampered delivery URL is refused;
- the bucket, and in `cloudfront` mode an unsigned CDN URL, refuse anonymous reads;
- after a retirement, URLs captured earlier stop working (`django` mode) or are reported as
  still valid until expiry (`s3`, `cloudfront`: issued URLs are not revocable by design).

Standard library only, so it runs from any workstation or the EC2 host without installing
anything. It never writes to the API and never prints the token. Signed URLs are bearer
credentials for their lifetime, so output shows only their host and path family, and
`--save-urls` writes them to a mode-0600 file.

    export LAI_VERIFY_ACCESS_TOKEN=...   # a dev parent's Cognito access token, never on argv
    python3 scripts/aws/verify-asset-delivery.py \\
        --api-base https://api.dev.example.com --child <uuid> \\
        --ids npc-pip,treasure-chest,ground-tile,<image id>,<audio id> \\
        --other-child <uuid of another family's child> \\
        --bucket lai-assets-dev-<account>-<region> --region <region> \\
        --save-urls /tmp/lai-am16-urls.json

Exit status: 0 when every check passed, 1 when any failed, 2 for a usage error.
See docs/platform/ASSET_DELIVERY_DEV_ACCEPTANCE.md for the full AM-16 runbook.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit, urlunsplit

TOKEN_ENV = "LAI_VERIFY_ACCESS_TOKEN"  # noqa: S105 (the variable name, not a value)
ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}(@[0-9]{1,6})?$")
UUID_PATTERN = re.compile(r"^[0-9a-fA-F-]{36}$")
EXPECTATIONS = {"resolved", "retired", "unavailable"}
TIMEOUT = 20
MAX_BYTES = 64 * 1024 * 1024
# Leading bytes per content type, so a wrong body with the right header still fails.
MAGIC = {
    "model/gltf-binary": [b"glTF"],
    "model/gltf+json": [b"{"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/webp": [b"RIFF"],
    "audio/mpeg": [b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"],
    "audio/ogg": [b"OggS"],
    "audio/wav": [b"RIFF"],
}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # a redirect is an answer, not something to follow
        return None


_opener = urllib.request.build_opener(_NoRedirect)


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes


def fetch(url: str, headers: dict[str, str] | None = None) -> Response:
    if urlsplit(url).scheme not in {"https", "http"}:  # never file: or custom schemes
        raise ValueError(f"refusing to fetch {redact(url)}")
    request = urllib.request.Request(  # noqa: S310 (scheme checked above)
        url, headers={"User-Agent": "lai-am16-verify", **(headers or {})}
    )
    try:
        with _opener.open(request, timeout=TIMEOUT) as answer:  # noqa: S310 (scheme checked above)
            body = answer.read(MAX_BYTES + 1)
            return Response(answer.status, {k.lower(): v for k, v in answer.headers.items()}, body)
    except urllib.error.HTTPError as error:
        return Response(error.code, {k.lower(): v for k, v in error.headers.items()}, error.read())


def redact(url: str) -> str:
    """Host and path family only: signed tokens and query strings are credentials."""
    parts = urlsplit(url)
    path = parts.path
    if path.startswith("/api/v1/asset-files/"):
        path = "/api/v1/asset-files/<token>/" + path.rsplit("/", 1)[-1]
    elif "/assets/" in path or path.startswith("/assets/"):
        family = path.split("/")[2] if path.startswith("/assets/") else "?"
        path = f"/assets/{family}/<id>/<version file>"
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def delivery_mode(url: str) -> str:
    parts = urlsplit(url)
    if not parts.netloc or parts.path.startswith("/api/v1/asset-files/"):
        return "django"
    if parts.netloc.endswith(".amazonaws.com"):
        return "s3"
    return "cloudfront"


def tamper(url: str) -> str:
    """Change one character of the signature (django token, or the Signature query value)."""
    parts = urlsplit(url)
    if parts.query:
        query = re.sub(
            r"(Signature|X-Amz-Signature)=([^&])",
            lambda m: f"{m.group(1)}={'B' if m.group(2) == 'A' else 'A'}",
            parts.query,
            count=1,
        )
        return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))
    segments = parts.path.split("/")
    token = segments[-2]
    index = len(token) - 3
    swapped = "y" if token[index] == "x" else "x"
    segments[-2] = token[:index] + swapped + token[index + 1 :]
    return urlunsplit((parts.scheme, parts.netloc, "/".join(segments), "", ""))


@dataclass
class Report:
    results: list[dict] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str = "", *, info: bool = False) -> bool:
        outcome = "info" if info else ("pass" if ok else "fail")
        self.results.append({"check": name, "result": outcome, "detail": detail})
        return ok

    @property
    def failed(self) -> list[dict]:
        return [r for r in self.results if r["result"] == "fail"]


def parse_expectations(ids: list[str], expects: list[str]) -> dict[str, str]:
    expected = dict.fromkeys(ids, "resolved")
    for item in expects:
        status, _, ref = item.partition(":")
        if status not in EXPECTATIONS or not ID_PATTERN.match(ref):
            raise ValueError(f"--expect must be <resolved|retired|unavailable>:<id>, not {item!r}")
        expected[ref] = status
    return expected


def check_file(report: Report, ref: str, entry: dict, api_base: str) -> str | None:
    """Fetch one delivered file without a token; return its absolute URL when it passed."""
    url = urljoin(api_base + "/", entry.get("url", ""))
    mode = delivery_mode(url)
    if not url.startswith("https://") and not url.startswith("http://127.0.0.1"):
        report.check(f"{ref}: delivery URL is HTTPS", False, redact(url))
        return None
    answer = fetch(url)
    label = f"{ref}: file ({mode}) {redact(url)}"
    if not report.check(
        f"{label} answers 200 without a token", answer.status == 200, f"status {answer.status}"
    ):
        return None
    content_type = answer.headers.get("content-type", "").split(";")[0].strip()
    ok = report.check(
        f"{ref}: content type matches the version",
        content_type == entry["contentType"],
        f"{content_type!r} vs {entry['contentType']!r}",
    )
    ok &= report.check(
        f"{ref}: size matches the version",
        len(answer.body) == entry["sizeBytes"],
        f"{len(answer.body)} vs {entry['sizeBytes']} bytes",
    )
    digest = hashlib.sha256(answer.body).hexdigest()
    ok &= report.check(f"{ref}: SHA-256 matches the published version", digest == entry["sha256"])
    magic = MAGIC.get(entry["contentType"])
    if magic:
        ok &= report.check(
            f"{ref}: body is a real {entry['contentType']}",
            any(answer.body.startswith(m) for m in magic),
        )
    if entry.get("clips") is not None and entry["contentType"].startswith("model/"):
        report.check(
            f"{ref}: animation clips declared", True, ", ".join(entry["clips"]) or "none", info=True
        )
    cache_control = answer.headers.get("cache-control", "")
    if mode == "django":
        ok &= report.check(
            f"{ref}: cacheable privately and immutably",
            cache_control.startswith("private") and "immutable" in cache_control,
            cache_control,
        )
    refused = fetch(tamper(url)).status
    ok &= report.check(
        f"{ref}: a tampered URL is refused", refused in {403, 404}, f"status {refused}"
    )
    if mode in {"s3", "cloudfront"}:
        parts = urlsplit(url)
        unsigned = fetch(urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))).status
        ok &= report.check(
            f"{ref}: the unsigned {mode} URL is refused", unsigned == 403, f"status {unsigned}"
        )
    return url if ok else None


def check_revoked(report: Report, saved: dict[str, str], expected: dict[str, str]) -> None:
    for ref, url in saved.items():
        if expected.get(ref) != "retired":
            continue
        status = fetch(url).status
        mode = delivery_mode(url)
        if mode == "django":
            report.check(
                f"{ref}: a URL issued before retirement now fails",
                status == 404,
                f"status {status}",
            )
        else:
            report.check(
                f"{ref}: URL issued before retirement ({mode})",
                True,
                f"status {status}; {mode} URLs stay valid until they expire (by design)",
                info=True,
            )


def run(args: argparse.Namespace, token: str) -> Report:
    report = Report()
    api_base = args.api_base.rstrip("/")
    ids = [i.strip() for i in args.ids.split(",") if i.strip()]
    expected = parse_expectations(ids, args.expect)
    resolver = f"{api_base}/api/v1/children/{args.child}/assets/?ids={','.join(expected)}"
    auth = {"Authorization": f"Bearer {token}"}

    anonymous = fetch(resolver)
    report.check(
        "resolver refuses a request without a token",
        anonymous.status == 401,
        f"status {anonymous.status}",
    )
    answer = fetch(resolver, auth)
    if not report.check(
        "resolver answers 200 for the parent's child",
        answer.status == 200,
        f"status {answer.status}",
    ):
        return report
    report.check(
        "resolver answers are private, no-cache",
        answer.headers.get("cache-control") == "private, no-cache",
        answer.headers.get("cache-control", ""),
    )
    try:
        entries = {e["ref"]: e for e in json.loads(answer.body)["assets"]}
    except (ValueError, KeyError, TypeError):
        report.check("resolver body is the documented JSON", False)
        return report

    delivered: dict[str, str] = {}
    for ref, want in expected.items():
        entry = entries.get(ref, {})
        got = entry.get("status", "missing")
        if not report.check(f"{ref}: resolves as {want}", got == want, f"got {got}"):
            continue
        if want == "resolved":
            report.check(
                f"{ref}: version {entry.get('version')} ({entry.get('kind')})",
                True,
                entry.get("contentType", ""),
                info=True,
            )
            url = check_file(report, ref, entry, api_base)
            if url:
                delivered[ref] = url
    if args.expect_delivery:
        modes = {delivery_mode(u) for u in delivered.values()}
        report.check(
            f"delivery mode is {args.expect_delivery}",
            modes <= {args.expect_delivery},
            ", ".join(sorted(modes)) or "nothing delivered",
        )

    if args.other_child:
        other = fetch(f"{api_base}/api/v1/children/{args.other_child}/assets/?ids={ids[0]}", auth)
        report.check(
            "another family's child is a 404", other.status == 404, f"status {other.status}"
        )
    if args.bucket:
        region = f".{args.region}" if args.region else ""
        bucket = f"https://{args.bucket}.s3{region}.amazonaws.com"
        listing = fetch(bucket + "/").status
        report.check("the bucket refuses anonymous listing", listing == 403, f"status {listing}")
        probe = fetch(f"{bucket}/assets/models/").status
        report.check("the bucket refuses anonymous reads", probe == 403, f"status {probe}")
    if args.revoked_urls:
        with open(args.revoked_urls, encoding="utf-8") as handle:
            check_revoked(report, json.load(handle), expected)
    if args.save_urls:
        descriptor = os.open(
            args.save_urls, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR
        )
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(delivered, handle)
        report.check(
            "signed URLs saved for the retirement check",
            True,
            f"{len(delivered)} URL(s), file mode 0600; delete it afterwards",
            info=True,
        )
    return report


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--api-base", required=True, help="https://<api host>, no trailing path")
    parser.add_argument("--child", required=True, help="a child of the token's parent")
    parser.add_argument("--ids", required=True, help="comma-separated asset ids (pins allowed)")
    parser.add_argument(
        "--expect",
        action="append",
        default=[],
        help="override per id: retired:<id> or unavailable:<id> (repeatable)",
    )
    parser.add_argument("--expect-delivery", choices=["django", "s3", "cloudfront"])
    parser.add_argument("--other-child", help="a child of ANOTHER family, must be a 404")
    parser.add_argument("--bucket", help="asset bucket name, checked for anonymous access")
    parser.add_argument("--region", help="bucket region")
    parser.add_argument("--save-urls", help="write delivered signed URLs here (mode 0600)")
    parser.add_argument("--revoked-urls", help="URLs saved before a retirement, to re-check")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    token = os.environ.get(TOKEN_ENV, "").strip()
    problems = []
    if not token:
        problems.append(f"set {TOKEN_ENV} to a parent's Cognito access token")
    if not (args.api_base.startswith("https://") or args.api_base.startswith("http://127.0.0.1")):
        problems.append("--api-base must be https:// (or http://127.0.0.1 for a local run)")
    for name in ("child", "other_child"):
        value = getattr(args, name)
        if value and not UUID_PATTERN.match(value):
            problems.append(f"--{name.replace('_', '-')} must be a child UUID")
    ids = [i.strip() for i in args.ids.split(",") if i.strip()]
    if not ids or len(ids) > 100 or not all(ID_PATTERN.match(i) for i in ids):
        problems.append("--ids must be 1 to 100 asset ids")
    try:
        parse_expectations(ids, args.expect)
    except ValueError as error:
        problems.append(str(error))
    if problems:
        for problem in problems:
            print(f"usage error: {problem}", file=sys.stderr)
        return 2

    report = run(args, token)
    if args.json:
        print(json.dumps(report.results, indent=2))
    else:
        for result in report.results:
            detail = f"  ({result['detail']})" if result["detail"] else ""
            print(f"[{result['result'].upper():4}] {result['check']}{detail}")
        passed = sum(r["result"] == "pass" for r in report.results)
        print(f"\n{passed} passed, {len(report.failed)} failed")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
