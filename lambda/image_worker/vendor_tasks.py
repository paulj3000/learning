"""The canonical jobs plumbing, imported (never forked) from `jobs_worker`'s vendored core."""

from jobs_worker.vendor.jobs_core import envelope, tasks
from jobs_worker.vendor.jobs_core.tasks import TaskError

__all__ = ["TaskError", "envelope", "tasks"]
