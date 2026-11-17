#!/usr/bin/env bash
# Local demonstration of asynchronous model validation on the canonical jobs path (ADR-064,
# LAI-LAMBDA-001 to 007): Django Admin's upload service stores a GLB as a DRAFT and commits its
# `asset.validate_model` job (media queue, transactional outbox); the jobs worker, exactly as
# packaged in its zip, runs the real GLB validator; Django applies the result
# (`services.apply_result`, as `jobs_consume_results` does) and moves the draft to VALIDATED or
# REJECTED; the publication gate and an explicit staff publish follow. See canonical_demo.py.
#
# Simulated: the SQS and S3 clients (in memory; the queue URLs below are placeholders and are
# never contacted) and the synthetic GLBs. Needs the compose PostgreSQL (`make up`,
# 127.0.0.1:5442). Uses its OWN database (default lai_processing_demo), never the shared
# development database, and a temporary asset directory. Nothing touches AWS.
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

QUEUES="https://sqs.us-west-1.amazonaws.com/123456789012"
export DJANGO_SETTINGS_MODULE=config.settings.local
export DATABASE_URL="postgres://$PGUSER:$PGPASSWORD_VALUE@127.0.0.1:$PGPORT/$DEMO_DB"
export LAI_JOBS_BACKEND=sqs
export LAI_JOBS_AI_QUEUE_URL="$QUEUES/lai-demo-jobs-ai"
export LAI_JOBS_MEDIA_QUEUE_URL="$QUEUES/lai-demo-jobs-media"
export LAI_JOBS_RESULTS_QUEUE_URL="$QUEUES/lai-demo-job-results"
export LAI_JOBS_RESULTS_BUCKET=lai-demo-results
export LAI_ASSET_STORAGE=local
export LAI_ASSET_DELIVERY=django
export LAI_ASSET_LOCAL_ROOT="$WORK/assets"
export LAI_ASSET_ASYNC_VALIDATION=on
export LAI_DEMO_ROOT="$ROOT"

printf '== 0. recreate the demo-only database %s and migrate\n' "$DEMO_DB"
PGPASSWORD="$PGPASSWORD_VALUE" "$PY" - "$DEMO_DB" "$PGUSER" "$PGPORT" <<'PYEOF'
import os, sys
import psycopg
name, user, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
if not name.startswith("lai_processing_demo"):
    raise SystemExit("refusing: the demo only recreates databases named lai_processing_demo*")
with psycopg.connect(host="127.0.0.1", port=port, user=user, dbname="postgres",
                     password=os.environ["PGPASSWORD"], autocommit=True) as conn:
    conn.execute(f'drop database if exists "{name}" with (force)')
    conn.execute(f'create database "{name}"')
PYEOF
(cd "$ROOT/lai" && "$PY" manage.py migrate --noinput -v 0)
(cd "$ROOT/lai" && "$PY" manage.py shell -v 0 -c "exec(open('$ROOT/scripts/processing/canonical_demo.py').read())")
printf '\nDemo complete. Work directory: %s %s\n' "$WORK" "$([ "$KEEP" = "--keep" ] && echo '(kept)' || echo '(removed)')"
