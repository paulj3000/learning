#!/bin/sh
# Container entry point (LAI-0404): serves with gunicorn. Static files were collected when the
# image was built (lai/Dockerfile). Migrations are a separate one-off task, never run on start.
# Gunicorn writes no access log by default; keep it that way (request URLs carry child ids, and
# the application writes its own privacy-filtered request line, ADR-025, gate G10).
set -eu

exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${WEB_CONCURRENCY:-2}" \
    --timeout "${GUNICORN_TIMEOUT:-30}" \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}"
