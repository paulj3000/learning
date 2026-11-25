"""A derived-artifact row written straight to the database, for usage-provider tests (no AWS)."""

import hashlib
import uuid
from datetime import timedelta

from django.utils.timezone import now

from apps.assets.models import ArtifactProducer, ArtifactState, DerivedArtifact

_PROTECTED = (ArtifactState.ACCEPTED, ArtifactState.PROMOTED)


def make_artifact(version, *, state=ArtifactState.PENDING_REVIEW, promoted_version=None, **fields):
    """A staff-capture artifact (no job needed) of `version` in `state`."""
    token = uuid.uuid4().hex
    stamp = now()
    values = {
        "source_version": version,
        "asset": version.asset,
        "source_sha256": version.sha256,
        "source_storage_key": version.storage_key,
        "logical_id": fields.pop("logical_id", "meshopt"),
        "role": "model.optimized",
        "producer": ArtifactProducer.STAFF_CAPTURE,
        "sha256": hashlib.sha256(token.encode()).hexdigest(),
        "size_bytes": 10,
        "content_type": "model/gltf-binary",
        "storage_key": f"processing/artifacts/{token}/model.glb",
        "state": state,
        "reviewed_at": stamp if state in (ArtifactState.ACCEPTED, ArtifactState.REJECTED) else None,
        "superseded_at": stamp if state == ArtifactState.SUPERSEDED else None,
        "object_deleted_at": stamp if state == ArtifactState.DELETED else None,
        "promoted_version": promoted_version if state == ArtifactState.PROMOTED else None,
        "expires_at": None if state in _PROTECTED else stamp + timedelta(days=30),
    }
    values.update(fields)
    return DerivedArtifact.objects.create(**values)
