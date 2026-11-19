"""Background jobs in Django Admin: a read-only list for staff with `jobs.view_processingjob`.

Nothing is editable or deletable here. The one action, "Mark failed", needs
`jobs.fail_processingjob`: it fails a stuck job exactly as a timeout would (the kind's handler
runs, so a Studio batch waiting on it is finished). The payload is shown only to superusers,
since a Studio chunk's payload holds the full prompt.
"""

import json

from django.contrib import admin, messages
from django.utils.html import format_html

from . import services
from .models import ProcessingJob


def _perm(request, codename: str) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm(f"jobs.{codename}"))


@admin.register(ProcessingJob)
class ProcessingJobAdmin(admin.ModelAdmin):
    list_display = (
        "created_at",
        "kind",
        "status",
        "error_code",
        "attempts",
        "deliveries",
        "subject_type",
        "subject_id",
        "finished_at",
    )
    list_filter = ("status", "kind", "queue", "backend")
    search_fields = ("id", "subject_id")
    ordering = ("-created_at",)
    list_per_page = 50
    actions = ["mark_failed"]
    fields = (
        "id",
        "kind",
        "queue",
        "backend",
        "status",
        "error_code",
        "attempts",
        "deliveries",
        "subject_type",
        "subject_id",
        "submitted_by",
        "worker_function",
        "worker_request_id",
        "created_at",
        "started_at",
        "finished_at",
        "result_summary",
        "payload_view",
    )

    def has_module_permission(self, request):
        return _perm(request, "view_processingjob")

    def has_view_permission(self, request, obj=None):
        return _perm(request, "view_processingjob")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_fail_permission(self, request):
        return _perm(request, "fail_processingjob")

    def get_readonly_fields(self, request, obj=None):
        return self.get_fields(request, obj)

    @admin.display(description="Result")
    def result_summary(self, obj):
        if obj.result is None:
            return "-"
        shown = dict(obj.result)
        if isinstance(shown.get("items"), list):  # model output stays in the Studio's drafts
            shown["items"] = f"{len(shown['items'])} item(s)"
        return format_html("<pre>{}</pre>", json.dumps(shown, indent=2, sort_keys=True)[:20000])

    @admin.display(description="Payload")
    def payload_view(self, obj):
        return format_html("<pre>{}</pre>", json.dumps(obj.payload, indent=2, sort_keys=True))

    def get_fields(self, request, obj=None):
        if request.user.is_superuser:
            return self.fields
        return tuple(name for name in self.fields if name != "payload_view")

    @admin.action(description="Mark selected unfinished jobs failed", permissions=["fail"])
    def mark_failed(self, request, queryset):
        failed = sum(
            1
            for job_id in queryset.values_list("pk", flat=True)
            if services.fail_job(job_id, "marked_failed")
        )
        self.message_user(request, f"Marked {failed} job(s) failed.", messages.SUCCESS)
