#!/usr/bin/env bash
# Local Wave 3 demonstration (LAI-LAMBDA-002 to 007): a staff GLB upload with
# LAI_ASSET_ASYNC_VALIDATION=on -> DRAFT version and job committed together -> outbox relay ->
# local work queue -> local worker running the real GLB validator -> local completion queue ->
# Django consumer -> asset hook (DRAFT -> VALIDATED) -> Admin results -> publication gate ->
# explicit staff publish -> existing resolver. Then a failing model (DRAFT -> REJECTED) and a
# corrected re-upload, and the flag-off path for comparison.
#
# Real components throughout; the only simulated pieces are the transport and storage (local
# directories instead of SQS and S3, Django file delivery instead of signed S3/CloudFront URLs) and
# the synthetic GLBs. Needs the compose PostgreSQL (`make up`, 127.0.0.1:5442). Uses its OWN
# database (default lai_processing_demo), never the shared development database, and its own
# directories under a temporary root. Nothing touches AWS. Usage:
#   scripts/processing/local-demo.sh [--keep]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${PY:-$( [ -x "$ROOT/.venv/bin/python" ] && echo "$ROOT/.venv/bin/python" || echo python3 )}"
DEMO_DB="${LAI_DEMO_DB:-lai_processing_demo}"
PGPORT="${POSTGRES_PORT:-5442}"
PGUSER="${POSTGRES_USER:-lai}"
PGPASSWORD_VALUE="${POSTGRES_PASSWORD:-local-dev-only-password}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/lai-processing-demo.XXXXXX")"
KEEP="${1:-}"

cleanup() { [ "$KEEP" = "--keep" ] || rm -rf "$WORK"; }
trap cleanup EXIT

export PYTHONPATH="$ROOT/processing${PYTHONPATH:+:$PYTHONPATH}"
export DJANGO_SETTINGS_MODULE=config.settings.local
export DATABASE_URL="postgres://$PGUSER:$PGPASSWORD_VALUE@127.0.0.1:$PGPORT/$DEMO_DB"
export LAI_PROCESSING_BACKEND=local
export LAI_PROCESSING_NAMESPACE=local
export LAI_PROCESSING_LOCAL_ROOT="$WORK/processing"
export LAI_ASSET_STORAGE=local
export LAI_ASSET_DELIVERY=django
export LAI_ASSET_LOCAL_ROOT="$WORK/assets"
export LAI_JOBS_BACKEND=inline
export LAI_ASSET_ASYNC_VALIDATION=on

step() { printf '\n== %s\n' "$*"; }
shell() { (cd "$ROOT/lai" && "$PY" manage.py shell -c "$1"); }
round_trip() {
  (cd "$ROOT/lai" && "$PY" manage.py jobs_dispatch --once)
  "$PY" -m lai_processing_runtime worker --root "$WORK/processing" --assets-root "$WORK/assets" \
    --namespace local --once
  (cd "$ROOT/lai" && "$PY" manage.py jobs_consume_completions --once --wait-seconds 0)
}

step "1. recreate the demo-only database $DEMO_DB and migrate"
PGPASSWORD="$PGPASSWORD_VALUE" "$PY" - "$DEMO_DB" "$PGUSER" "$PGPORT" <<'PYEOF'
import os, sys
import psycopg
name, user, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
with psycopg.connect(host="127.0.0.1", port=port, user=user, dbname="postgres",
                     password=os.environ["PGPASSWORD"], autocommit=True) as conn:
    if not name.startswith("lai_processing_demo"):
        raise SystemExit("refusing: the demo only recreates databases named lai_processing_demo*")
    conn.execute(f'drop database if exists "{name}" with (force)')
    conn.execute(f'create database "{name}"')
PYEOF
(cd "$ROOT/lai" && "$PY" manage.py migrate --noinput -v 0)

step "2. flag OFF for comparison: the existing synchronous upload (VALIDATED, no job)"
LAI_ASSET_ASYNC_VALIDATION=off shell '
import io, json
from apps.assets import services
from apps.assets.tests.helpers import glb_bytes, make_definition
from apps.jobs.models import ProcessingJob
asset = make_definition("demo-barrel", kind="prop", category="prop")
version = services.upload_version(asset, io.BytesIO(glb_bytes()), original_filename="barrel.glb")
print(json.dumps({"asset": asset.asset_id, "status": version.status, "jobs": ProcessingJob.objects.count()}))
'

