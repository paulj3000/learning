"""Derived-artifact results (ADR-066): the handler of the audio, image and optimize kinds.

Placeholder committed with the interface freeze; replaced by the full verification in the next
step of LAI-LAMBDA-014. See docs/processing/DERIVED_ARTIFACTS.md section 7.
"""


def apply(job) -> None:
    job.subject_outcome = "result_recorded"
    job.save(update_fields=["subject_outcome"])


def inline_ports(job):
    return None
