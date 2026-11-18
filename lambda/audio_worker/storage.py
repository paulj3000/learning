"""Storage for the audio worker: read-only inputs plus ONE create-only artifact put.

Inputs come from the same read-only asset ports the jobs worker uses (`PortStorage`). Output
artifacts go through `ports.put_artifact(key, data, content_type, sha256)`.

TODO(Workstream A, ADR-066): `jobs_worker.aws` will provide the create-only artifact put (a
conditional `PutObject` with `If-None-Match: *` under `processing/artifacts/`, checksum verified,
idempotent for identical bytes). Until it lands, `AudioPorts.put_artifact` fails closed with
`artifact_storage_unavailable`. This module is the only adapter point: nothing else in the audio
worker writes to S3.
"""

from __future__ import annotations

import io

from jobs_worker import aws
from jobs_worker.vendor.jobs_core import contract
from jobs_worker.vendor.jobs_core.tasks import TaskError


class AudioPorts(aws.AssetPorts):
    """Asset read ports plus the artifact put seam."""

    def put_artifact(self, key: str, data: bytes, *, content_type: str, sha256: str):
        put = getattr(self._runtime, "put_artifact", None)  # provided by Workstream A
        if not callable(put):
            raise TaskError("artifact_storage_unavailable")
        return put(key, data, content_type=content_type, sha256=sha256)


class AudioStorage(contract.PortStorage):
    """`ObjectStorage` for the engine: reads delegate to `PortStorage`, `put` is create-only."""

    def put(self, ref, data, *, content_type: str, sha256: str, size_bytes: int):
        from lai_processing.contracts.identifiers import StoreName
        from lai_processing.core.canonical import sha256_hex
        from lai_processing.ports.storage import (
            ObjectInfo,
            StoragePermissionDenied,
            StorageUnavailable,
        )

        if ref.store is not StoreName.ARTIFACTS:
            raise StoragePermissionDenied({"store": ref.store.value})
        body = data.read() if isinstance(data, io.IOBase) or hasattr(data, "read") else bytes(data)
        if len(body) != size_bytes or sha256_hex(body) != sha256:
            raise StorageUnavailable({"reason": "checksum"})
        try:
            result = self._ports.put_artifact(
                ref.key, body, content_type=content_type, sha256=sha256
            )
        except TaskError as error:
            if error.code == "artifact_storage_unavailable":
                raise StoragePermissionDenied({"store": "artifacts"}) from None
            if error.code == "artifact_exists":
                from lai_processing.ports.storage import ObjectExists

                raise ObjectExists({"store": "artifacts"}) from None
            raise StorageUnavailable({"store": "artifacts"}) from None
        version = result if isinstance(result, str) else None
        return ObjectInfo(
            ref=ref,
            size_bytes=size_bytes,
            content_type=content_type,
            version_id=version,
            sha256=sha256,
        )
