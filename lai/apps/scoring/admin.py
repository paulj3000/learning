"""Django Admin for scoring (GE-102, GE-103). Deny by default, as the catalog admin is.

- Policies: staff edit DRAFT versions and their rules, activate a draft (which retires the
  previous active version), clone any version to a new draft, and retire. Frozen versions are
  read-only. Recording the owner's economy approval is superuser-only and never possible for a
  development fixture (a database constraint as well).
- The ledger and projections are child progress, so they are NOT registered: no child
  progress model is exposed on the admin (`game_sessions` isolation test). Staff inspect
  aggregates with the management commands, and a superuser records a compensating correction
  with `manage.py scoring_correct`, which needs a named superuser and a reason.
"""

from django.contrib import admin, messages

from apps.catalog.admin_access import AdminRole, can_view, resolve_admin_role

from . import policies
from .models import AwardRule, PolicyStatus, ScoringPolicy


def _is_superuser(request) -> bool:
    return resolve_admin_role(request) is AdminRole.SUPERUSER


class StaffOnlyAdmin(admin.ModelAdmin):
    def has_module_permission(self, request):
        return can_view(request)

    def has_view_permission(self, request, obj=None):
        return can_view(request)


class AwardRuleInline(admin.TabularInline):
    model = AwardRule
    extra = 0
    fields = (
        "rule_key",
        "source_kind",
        "selector",
        "attribute_equals",
        "currency",
        "amount",
        "stacking_group",
        "priority",
        "minimum_trust",
        "enabled",
        "suppress",
    )

    def _editable(self, obj):
        return obj is None or obj.status == PolicyStatus.DRAFT

    def has_view_permission(self, request, obj=None):
        return can_view(request)

    def has_add_permission(self, request, obj=None):
        return can_view(request) and self._editable(obj)

    def has_change_permission(self, request, obj=None):
        return can_view(request) and self._editable(obj)

    def has_delete_permission(self, request, obj=None):
        return can_view(request) and self._editable(obj)


@admin.register(ScoringPolicy)
class ScoringPolicyAdmin(StaffOnlyAdmin):
    list_display = (
        "key",
        "version",
        "status",
        "title",
        "is_development_fixture",
        "economy_approved_at",
        "activated_at",
    )
    list_filter = ("status", "key", "is_development_fixture")
    inlines = [AwardRuleInline]
    actions = ["activate_selected", "clone_selected", "retire_selected", "approve_selected"]
    readonly_fields = (
        "status",
        "economy_approved_at",
        "economy_approved_by",
        "created_at",
        "activated_at",
        "retired_at",
    )

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.is_frozen:
            return [f.name for f in self.model._meta.fields]
        return self.readonly_fields

    def has_add_permission(self, request):
        return can_view(request)

    def has_change_permission(self, request, obj=None):
        return can_view(request)

    def has_delete_permission(self, request, obj=None):
        return can_view(request) and (obj is None or obj.status == PolicyStatus.DRAFT)

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not _is_superuser(request):
            actions.pop("approve_selected", None)
        return actions

    def _each(self, request, queryset, operation, done: str):
        for policy in queryset.order_by("key", "version"):
            try:
                operation(policy)
            except (policies.PolicyError, Exception) as error:  # noqa: BLE001 - shown to staff
                self.message_user(request, f"{policy}: {error}", messages.ERROR)
            else:
                self.message_user(request, f"{policy}: {done}", messages.SUCCESS)

    @admin.action(description="Activate the selected draft (retires the current active version)")
    def activate_selected(self, request, queryset):
        self._each(request, queryset, policies.activate, "activated")

    @admin.action(description="Clone to a new draft version")
    def clone_selected(self, request, queryset):
        self._each(request, queryset, policies.clone_to_draft, "cloned")

    @admin.action(description="Retire the selected active version")
    def retire_selected(self, request, queryset):
        self._each(request, queryset, policies.retire, "retired")

    @admin.action(description="Record the owner's economy approval (superuser)")
    def approve_selected(self, request, queryset):
        if not _is_superuser(request):
            self.message_user(request, "Only a superuser can do that.", messages.ERROR)
            return
        self._each(
            request,
            queryset,
            lambda p: policies.record_economy_approval(p, request.user),
            "economy approval recorded",
        )
