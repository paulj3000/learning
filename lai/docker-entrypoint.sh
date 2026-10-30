#!/bin/sh
# Container entry point (LAI-0404): serves with gunicorn. Static files were collected when the
# image was built (lai/Dockerfile). Migrations are a separate one-off task, never run on start.
# Gunicorn writes no access log by default; keep it that way (request URLs carry child ids, and
# the application writes its own privacy-filtered request line, ADR-025, gate G10).
set -eu

# A one-off task (`docker compose run django python manage.py migrate`, an ECS command override)
# runs its own command; only a container started without one serves the application. Without this,
# every one-off task would start gunicorn instead and never finish (ADR-037).
if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --timeout "${GUNICORN_TIMEOUT:-30}" \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
