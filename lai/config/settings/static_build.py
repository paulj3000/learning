"""Settings for `collectstatic` while building the image (LAI-0404). Never used to serve.

Collecting at build time needs no database and no deployment secrets, and gives every
container from one image the same hashed file names as the copy uploaded to S3.
"""

from .base import *  # noqa: F403
from .base import MANIFEST_STATIC_STORAGES

DEBUG = False
SECRET_KEY = "static-build-only-not-a-secret"  # noqa: S105
ALLOWED_HOSTS: list[str] = []
DATABASES: dict = {}
STORAGES = MANIFEST_STATIC_STORAGES
