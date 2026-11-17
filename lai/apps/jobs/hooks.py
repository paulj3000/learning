"""The completion hook registry (WAVE3_INTERFACES section 3).

Kept free of `lai_processing` imports so an app can register its hook from `AppConfig.ready()`
without loading the processing contracts at Django start-up (`manage.py check` and
`makemigrations --check` run without `processing/` on the path). `apps.jobs.processing` runs the
hooks and re-exports these names.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Callable, Mapping
from typing import Any

from django.core.exceptions import ImproperlyConfigured

from .models import CONTRACT_KINDS


@dataclasses.dataclass(frozen=True, slots=True)
class HookResult:
    """What a completion hook did. `code` is a safe outcome code stored on the job
    (`subject_outcome`); `review_ready` moves a VALIDATED job to READY_FOR_REVIEW."""

    code: str
    review_ready: bool = False


#: `hook(job, attempt, result) -> HookResult`, called inside the completion transaction, under the
#: job row lock, after an APPLY has been recorded. A hook may lock rows of its own app (always
#: after the job row: lock order job -> subject rows). It must not publish anything.
#: Arguments: the locked `ProcessingJob`, its `JobAttempt` and the decoded `ProcessingJobResult`.
#: A hook must not change the job object (`apps.jobs.processing` owns it).
CompletionHook = Callable[[Any, Any, Any], HookResult]
_COMPLETION_HOOKS: dict[tuple[str, str], CompletionHook] = {}


def register_completion_hook(job_type: str, subject_type: str, hook: CompletionHook) -> None:
    """Register the hook for one (contract kind, subject type) pair, from an `AppConfig.ready()`.

    Explicit and deterministic: no discovery or dynamic import. Registering the same callable
    again is a no-op (a second `ready()`); a different callable for a registered pair is a
    configuration error, never a silent replacement."""
    if job_type not in CONTRACT_KINDS:
        raise ImproperlyConfigured(f"No contract kind {job_type!r} for a completion hook.")
    if not subject_type or len(subject_type) > 64:
        raise ImproperlyConfigured("A completion hook needs a subject type of 64 or fewer.")
    key = (job_type, subject_type)
    current = _COMPLETION_HOOKS.get(key)
    if current is not None and current is not hook:
        raise ImproperlyConfigured(f"Another completion hook is registered for {key!r}.")
    _COMPLETION_HOOKS[key] = hook


def completion_hook(job_type: str, subject_type: str) -> CompletionHook | None:
    return _COMPLETION_HOOKS.get((job_type, subject_type))


def set_completion_hooks_for_tests(
    hooks: Mapping[tuple[str, str], CompletionHook] | None,
) -> dict[tuple[str, str], CompletionHook]:
    """Replace the registered hooks (None: none); returns the previous ones for restoring."""
    previous = dict(_COMPLETION_HOOKS)
    _COMPLETION_HOOKS.clear()
    _COMPLETION_HOOKS.update(hooks or {})
    return previous
