"""Versioned job contracts: requests, results, artifacts, completion events, profiles."""

from .artifacts import ArtifactReference
from .codec import (
    DEFAULT_MAX_MESSAGE_BYTES,
    Message,
    decode,
    decode_event,
    decode_request,
    decode_result,
    encode,
    load_json,
)
from .common import (
    SCHEMA_VERSION,
    SUPPORTED_SCHEMA_VERSIONS,
    AssetContext,
    InputObject,
    MessageKind,
    ObjectRef,
    ProcessorIdentity,
    ProfileRef,
    SubjectRef,
)
from .events import (
    RESULT_ARTIFACT_TYPE,
    RESULT_LOGICAL_ID,
    CompletionEvent,
    build_completion_event,
    result_digest,
)
from .identifiers import StoreName, artifact_key, artifact_prefix, check_object_key
from .job_types import JOB_TYPES, JobTypeSpec, job_type_spec
from .jobs import ProcessingJobRequest
from .profiles import OptionSpec, ProcessingProfile
from .results import (
    Finding,
    InputIdentity,
    JobError,
    ProcessingJobResult,
    ProcessingWarning,
    ResultStatus,
    Severity,
    Verdict,
)

__all__ = [
    "DEFAULT_MAX_MESSAGE_BYTES",
    "JOB_TYPES",
    "RESULT_ARTIFACT_TYPE",
    "RESULT_LOGICAL_ID",
    "SCHEMA_VERSION",
    "SUPPORTED_SCHEMA_VERSIONS",
    "ArtifactReference",
    "AssetContext",
    "CompletionEvent",
    "Finding",
    "InputIdentity",
    "InputObject",
    "JobError",
    "JobTypeSpec",
    "Message",
    "MessageKind",
    "ObjectRef",
    "OptionSpec",
    "ProcessingJobRequest",
    "ProcessingJobResult",
    "ProcessingProfile",
    "ProcessingWarning",
    "ProcessorIdentity",
    "ProfileRef",
    "ResultStatus",
    "Severity",
    "StoreName",
    "SubjectRef",
    "Verdict",
    "artifact_key",
    "artifact_prefix",
    "build_completion_event",
    "check_object_key",
    "decode",
    "decode_event",
    "decode_request",
    "decode_result",
    "encode",
    "job_type_spec",
    "load_json",
    "result_digest",
]
