"""Django Admin for scoring (GE-102, GE-103). Deny by default, as the catalog admin is.

- Policies: staff edit DRAFT versions and their rules, activate a draft (which retires the
  previous active version), clone any version to a new draft, and retire. Frozen versions are
  read-only. Recording the owner's economy approval is superuser-only and never possible for a
  development fixture (a database constraint as well).
- Ledger: read-only for staff. Nothing is added, changed or deleted here. A superuser can post
  a compensating correction (with a reason) that reverses selected awards; the original stays.
- No child data is shown beyond the opaque child id.
"""

from django import forms
from django.contrib import admin, messages
from django.template.response import TemplateResponse

from apps.catalog.admin_access import AdminRole, can_view, resolve_admin_role

from . import ledger, policies
from .contracts import EntryKind
from .models import AwardLedgerEntry, AwardRule, PolicyStatus, ProgressionProjection, ScoringPolicy


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


class CorrectionForm(forms.Form):
    reason = forms.CharField(
        max_length=300,
        help_text="Why (a defect, a mis-set value). Staff text only: no child names or details.",
    )


@admin.register(AwardLedgerEntry)
class AwardLedgerEntryAdmin(StaffOnlyAdmin):
    list_display = (
        "recorded_at",
        "entry_kind",
        "currency",
        "amount",
        "source_kind",
        "source_ref",
        "scope_key",
        "policy_version",
        "trust",
    )
    list_filter = ("entry_kind", "currency", "source_kind", "policy_version")
    search_fields = ("source_ref", "scope_key", "=child__id")
    actions = ["reverse_selected"]

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not _is_superuser(request):
            actions.pop("reverse_selected", None)
        return actions

    @admin.action(description="Reverse the selected awards with a correction (superuser)")
    def reverse_selected(self, request, queryset):
        if not _is_superuser(request):
            self.message_user(request, "Only a superuser can do that.", messages.ERROR)
            return None
        awards = queryset.filter(entry_kind=EntryKind.AWARD)
        form = CorrectionForm(request.POST if "apply" in request.POST else None)
        if form.is_valid():
            done = 0
            for entry in awards:
                remaining = entry.amount + sum(c.amount for c in entry.corrections.all())
                if remaining <= 0:
                    continue
                try:
                    ledger.record_correction(
                        entry, -remaining, form.cleaned_data["reason"], request.user
                    )
                except ledger.CorrectionRefused as error:
                    self.message_user(request, f"{entry.pk}: {error}", messages.ERROR)
                else:
                    done += 1
            self.message_user(request, f"{done} correction(s) recorded.", messages.SUCCESS)
            return None
        return TemplateResponse(
            request,
            "admin/scoring/awardledgerentry/reverse.html",
            {
                **self.admin_site.each_context(request),
                "title": "Reverse awards with a correction",
                "entries": awards,
                "form": form,
                "action": "reverse_selected",
                "opts": self.model._meta,
            },
        )


@admin.register(ProgressionProjection)
class ProgressionProjectionAdmin(StaffOnlyAdmin):
    list_display = ("id", "xp", "learning_points", "coins", "stars", "entry_count", "last_entry_at")

    def get_readonly_fields(self, request, obj=None):
        return [f.name for f in self.model._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
