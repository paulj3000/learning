#!/bin/sh
# Container entry point (LAI-0404). Collects the admin's static files (production settings need
# the deployment's environment, so this cannot run at image build time), then serves with
# gunicorn. Migrations are a separate one-off task, never run on every start.
# Gunicorn writes no access log by default; keep it that way (request URLs carry child ids, and
# the application writes its own privacy-filtered request line, ADR-025, gate G10).
set -eu

python manage.py collectstatic --noinput --verbosity 0

exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --timeout "${GUNICORN_TIMEOUT:-30}" \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