step "3. flag ON: a staff upload of a Treasure Rush chest is stored as a DRAFT with its job"
shell '
import io, json
from apps.assets import services
from apps.assets.processing import validation_jobs
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition
from apps.jobs.models import JobAttempt, JobOutbox
asset = make_definition("treasure-chest", kind="prop", category="prop")
doc, binary = gltf_document(clips=("Idle", "Armature|mixamo.com|Layer0"))
version = services.upload_version(asset, io.BytesIO(glb_bytes(doc, binary)), original_filename="chest.glb")
job = validation_jobs(version).get()
print(json.dumps({"version": f"{asset.asset_id}@{version.number}", "status": version.status,
                  "job": str(job.pk), "state": job.state,
                  "attempts": JobAttempt.objects.filter(job=job).count(),
                  "outbox_unsent": JobOutbox.objects.filter(job=job, sent_at__isnull=True).count()}))
'

step "4. publication is refused before a passing background result (a draft, and a GLB validated before the flag)"
shell '
from apps.assets import services
from apps.assets.models import AssetVersion
for asset_id in ("treasure-chest", "demo-barrel"):
    version = AssetVersion.objects.get(asset__asset_id=asset_id, number=1)
    try:
        services.publish_version(version)
    except services.AssetActionRefused as refused:
        print(f"{asset_id}@1 ({version.status}) refused: {refused.code}")
'

step "5. relay, run the local worker (real GLB validator), apply the completion (ack after commit)"
round_trip

step "6. a duplicate completion changes nothing (the work message is resent and rerun)"
shell '
from apps.jobs.models import JobOutbox
print("outbox rows marked unsent again:", JobOutbox.objects.update(sent_at=None))
'
round_trip

step "7. results as staff see them in Django Admin (Background validation section, rendered HTML)"
shell '
import json, re
from django.contrib.admin.sites import site
from apps.assets.models import AssetVersion
from apps.jobs.models import CompletionReceipt
version = AssetVersion.objects.get(asset__asset_id="treasure-chest", number=1)
admin = site._registry[AssetVersion]
summary = version.metadata["model_validation"]
print(json.dumps({"status": version.status, "verdict": summary["verdict"],
                  "clips": [a["name"] for a in summary["animations"]],
                  "triangles": summary["triangle_count"], "meshes": summary["counts"]["meshes"],
                  "receipts": sorted(CompletionReceipt.objects.values_list("action", flat=True))}, indent=2))
html = str(admin.background_status(version)) + str(admin.background_model(version))
print("admin text:", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()[:400])
'

step "8. explicit staff publish passes the gate; the existing resolver serves the published version"
shell '
import json
from apps.assets import resolver, services
from apps.assets.models import AssetVersion
version = AssetVersion.objects.get(asset__asset_id="treasure-chest", number=1)
print("published:", services.publish_version(version).status)
[entry] = resolver.resolve(resolver.parse_references("treasure-chest"))
print(json.dumps({k: entry[k] for k in ("status", "version", "format", "clips")}))
'

step "9. a model the background validator refuses: DRAFT -> REJECTED, never publishable"
shell '
import io
from apps.assets import services
from apps.assets.models import AssetVersion
from apps.assets.tests.helpers import glb_bytes, gltf_document
doc, binary = gltf_document()
doc["nodes"][0]["translation"] = [10**400, 0, 0]
asset = AssetVersion.objects.get(asset__asset_id="treasure-chest", number=1).asset
version = services.upload_version(asset, io.BytesIO(glb_bytes(doc, binary)), original_filename="broken.glb")
print("uploaded:", version.label, version.status)
'
round_trip
shell '
from apps.assets import services
from apps.assets.models import AssetVersion
version = AssetVersion.objects.get(asset__asset_id="treasure-chest", number=2)
codes = sorted({f["code"] for f in version.validation_report if f.get("source") == "processing"})
print("status:", version.status, "processing findings:", codes)
try:
    services.publish_version(version)
except services.AssetActionRefused as refused:
    print(f"publish refused: {refused.code}")
'
printf '\nDemo complete. Work directory: %s %s\n' "$WORK" "$([ "$KEEP" = "--keep" ] && echo '(kept)' || echo '(removed)')"
