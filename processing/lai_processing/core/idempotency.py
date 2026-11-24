"""Idempotency keys: the stable identity of one logical piece of processing work.

The key answers "is this the same work?", not "is this the same message?". Two requests with
the same key must produce interchangeable results, so Django can reuse a finished job instead
of running it again, and a worker can recognise a redelivered request.

What goes into the key (and nothing else):
- the key format version (`v`), so the rule can change without colliding with old keys;
- `namespace` (environment), `job_type`, `subject` and `profile` (id and version);
- the input's identity: store, key, object version id, SHA-256, size and content type
  (or null for a job without an input);
- the request's processing `options`, normalised (sorted keys, lists instead of tuples);
- optionally the `processor_version`, when a caller wants a processor upgrade to count as new
  work.

What never goes into the key: job id, attempt id, attempt number, correlation id, timestamps
(submitted/expiry), and resource limits. Those describe one execution, not the work itself:
a retry, a redelivery or a re-submission with a different budget is the same logical work.

Options rule: requests carry fully RESOLVED options. Django resolves a staff choice with
`ProcessingProfile.resolve_options` (validating it and filling in profile defaults) before it
computes the key and builds the request. Equivalent requests (one that names a default
explicitly and one that leaves it out) therefore carry identical options and yield the same key.
The key function itself does not apply profile defaults: it hashes exactly what the request
carries, so the worker can verify the key without the profile catalog.

Format: `ik1:` followed by the lowercase hex SHA-256 of the canonical JSON of the fields above
(`core.canonical.canonical_json`), which matches `contracts.identifiers.IDEMPOTENCY_KEY`.
"""

from __future__ import annotations

import hmac
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Final

from ..contracts import _fields as f
from ..contracts.common import InputObject, ProfileRef, SubjectRef, check_namespace
from ..contracts.identifiers import SEMVER, check_object_key
from ..contracts.job_types import job_type_spec
from .canonical import canonical_json, sha256_hex
from .errors import ErrorCode, ProcessingError

if TYPE_CHECKING:
    from ..contracts.jobs import ProcessingJobRequest

__all__ = [
    "IDEMPOTENCY_KEY_VERSION",
    "idempotency_key",
    "idempotency_material",
    "request_idempotency_key",
    "verify_idempotency_key",
]

IDEMPOTENCY_KEY_VERSION: Final = "ik1"
_MATERIAL_VERSION: Final = 1


def _input_material(value: InputObject | None, namespace: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, InputObject):
        raise f.invalid("input")
    # Re-check the key against the namespace being hashed, so an input validated for another
    # environment can never share a key with this one.
    check_object_key(value.ref.key, value.ref.store, namespace, "input.ref.key")
    return {
        "store": value.ref.store.value,
        "key": value.ref.key,
        "version_id": value.ref.version_id,
        "sha256": value.sha256,
        "size_bytes": value.size_bytes,
        "content_type": value.content_type,
    }


def idempotency_material(
    *,
    namespace: str,
    job_type: str,
    subject: SubjectRef,
    profile: ProfileRef,
    input: InputObject | None,
    options: Mapping[str, Any],
    processor_version: str | None = None,
) -> dict[str, Any]:
    """The validated, normalised object whose canonical JSON is hashed into the key."""
    check_namespace(namespace)
    job_type_spec(job_type)
    if not isinstance(subject, SubjectRef):
        raise f.invalid("subject")
    if not isinstance(profile, ProfileRef):
        raise f.invalid("profile")
    if not isinstance(options, Mapping):
        raise f.invalid("options")
    if processor_version is not None:
        f.string(processor_version, "processor_version", SEMVER, max_length=32)
    return {
        "v": _MATERIAL_VERSION,
        "namespace": namespace,
        "job_type": job_type,
        "subject": subject.to_dict(),
        "profile": profile.to_dict(),
        "input": _input_material(input, namespace),
        "options": f.options_to_json(f.options(options)),
        "processor_version": processor_version,
    }


def idempotency_key(
    *,
    namespace: str,
    job_type: str,
    subject: SubjectRef,
    profile: ProfileRef,
    input: InputObject | None,
    options: Mapping[str, Any],
    processor_version: str | None = None,
) -> str:
    """`ik1:<sha256 hex>` of the logical work (see the module docstring for the rule).

    Raises `ProcessingError` (INVALID_INPUT, UNSUPPORTED_JOB_TYPE or INVALID_OBJECT_REFERENCE)
    when any part is not a valid contract value.
    """
    material = idempotency_material(
        namespace=namespace,
        job_type=job_type,
        subject=subject,
        profile=profile,
        input=input,
        options=options,
        processor_version=processor_version,
    )
    try:
        encoded = canonical_json(material)
    except (TypeError, ValueError):
        raise ProcessingError(ErrorCode.INVALID_INPUT, {"field": "options"}) from None
    return f"{IDEMPOTENCY_KEY_VERSION}:{sha256_hex(encoded)}"


def request_idempotency_key(
    request: ProcessingJobRequest, *, processor_version: str | None = None
) -> str:
    """The key `request` should carry, recomputed from its stable fields."""
    return idempotency_key(
        namespace=request.namespace,
        job_type=request.job_type,
        subject=request.subject,
        profile=request.profile,
        input=request.input,
        options=request.options,
        processor_version=processor_version,
    )


def verify_idempotency_key(
    request: ProcessingJobRequest, *, processor_version: str | None = None
) -> bool:
    """True when the request's `idempotency_key` matches its stable fields (constant time)."""
    expected = request_idempotency_key(request, processor_version=processor_version)
    return hmac.compare_digest(request.idempotency_key.encode(), expected.encode())
