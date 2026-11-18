#!/usr/bin/env python3
"""Processing release tooling (ADR-071): release manifests and the pre-enable compatibility check.

Standard library only. No AWS call: the workflow uploads what this tool verified, and the
compatibility check reads the JSON report Django writes
(`manage.py processing_release_check --json --exit-zero`, docs/processing/PROCESSING_RELEASE.md).

    processing_release.py versions --repo ROOT          # processor versions per kind
    processing_release.py manifest create --env prod --git-sha SHA --dist DIR --out FILE
        [--previous KEY] [--created-at ISO]
    processing_release.py manifest validate FILE
    processing_release.py manifest verify FILE --dist DIR
    processing_release.py stack-parameters FILE         # CloudFormation overrides
    processing_release.py check-enable --manifest FILE --django-report FILE --control NAME
        --env prod
    processing_release.py rollback-plan --target FILE [--current FILE]
        (--django-report FILE | --controls-off)

`--dist DIR` holds one directory per artifact (`DIR/<name>/<one>.zip`) and `DIR/versions.json`,
as scripts/release/build-workers.sh lays them out. The manifest is deterministic: the same commit,
artifacts, `--created-at` (the workflow passes the commit time) and `--previous` give the same
bytes, so a re-dispatch of a commit finds an identical manifest. Exit codes: 0 ok, 1 refused or
invalid, 2 usage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

SCHEMA_VERSION = 1
ENVIRONMENTS = ("dev", "prod")
GIT_SHA = re.compile(r"^[a-f0-9]{40}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")
KEY = re.compile(r"^(lambda/[A-Za-z0-9._-]+\.zip|lambda/layers/[A-Za-z0-9._-]+\.zip)$")
MANIFEST_KEY = re.compile(r"^releases/processing/[a-f0-9]{40}\.json$")
KIND = re.compile(r"^[a-z]+(\.[a-z_]+)+$")
VERSION = re.compile(r"^[0-9]+(\.[0-9]+){0,2}$")
TIMESTAMP = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
FIXED_TIME = "1970-01-01T00:00:00Z"

#: What each artifact is: its type, the functions it is deployed to (`{env}` is filled in), the
#: job kinds those functions accept (None: from the build's `kinds.json`), its code-key stack
#: parameter, and the executable pins it can carry.
ARTIFACTS = {
    "jobs-worker": {
        "type": "function-zip",
        "functions": ["lai-{env}-jobs-ai", "lai-{env}-jobs-media"],
        "kinds": None,
        "parameter": "WorkerCodeKey",
        "pins": [],
    },
    "audio-worker": {
        "type": "function-zip",
        "functions": ["lai-{env}-jobs-audio"],
        "kinds": ["asset.transcode_audio"],
        "parameter": "AudioWorkerCodeKey",
        "pins": [],
    },
    "ffmpeg-layer": {
        "type": "layer-zip",
        "functions": [],
        "kinds": [],
        "parameter": "AudioLayerKey",
        "pins": ["LAI_FFMPEG_SHA256"],
    },
    "image-worker": {
        "type": "function-zip",
        "functions": ["lai-{env}-jobs-image"],
        "kinds": ["asset.convert_image"],
        "parameter": "ImageWorkerCodeKey",
        "pins": [],
    },
    "optimize-worker": {
        "type": "function-zip",
        "functions": ["lai-{env}-jobs-optimize"],
        "kinds": ["asset.optimize"],
        "parameter": "OptimizeWorkerCodeKey",
        "pins": ["LAI_GLTFPACK_SHA256", "LAI_TOKTX_SHA256"],
    },
}

#: Executable pins (review F12) -> the stack parameter that sets the function's variable
#: (infra/lib/processingWorkers.ts PIN_PARAMETERS), and the file in the build record.
PINS = {
    "LAI_FFMPEG_SHA256": ("AudioFfmpegSha256", "bin/ffmpeg"),
    "LAI_GLTFPACK_SHA256": ("OptimizeGltfpackSha256", "bin/gltfpack"),
    "LAI_TOKTX_SHA256": ("OptimizeToktxSha256", "bin/toktx"),
}

#: Where each kind's processor version is declared, read without importing (the release runner
#: needs no Django or native libraries). Kinds not listed are version "1".
PROCESSOR_VERSIONS = {
    "asset.validate_model": (
        "processing/lai_processing/processors/gltf/processor.py",
        r'^\s*version\s*=\s*"([0-9.]+)"',
    ),
    "asset.transcode_audio": (
        "processing/lai_native/audio/processor.py",
        r'^PROCESSOR_VERSION(?::\s*Final)?\s*=\s*"([0-9.]+)"',
    ),
    "asset.convert_image": (
        "processing/lai_native/image/contract.py",
        r'^PROCESSOR_VERSION(?::\s*Final)?\s*=\s*"([0-9.]+)"',
    ),
    "asset.optimize": (
        "processing/lai_processing/processors/gltf/compression/optimize_contract.py",
        r'^PROCESSOR_VERSION(?::\s*Final)?\s*=\s*"([0-9.]+)"',
    ),
}

#: Feature controls (COMPLETION_INTEGRATION section 3): the kinds each one lets Django submit and
#: the function that must accept them. A control with no kinds (staff browser capture) needs no
#: worker. `LAI_ASSET_ASYNC_VALIDATION` keeps controlling GLB validation only.
CONTROLS = {
    "LAI_AUDIO_TRANSCODING": {
        "kinds": ["asset.transcode_audio"],
        "function": "lai-{env}-jobs-audio",
        "queue_setting": "LAI_JOBS_AUDIO_QUEUE_URL",
    },
    "LAI_IMAGE_CONVERSION": {
        "kinds": ["asset.convert_image"],
        "function": "lai-{env}-jobs-image",
        "queue_setting": "LAI_JOBS_IMAGE_QUEUE_URL",
    },
    "LAI_GLB_MESHOPT": {
        "kinds": ["asset.optimize"],
        "function": "lai-{env}-jobs-optimize",
        "queue_setting": "LAI_JOBS_OPTIMIZE_QUEUE_URL",
    },
    "LAI_GLB_KTX2": {
        "kinds": ["asset.optimize"],
        "function": "lai-{env}-jobs-optimize",
        "queue_setting": "LAI_JOBS_OPTIMIZE_QUEUE_URL",
    },
    "LAI_ASSET_ASYNC_VALIDATION": {
        "kinds": ["asset.validate_model"],
        "function": "lai-{env}-jobs-media",
        "queue_setting": "LAI_JOBS_MEDIA_QUEUE_URL",
    },
    "LAI_THUMBNAIL_CAPTURE": {"kinds": [], "function": None, "queue_setting": None},
}

#: Per-kind ordering (ADR-070, review F5): with a control on, Django sends request options that
#: only a processor at or above this version accepts, so the worker must ship first. While the
#: control is off Django omits the options and an older worker still accepts the request (its
#: verdicts are recorded as processor_outdated until it is updated).
CONTROL_MIN_VERSIONS = {
    "LAI_GLB_MESHOPT": {"asset.validate_model": "1.2.0"},
    "LAI_GLB_KTX2": {"asset.validate_model": "1.2.0"},
}
#: The function that runs each kind (for version lookups).
KIND_FUNCTIONS = {
    "asset.validate_model": "lai-{env}-jobs-media",
    "asset.transcode_audio": "lai-{env}-jobs-audio",
    "asset.convert_image": "lai-{env}-jobs-image",
    "asset.optimize": "lai-{env}-jobs-optimize",
}

#: Fields of the Django report (`manage.py processing_release_check --json --exit-zero`). Extra
#: fields are ignored; `required_processor_versions` ({kind: version}) is used when present.
REPORT_FIELDS = (
    "schema_version",
    "environment",
    "git_sha",
    "jobs_backend",
    "result_kinds",
    "submittable_kinds",
    "controls",
    "queue_urls_configured",
    "pending_migrations",
)


class Refused(Exception):
    """A manifest, report or check failed; the message says why (no secret, no content)."""


def version_tuple(version: str) -> tuple[int, ...]:
    parts = tuple(int(p) for p in version.split("."))
    return parts + (0,) * (3 - len(parts))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_key(name: str, sha256: str) -> str:
    kind = ARTIFACTS[name]["type"]
    base = "lambda/layers" if kind == "layer-zip" else "lambda"
    return f"{base}/{name}-{sha256[:16]}.zip"


def processor_versions(repo: Path) -> dict[str, str]:
    """{kind: version} read from the processor sources of this commit (missing file: skipped)."""
    found = {}
    for kind, (path, pattern) in PROCESSOR_VERSIONS.items():
        source = repo / path
        if not source.exists():
            continue
        match = re.search(pattern, source.read_text(), re.MULTILINE)
        if not match:
            raise Refused(f"no processor version found in {path}")
        found[kind] = match.group(1)
    return found


def jobs_worker_kinds(dist: Path) -> list[str]:
    """The kinds the jobs worker zip accepts: `<dist>/jobs-worker/kinds.json` written by the build
    (a JSON list), else none (the check then refuses every control routed to it)."""
    path = dist / "jobs-worker" / "kinds.json"
    if not path.exists():
        return []
    kinds = json.loads(path.read_text())
    if not isinstance(kinds, list) or not all(isinstance(k, str) and KIND.match(k) for k in kinds):
        raise Refused("jobs-worker/kinds.json must be a JSON list of job kinds")
    return sorted(set(kinds))


def build_record_pins(name: str, zip_path: Path, directory: Path) -> dict[str, str]:
    """Executable pins from the artifact's build record: `share/*/build-record.json` inside the
    zip (the FFmpeg layer), else `<dir>/build-record.json` beside it; `files_sha256[<file>]`."""
    wanted = ARTIFACTS[name]["pins"]
    if not wanted:
        return {}
    record = None
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.namelist():
            if member.endswith("/build-record.json") and member.startswith("share/"):
                record = json.loads(archive.read(member))
                break
    if record is None and (directory / "build-record.json").exists():
        record = json.loads((directory / "build-record.json").read_text())
    files = (record or {}).get("files_sha256", {})
    pins = {}
    for variable in wanted:
        value = files.get(PINS[variable][1])
        if isinstance(value, str) and SHA256.match(value):
            pins[variable] = value
    return pins


def create_manifest(
    env: str, git_sha: str, dist: Path, previous: str | None, created_at: str | None
) -> dict:
    if env not in ENVIRONMENTS:
        raise Refused(f"environment must be one of {ENVIRONMENTS}")
    if not GIT_SHA.match(git_sha):
        raise Refused("git sha must be 40 lower-case hex characters")
    versions_path = dist / "versions.json"
    versions = json.loads(versions_path.read_text()) if versions_path.exists() else {}
    artifacts = []
    for name in sorted(ARTIFACTS):
        directory = dist / name
        if not directory.is_dir():
            continue
        zips = sorted(directory.glob("*.zip"))
        if len(zips) != 1:
            raise Refused(f"{name}: expected exactly one .zip in {directory}, found {len(zips)}")
        digest = sha256_file(zips[0])
        spec = ARTIFACTS[name]
        kinds = jobs_worker_kinds(dist) if spec["kinds"] is None else list(spec["kinds"])
        artifacts.append(
            {
                "name": name,
                "type": spec["type"],
                "file": f"{name}/{zips[0].name}",
                "key": artifact_key(name, digest),
                "sha256": digest,
                "size_bytes": zips[0].stat().st_size,
                "functions": [f.format(env=env) for f in spec["functions"]],
                "supported_kinds": kinds,
                "kind_versions": {k: str(versions.get(k, "1")) for k in kinds},
                "pins": build_record_pins(name, zips[0], directory),
            }
        )
    if not artifacts:
        raise Refused(f"no artifact found under {dist}")
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "environment": env,
        "git_sha": git_sha,
        "created_at": created_at or FIXED_TIME,
        "manifest_key": f"releases/processing/{git_sha}.json",
        "previous_manifest_key": previous or None,
        "artifacts": artifacts,
    }
    validate_manifest(manifest)
    return manifest


def dumps(manifest: dict) -> str:
    """The one serialisation (sorted keys, two-space indent, final newline): deterministic."""
    return json.dumps(manifest, indent=2, sort_keys=True) + "\n"


ARTIFACT_FIELDS = {
    "name",
    "type",
    "file",
    "key",
    "sha256",
    "size_bytes",
    "functions",
    "supported_kinds",
    "kind_versions",
    "pins",
}


def validate_manifest(manifest: object) -> dict:
    if not isinstance(manifest, dict):
        raise Refused("manifest must be a JSON object")
    required = {
        "schema_version",
        "environment",
        "git_sha",
        "created_at",
        "manifest_key",
        "previous_manifest_key",
        "artifacts",
    }
    missing = required - manifest.keys()
    extra = manifest.keys() - required
    if missing or extra:
        raise Refused(f"manifest fields: missing {sorted(missing)}, unexpected {sorted(extra)}")
    if manifest["schema_version"] != SCHEMA_VERSION:
        raise Refused(f"unsupported manifest schema_version {manifest['schema_version']!r}")
    if manifest["environment"] not in ENVIRONMENTS:
        raise Refused("unknown environment")
    if not isinstance(manifest["git_sha"], str) or not GIT_SHA.match(manifest["git_sha"]):
        raise Refused("git_sha must be 40 lower-case hex characters")
    if not isinstance(manifest["created_at"], str) or not TIMESTAMP.match(manifest["created_at"]):
        raise Refused("created_at must be a UTC timestamp YYYY-MM-DDTHH:MM:SSZ")
    if manifest["manifest_key"] != f"releases/processing/{manifest['git_sha']}.json":
        raise Refused("manifest_key must be releases/processing/<git_sha>.json")
    previous = manifest["previous_manifest_key"]
    if previous is not None and (not isinstance(previous, str) or not MANIFEST_KEY.match(previous)):
        raise Refused("previous_manifest_key must be null or releases/processing/<sha>.json")
    if previous == manifest["manifest_key"]:
        raise Refused("previous_manifest_key must name an earlier release")
    artifacts = manifest["artifacts"]
    if not isinstance(artifacts, list) or not artifacts:
        raise Refused("artifacts must be a non-empty list")
    seen: set[str] = set()
    functions: set[str] = set()
    for artifact in artifacts:
        if not isinstance(artifact, dict) or set(artifact) != ARTIFACT_FIELDS:
            raise Refused(f"each artifact needs exactly the fields {sorted(ARTIFACT_FIELDS)}")
        name = artifact["name"]
        if name not in ARTIFACTS or name in seen:
            raise Refused(f"unknown or repeated artifact {name!r}")
        seen.add(name)
        spec = ARTIFACTS[name]
        if artifact["type"] != spec["type"]:
            raise Refused(f"{name}: type must be {spec['type']}")
        if not isinstance(artifact["sha256"], str) or not SHA256.match(artifact["sha256"]):
            raise Refused(f"{name}: sha256 must be 64 lower-case hex characters")
        expected_key = artifact_key(name, artifact["sha256"])
        if artifact["key"] != expected_key or not KEY.match(artifact["key"]):
            raise Refused(f"{name}: key must be content-addressed ({expected_key})")
        if not isinstance(artifact["size_bytes"], int) or artifact["size_bytes"] <= 0:
            raise Refused(f"{name}: size_bytes must be a positive integer")
        expected = [f.format(env=manifest["environment"]) for f in spec["functions"]]
        if artifact["functions"] != expected:
            raise Refused(f"{name}: functions must be {expected}")
        if functions.intersection(expected):
            raise Refused(f"{name}: a function appears in two artifacts")
        functions.update(expected)
        kinds = artifact["supported_kinds"]
        if not isinstance(kinds, list) or not all(
            isinstance(k, str) and KIND.match(k) for k in kinds
        ):
            raise Refused(f"{name}: supported_kinds must be a list of job kinds")
        if spec["kinds"] is not None and sorted(kinds) != sorted(spec["kinds"]):
            raise Refused(f"{name}: supported_kinds must be {spec['kinds']}")
        versions = artifact["kind_versions"]
        if (
            not isinstance(versions, dict)
            or set(versions) != set(kinds)
            or not all(isinstance(v, str) and VERSION.match(v) for v in versions.values())
        ):
            raise Refused(f"{name}: kind_versions must give a version for every supported kind")
        pins = artifact["pins"]
        if not isinstance(pins, dict) or not all(
            k in spec["pins"] and isinstance(v, str) and SHA256.match(v) for k, v in pins.items()
        ):
            raise Refused(f"{name}: pins must map {spec['pins'] or 'nothing'} to SHA-256 values")
        file = artifact["file"]
        if not isinstance(file, str) or not re.match(
            rf"^{re.escape(name)}/[A-Za-z0-9._-]+\.zip$", file
        ):
            raise Refused(f"{name}: file must be {name}/<name>.zip")
    if "audio-worker" in seen and "ffmpeg-layer" not in seen:
        raise Refused("audio-worker needs the ffmpeg-layer in the same manifest")
    return manifest


def verify_manifest(manifest: dict, dist: Path) -> None:
    validate_manifest(manifest)
    for artifact in manifest["artifacts"]:
        path = dist / artifact["file"]
        if not path.is_file():
            raise Refused(f"{artifact['name']}: {artifact['file']} is missing")
        if path.stat().st_size != artifact["size_bytes"]:
            raise Refused(f"{artifact['name']}: size differs from the manifest")
        if sha256_file(path) != artifact["sha256"]:
            raise Refused(f"{artifact['name']}: SHA-256 differs from the manifest")


def stack_parameters(manifest: dict) -> list[str]:
    """`Key=Value` CloudFormation overrides for this release: code keys, the layer key and every
    executable pin. Shared libraries under /opt/lib are covered by the layer zip's SHA-256 in the
    manifest, not by a pin."""
    validate_manifest(manifest)
    out = []
    for artifact in manifest["artifacts"]:
        out.append(f"{ARTIFACTS[artifact['name']]['parameter']}={artifact['key']}")
        for variable, value in sorted(artifact["pins"].items()):
            out.append(f"{PINS[variable][0]}={value}")
    return out


def validate_report(report: object, env: str) -> dict:
    if not isinstance(report, dict) or set(REPORT_FIELDS) - report.keys():
        raise Refused(f"the Django report needs the fields {list(REPORT_FIELDS)}")
    if report["schema_version"] != 1:
        raise Refused("unsupported Django report schema_version")
    if report["environment"] != env:
        raise Refused(
            f"Django reports LAI_ENVIRONMENT={report['environment']!r}, expected {env!r} (P7)"
        )
    for field in ("result_kinds", "submittable_kinds", "pending_migrations"):
        if not isinstance(report[field], list):
            raise Refused(f"report {field} must be a list")
    if not isinstance(report["controls"], dict) or not isinstance(
        report["queue_urls_configured"], dict
    ):
        raise Refused("report controls and queue_urls_configured must be objects")
    required = report.get("required_processor_versions", {})
    if not isinstance(required, dict) or not all(
        isinstance(v, str) and VERSION.match(v) for v in required.values()
    ):
        raise Refused("report required_processor_versions must map kinds to versions")
    return report


def deployed_kinds(manifest: dict, function: str) -> set[str]:
    for artifact in manifest["artifacts"]:
        if function in artifact["functions"]:
            return set(artifact["supported_kinds"])
    return set()


def deployed_version(manifest: dict, function: str, kind: str) -> str | None:
    for artifact in manifest["artifacts"]:
        if function in artifact["functions"]:
            return artifact["kind_versions"].get(kind)
    return None


def version_problems(manifest: dict, minimums: dict[str, str], env: str, label: str) -> list[str]:
    problems = []
    for kind, minimum in sorted(minimums.items()):
        function = KIND_FUNCTIONS.get(kind, "").format(env=env)
        have = deployed_version(manifest, function, kind) if function else None
        if have is None or version_tuple(have) < version_tuple(minimum):
            problems.append(
                f"{label}: {kind} needs processor {minimum} or newer on {function or 'its worker'}"
                f" (release {manifest['git_sha'][:12]} has {have or 'none'})"
            )
    return problems


def check_enable(manifest: dict, report: dict, control: str, env: str) -> list[str]:
    """Reasons the control must stay off; empty means it may be turned on."""
    validate_manifest(manifest)
    validate_report(report, env)
    if manifest["environment"] != env:
        raise Refused("the manifest is for another environment")
    if control not in CONTROLS:
        raise Refused(f"unknown feature control {control!r}")
    spec = CONTROLS[control]
    reasons: list[str] = []
    if report["git_sha"] != manifest["git_sha"]:
        reasons.append("Django and the workers were not released from the same commit")
    if report["pending_migrations"]:
        reasons.append("Django has unapplied migrations")
    if not spec["kinds"]:
        return reasons
    if report["jobs_backend"] != "sqs":
        reasons.append("LAI_JOBS_BACKEND is not sqs")
    function = spec["function"].format(env=env)
    accepted = deployed_kinds(manifest, function)
    for kind in spec["kinds"]:
        if kind not in report["result_kinds"]:
            reasons.append(f"Django cannot apply results of {kind}")
        if kind not in report["submittable_kinds"]:
            reasons.append(f"Django does not register {kind} for submission")
        if kind not in accepted:
            reasons.append(f"{function} in this release does not accept {kind}")
    if not report["queue_urls_configured"].get(spec["queue_setting"]):
        reasons.append(f"{spec['queue_setting']} is not configured (the worker is not enabled)")
    minimums = dict(CONTROL_MIN_VERSIONS.get(control, {}))
    required = report.get("required_processor_versions", {})
    for kind in [*spec["kinds"], *minimums]:
        if kind in required:
            current = minimums.get(kind, "0")
            if version_tuple(required[kind]) > version_tuple(current):
                minimums[kind] = required[kind]
    reasons.extend(version_problems(manifest, minimums, env, control))
    return reasons


def rollback_plan(
    target: dict,
    *,
    current: dict | None = None,
    report: dict | None = None,
    controls_off: bool = False,
) -> list[dict]:
    """Function code updates that return to `target`. Refused while a control that is on would
    route a kind to a function the target does not accept, or whose processor is older than the
    control needs (queue and contract compatibility). Without a Django report the caller must
    assert that every processing control is off (`controls_off`, a typed confirmation)."""
    validate_manifest(target)
    env = target["environment"]
    if current is not None:
        validate_manifest(current)
        if current["environment"] != env:
            raise Refused("the target manifest is for another environment")
    if report is None and not controls_off:
        raise Refused("a rollback needs the Django report or the confirmation controls are off")
    problems = []
    if report is not None:
        validate_report(report, env)
        for control, state in sorted(report["controls"].items()):
            if state != "on" or control not in CONTROLS or not CONTROLS[control]["kinds"]:
                continue
            function = CONTROLS[control]["function"].format(env=env)
            missing = set(CONTROLS[control]["kinds"]) - deployed_kinds(target, function)
            if missing:
                problems.append(
                    f"{control} is on but {function} at {target['git_sha'][:12]} "
                    f"does not accept {sorted(missing)}: turn it off first"
                )
            minimums = CONTROL_MIN_VERSIONS.get(control, {})
            problems.extend(
                f"{p}: turn it off first" for p in version_problems(target, minimums, env, control)
            )
    if problems:
        raise Refused("; ".join(problems))
    steps: list[dict] = []
    for artifact in target["artifacts"]:
        for function in artifact["functions"]:
            steps.append(
                {"function": function, "key": artifact["key"], "sha256": artifact["sha256"]}
            )
        if artifact["type"] == "layer-zip":
            steps.append(
                {
                    "stack_parameter": "AudioLayerKey",
                    "key": artifact["key"],
                    "sha256": artifact["sha256"],
                }
            )
    if current is not None:
        for artifact in current["artifacts"]:
            for kind, version in artifact["kind_versions"].items():
                for function in artifact["functions"]:
                    older = deployed_version(target, function, kind)
                    if older and version_tuple(older) < version_tuple(version):
                        steps.append(
                            {
                                "notice": f"{function}: {kind} goes back from {version} to "
                                f"{older}; Django records results as processor_outdated"
                            }
                        )
    return steps


def load(path: str) -> dict:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise Refused(f"cannot read {path}: {type(error).__name__}") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    versions = sub.add_parser("versions")
    versions.add_argument("--repo", required=True, type=Path)
    manifest = sub.add_parser("manifest").add_subparsers(dest="action", required=True)
    create = manifest.add_parser("create")
    create.add_argument("--env", required=True, choices=ENVIRONMENTS)
    create.add_argument("--git-sha", required=True)
    create.add_argument("--dist", required=True, type=Path)
    create.add_argument("--out", required=True, type=Path)
    create.add_argument("--previous")
    create.add_argument("--created-at")
    validate = manifest.add_parser("validate")
    validate.add_argument("file")
    verify = manifest.add_parser("verify")
    verify.add_argument("file")
    verify.add_argument("--dist", required=True, type=Path)
    params = sub.add_parser("stack-parameters")
    params.add_argument("file")
    check = sub.add_parser("check-enable")
    check.add_argument("--manifest", required=True)
    check.add_argument("--django-report", required=True)
    check.add_argument("--control", required=True)
    check.add_argument("--env", required=True, choices=ENVIRONMENTS)
    plan = sub.add_parser("rollback-plan")
    plan.add_argument("--target", required=True)
    plan.add_argument("--current")
    source = plan.add_mutually_exclusive_group(required=True)
    source.add_argument("--django-report")
    source.add_argument("--controls-off", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "versions":
            print(json.dumps(processor_versions(args.repo), sort_keys=True))
        elif args.command == "manifest" and args.action == "create":
            data = create_manifest(
                args.env, args.git_sha, args.dist, args.previous, args.created_at
            )
            args.out.write_text(dumps(data))
            print(args.out)
        elif args.command == "manifest" and args.action == "validate":
            validate_manifest(load(args.file))
            print("manifest valid")
        elif args.command == "manifest" and args.action == "verify":
            verify_manifest(load(args.file), args.dist)
            print("manifest verified: every artifact matches its SHA-256")
        elif args.command == "stack-parameters":
            print("\n".join(stack_parameters(load(args.file))))
        elif args.command == "check-enable":
            reasons = check_enable(
                load(args.manifest), load(args.django_report), args.control, args.env
            )
            if reasons:
                print(f"{args.control} must stay off:", file=sys.stderr)
                for reason in reasons:
                    print(f"  - {reason}", file=sys.stderr)
                return 1
            print(f"{args.control} may be turned on: producers and consumers support every kind")
        else:
            steps = rollback_plan(
                load(args.target),
                current=load(args.current) if args.current else None,
                report=load(args.django_report) if args.django_report else None,
                controls_off=args.controls_off,
            )
            print(json.dumps(steps, indent=2))
    except Refused as error:
        print(f"refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
