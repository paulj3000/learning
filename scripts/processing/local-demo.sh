#!/usr/bin/env bash
# Local Wave 2 demonstration (LAI-LAMBDA-002 to 004): Django job -> outbox relay -> local work queue
# -> local worker running the real GLB validator -> local completion queue -> Django consumer.
#
# Real components throughout; the only simulated pieces are the transport and storage (local
# directories instead of SQS and S3) and the synthetic GLB. Needs the compose PostgreSQL
# (`make up`, 127.0.0.1:5442). Uses its OWN database (default lai_processing_demo), never the
# shared development database, and its own directories under a temporary root. Nothing touches
# AWS. Usage: scripts/processing/local-demo.sh [--keep]
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
export LAI_ASSET_LOCAL_ROOT="$WORK/assets"
export LAI_JOBS_BACKEND=inline

step() { printf '\n== %s\n' "$*"; }

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

step "2. store a synthetic GLB as an AssetVersion through the real upload service (simulated staff upload)"
(cd "$ROOT/lai" && "$PY" manage.py shell -c '
import io, json
from apps.assets import services
from apps.assets.tests.helpers import glb_bytes, gltf_document, make_definition
from apps.catalog.models import ContentAsset
asset = ContentAsset.objects.filter(asset_id="demo-pip").first() or make_definition("demo-pip")
doc, binary = gltf_document(clips=("Idle", "Armature|mixamo.com|Layer0"))
data = glb_bytes(doc, binary)
version = services.upload_version(asset, io.BytesIO(data), original_filename="demo-pip.glb")
print(json.dumps({"asset": asset.asset_id, "version": str(version.version_id),
                  "status": version.status, "bytes": len(data)}))
')

step "3. submit an asset.validate_model job (job + attempt + outbox row in one transaction)"
(cd "$ROOT/lai" && "$PY" manage.py shell -c '
from apps.assets.models import AssetVersion
from apps.assets.processing import submit_model_validation
version = AssetVersion.objects.filter(asset__asset_id="demo-pip").order_by("-number").first()
job = submit_model_validation(version, user=None)
print(f"job={job.pk} kind={job.kind} state={job.state} status={job.status}")
')

step "4. relay the outbox to the local work queue"
(cd "$ROOT/lai" && "$PY" manage.py jobs_dispatch --once)
"$PY" -m lai_processing_runtime status --root "$WORK/processing"

step "5. run the local worker once (real GLB validator, filesystem stores)"
"$PY" -m lai_processing_runtime worker --root "$WORK/processing" --assets-root "$WORK/assets" \
  --namespace local --once

step "6. apply the completion in PostgreSQL (acknowledged only after commit)"
(cd "$ROOT/lai" && "$PY" manage.py jobs_consume_completions --once --wait-seconds 0)

step "7. status as staff would see it in Django Admin"
(cd "$ROOT/lai" && "$PY" manage.py shell -c '
import json
from apps.jobs.models import ProcessingJob
job = ProcessingJob.objects.filter(kind="asset.validate_model").order_by("-created_at").first()
attempt = job.job_attempts.order_by("-number").first()
meta = (attempt.result or {}).get("metadata", {})
print(json.dumps({
    "job": str(job.pk), "state": job.state, "status": job.status,
    "attempt": attempt.number, "verdict": attempt.verdict,
    "clips": [a["name"] for a in meta.get("animations", [])],
    "counts": meta.get("counts"), "artifacts": job.artifacts.count(),
    "receipts": list(job.receipts.values_list("action", flat=True)),
}, indent=2))
from apps.assets.models import AssetVersion
version = AssetVersion.objects.filter(asset__asset_id="demo-pip").order_by("-number").first()
print(f"asset version status unchanged by processing: {version.status}")
')
printf '\nDemo complete. Work directory: %s %s\n' "$WORK" "$([ "$KEEP" = "--keep" ] && echo '(kept)' || echo '(removed)')"
