# Django API and Django Admin container (LAI-0404, ADR-034). Build from the repository root:
#   docker build -f lai/Dockerfile -t lai-django .
# Hosting, environment variables and the one-off tasks (migrate, create_admin_account) are in
# docs/platform/DJANGO_EC2_DEPLOYMENT.md (EC2 releases, ADR-037) and
# docs/DJANGO_TARGET_ARCHITECTURE.md, "Django Admin hosting". No secret is baked into the image:
# every sensitive value arrives as an environment variable at run time (Secrets Manager).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=config.settings.production \
    AUTH_PROVIDER=cognito

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# The app and the content export `manage.py load_content` reads (settings.CONTENT_DIR).
COPY lai/ ./lai/
COPY content/ ./content/
# The bundled models (about 3 MB), so `manage.py import_assets --from-bundled` can run as a one-off
# task in this image (docs/ASSET_MANAGER.md section 19). Read only by that command; gameplay gets
# models from the asset store (S3 in production), never from the image.
COPY react/public/models/ ./react/public/models/

WORKDIR /app/lai
# Admin static files with hashed names, collected once per image (no database, no secrets). The
# same directory is uploaded to the admin's S3 bucket by scripts/release-admin-static.sh.
RUN DJANGO_SETTINGS_MODULE=config.settings.static_build python manage.py collectstatic --noinput

# The EC2 deploy bundle (ADR-037): the release scripts and the production compose file travel with
# the image, so the instance runs the release logic that matches the image it deploys and needs no
# source checkout. Read only by the SSM deploy document on the host; never run inside a container.
COPY scripts/aws/ /app/deploy/scripts/aws/
COPY deploy/ec2/ /app/deploy/deploy/ec2/

RUN useradd --system --uid 10001 --home-dir /app lai
USER lai

# Release identity, last so a new commit reuses every cached layer above. The release pipeline
# (.github/workflows/deploy-django-ec2.yml) sets both; deploy-django.sh refuses an image whose
# revision is not the requested commit or whose channel is not `release` (a local build).
ARG LAI_GIT_SHA=unknown
ARG LAI_RELEASE_CHANNEL=local
LABEL org.opencontainers.image.revision=$LAI_GIT_SHA \
      org.opencontainers.image.title="learning-adventure-island-django" \
      org.learning-adventure-island.release-channel=$LAI_RELEASE_CHANNEL

EXPOSE 8000
# Sends a host name ALLOWED_HOSTS accepts: production settings answer a bare 127.0.0.1 with 400.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request as u; h = os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost').split(',')[0].strip(); u.urlopen(u.Request('http://127.0.0.1:8000/api/v1/health/', headers={'Host': h}), timeout=4)"
ENTRYPOINT ["./docker-entrypoint.sh"]
