"""Speech's background job handler (`speech.synthesize`, shared clips only; apps.jobs).

`apply(job)` records the clip the media worker stored, with the same row and daily counters the
synchronous `prepare_shared_clip` writes, once (a duplicate or late result changes nothing).
`inline_ports(job)` runs the worker's task code in this process with the configured Polly client
and speech store. Logs codes only, never text.
"""

import logging

from django.db import DatabaseError

from apps.jobs.core.tasks import TaskError

from . import services
from .polly import SpeechError, get_polly_client
from .storage import SpeechStorageError, get_speech_storage

logger = logging.getLogger("lai.speech")

#: Polly failure reasons worth another try (the worker raises them back to SQS).
_TRANSIENT = frozenset({"throttled", "service", "timeout", "connection", "busy"})


def apply(job) -> None:
    if job.status != "completed":
        logger.warning("speech job failed id=%s code=%s", job.pk, job.error_code)
        try:
            services.count_shared_clip_failure()
        except DatabaseError:
            logger.exception("could not count a speech job failure")
        return
    try:
        recorded = services.record_shared_clip_job(job.payload, job.result or {})
    except SpeechStorageError:
        logger.warning("speech job result refused id=%s", job.pk)
        return
    logger.info("speech job applied id=%s recorded=%s", job.pk, recorded)


class InlinePorts:
    def speech_object_size(self, key: str) -> int | None:
        try:
            return len(get_speech_storage().read(key))
        except SpeechStorageError:
            return None

    def synthesize(self, *, region: str | None = None, **request) -> bytes:
        # In process, Django's own Polly client already uses LAI_SPEECH_AWS_REGION.
        try:
            return get_polly_client().synthesize(**request)
        except SpeechError as error:
            code = (error.reason or error.code).replace("-", "_")[:64]
            raise TaskError(code, retryable=error.reason in _TRANSIENT) from None

    def put_speech(self, key: str, data: bytes) -> None:
        try:
            get_speech_storage().put(key, data)
        except SpeechStorageError:
            raise TaskError("storage", retryable=True) from None


def inline_ports(job) -> InlinePorts:
    return InlinePorts()
