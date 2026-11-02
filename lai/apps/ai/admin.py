"""Staff inspection of AI activity (LAI-0707, ADR-044 item 9).

The one sanctioned exception to "no child-owned record in Django Admin" besides the ADR-039
profile view, and built the same way:

* gated by Django permissions, never by `is_staff` alone: `ai.view_aiinteractionaudit` and
  `ai.view_safetyevent` to read, `ai.change_safetyevent` to set a safety event's review status;
* read-only otherwise: nothing can be added or deleted here, and no audit field can change;
* metadata only: rows show the child's UUID, never a nickname, interest or parent; there is no
  text to show, because none is stored;
* every list, detail and change logs one `lai.admin_audit` line with the staff id and record id.

Retention deletes happen only through `manage.py ai_retention`, never from these pages.
"""

import logging

from django.contrib import admin

from .models import AIInteractionAudit, AIServiceControl, SafetyEvent

audit_logger = logging.getLogger("lai.admin_audit")


def _may(request, codename: str) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm(f"ai.{codename}"))


class _AuditedAIAdmin(admin.ModelAdmin):
    view_codename = ""
    actions = None
    list_per_page = 50
    show_full_result_count = False

    def has_module_permission(self, request):
        return _may(request, self.view_codename)

    def has_view_permission(self, request, obj=None):
        return _may(request, self.view_codename)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context)
        if _may(request, self.view_codename):
            self._audit(request, "list", None)
        return response

    def change_view(self, request, object_id, form_url="", extra_context=None):
        response = super().change_view(request, object_id, form_url, extra_context)
        if _may(request, self.view_codename):
            action = "change" if request.method == "POST" else "view"
            self._audit(request, action, object_id)
        return response

    def _audit(self, request, action, object_id):
        audit_logger.info(
            "admin_ai_read model=%s action=%s staff=%s record=%s",
            self.model._meta.model_name,
            action,
            request.user.pk,
            object_id or "-",
        )


@admin.register(AIInteractionAudit)
class AIInteractionAuditAdmin(_AuditedAIAdmin):
    view_codename = "view_aiinteractionaudit"
    list_display = (
        "created_at",
        "route_name",
        "validation_status",
        "safety_disposition",
        "fallback_used",
        "provider",
        "failure_category",
        "latency_ms",
        "input_tokens",
        "output_tokens",
    )
    list_filter = (
        "route_name",
        "validation_status",
        "safety_disposition",
        "provider",
        "model_id",
        "failure_category",
        "guardrail_action",
        "context_source",
        ("created_at", admin.DateFieldListFilter),
    )
    date_hierarchy = "created_at"
    search_fields = ("=request_id", "=child__id")
    ordering = ("-created_at",)
    fields = (
        "id",
        "child_id",
        "created_at",
        "route_name",
        "prompt_template_version",
        "model_id",
        "provider",
        "input_category",
        "output_schema_version",
        "context_source",
        "validation_status",
        "safety_disposition",
        "fallback_used",
        "failure_category",
        "guardrail_id",
        "guardrail_version",
        "guardrail_action",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "session_id",
        "step_id",
        "request_id",
    )
    readonly_fields = fields


@admin.register(SafetyEvent)
class SafetyEventAdmin(_AuditedAIAdmin):
    view_codename = "view_safetyevent"
    list_display = ("created_at", "category", "severity", "source", "review_status", "route_name")
    list_filter = (
        "review_status",
        "severity",
        "source",
        "route_name",
        ("created_at", admin.DateFieldListFilter),
    )
    date_hierarchy = "created_at"
    search_fields = ("=request_id", "=child__id", "category")
    ordering = ("-created_at",)
    fields = (
        "id",
        "child_id",
        "created_at",
        "route_name",
        "category",
        "severity",
        "source",
        "action_taken",
        "audit_id",
        "request_id",
        "review_status",
    )
    # Review status is the one field staff may change (review scaffolding).
    readonly_fields = tuple(f for f in fields if f != "review_status")

    def has_change_permission(self, request, obj=None):
        return _may(request, "change_safetyevent")


@admin.register(AIServiceControl)
class AIServiceControlAdmin(admin.ModelAdmin):
    """The runtime kill switch (LAI-0708). Superusers only; every change is logged."""

    fields = ("model_calls_enabled", "reason", "updated_at")
    readonly_fields = ("updated_at",)
    actions = None

    def _superuser(self, request) -> bool:
        user = request.user
        return bool(user.is_active and user.is_staff and user.is_superuser)

    def has_module_permission(self, request):
        return self._superuser(request)

    def has_view_permission(self, request, obj=None):
        return self._superuser(request)

    def has_change_permission(self, request, obj=None):
        return self._superuser(request)

    def has_add_permission(self, request):
        return self._superuser(request) and not AIServiceControl.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        from .services.usage import clear_control_cache

        obj.pk = 1
        super().save_model(request, obj, form, change)
        clear_control_cache()
        audit_logger.info(
            "admin_ai_control model_calls_enabled=%s staff=%s",
            obj.model_calls_enabled,
            request.user.pk,
        )
