"""`reference.checksum` (ADR-061 reference processor on the canonical path, ADR-064).

A contract kind used to prove the path end to end: the worker verifies an asset object's
checksum and size and returns deterministic metadata. Its result is kept on the job only."""

import logging

logger = logging.getLogger("lai.jobs")


def apply(job) -> None:
    logger.info(
        "jobs.reference finished id=%s status=%s code=%s", job.pk, job.status, job.error_code or "-"
    )


def inline_ports(job):
    from apps.assets.jobs import InlinePorts

    return InlinePorts()
