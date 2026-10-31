"""Admin accounts in Django Admin (LAI-0404, ADR-034). Superusers only.

`AdminAccount` lists staff rows only (rows with an `admin_username`). Parents and their child
profiles are a separate, read-only and audited inspection view (`ParentRecord`, `ChildProfile`;
LAI-CHILD-001, ADR-039), described at `ParentRecordAdmin` below. No gameplay or other
child-owned record is registered. Accounts are created by `manage.py create_admin_account`, not
here, and are never deleted here (a linked row is a parent's account). A superuser may switch
`is_active`, `is_staff`, `is_superuser` and group membership (the asset roles, ADR-035), which
takes effect on the account's next request. The last active superuser cannot be demoted or
deactivated here (or with `set_admin_role`).
"""

import logging

from django import forms
from django.contrib import admin

from .models import AdminAccount, ChildProfile, ParentAccount, ParentRecord

audit_logger = logging.getLogger("lai.admin_audit")


def _is_superuser(request) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.is_superuser)


class AdminAccountForm(forms.ModelForm):
    class Meta:
        model = AdminAccount
        fields = ("is_active", "is_staff", "is_superuser", "groups")

    def clean(self):
        cleaned = super().clean()
        # `self.instance` still holds the saved values here; the form copies onto it after clean().
        keeps_full_rights = all(
            cleaned.get(name) for name in ("is_active", "is_staff", "is_superuser")
        )
        if self.instance.is_superuser and not keeps_full_rights:
            others = ParentAccount.objects.filter(is_superuser=True, is_staff=True, is_active=True)
            if not others.exclude(pk=self.instance.pk).exists():
                raise forms.ValidationError(
                    "This is the last active superuser. Make another superuser first."
                )
        if cleaned.get("is_superuser") and not cleaned.get("is_staff"):
            raise forms.ValidationError("A superuser must also be staff.")
        return cleaned


@admin.register(AdminAccount)
class AdminAccountAdmin(admin.ModelAdmin):
    form = AdminAccountForm
    list_display = ("admin_username", "is_active", "is_staff", "is_superuser", "last_login")
    list_filter = ("is_active", "is_staff", "is_superuser")
    search_fields = ("admin_username",)
    ordering = ("admin_username",)
    fields = (
        "admin_username",
        "is_active",
        "is_staff",
        "is_superuser",
        "groups",
        "last_login",
        "created_at",
    )
    filter_horizontal = ("groups",)
    readonly_fields = ("admin_username", "last_login", "created_at")

    def get_queryset(self, request):
        return super().get_queryset(request).filter(admin_username__isnull=False)

    def has_module_permission(self, request):
        return _is_superuser(request)

    def has_view_permission(self, request, obj=None):
        return _is_superuser(request)

    def has_change_permission(self, request, obj=None):
        return _is_superuser(request)

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


def _may_inspect_profiles(request) -> bool:
    """Active staff holding `users.view_childprofile` (superusers hold every permission)."""
    user = request.user
    return bool(user.is_active and user.is_staff and user.has_perm("users.view_childprofile"))


class _AuditedReadOnlyAdmin(admin.ModelAdmin):
    """Read-only, permission-gated and audited (ADR-039).

    Nothing can be added, changed or deleted here: a parent's own app and the API are the only
    writers, through the ownership-checked services. Each list and detail view logs one line with
    the staff account id and the record id, never a nickname, interest or Cognito sub.
    """

    actions = None

    def has_module_permission(self, request):
        return _may_inspect_profiles(request)

    def has_view_permission(self, request, obj=None):
        return _may_inspect_profiles(request)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context)
        if _may_inspect_profiles(request):
            self._audit(request, "list", None)
        return response

    def change_view(self, request, object_id, form_url="", extra_context=None):
        response = super().change_view(request, object_id, form_url, extra_context)
        if _may_inspect_profiles(request):
            self._audit(request, "view", object_id)
        return response

    def _audit(self, request, action, object_id):
        audit_logger.info(
            "admin_profile_read model=%s action=%s staff=%s record=%s",
            self.model._meta.model_name,
            action,
            request.user.pk,
            object_id or "-",
        )


class ChildProfileInline(admin.TabularInline):
    model = ChildProfile
    fields = ("id", "age_band", "reading_mode", "session_minutes", "active", "ai_enabled")
    readonly_fields = fields
    extra = 0
    can_delete = False
    show_change_link = True

    def has_view_permission(self, request, obj=None):
        return _may_inspect_profiles(request)

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ParentRecord)
class ParentRecordAdmin(_AuditedReadOnlyAdmin):
    """Parent accounts and the children each one owns (LAI-CHILD-001, ADR-039).

    For support: "which children does this account own, and are they active". Parent rows only
    (staff rows are `AdminAccount`). Shown: ids, display name, time zone, activation and
    timestamps. Never shown: the Cognito sub or local username (the identity mapping), the
    password hash, a child's nickname, interests or photo path.
    """

    list_display = ("id", "display_name", "is_active", "child_count", "created_at")
    list_filter = ("is_active",)
    search_fields = ("=id",)
    ordering = ("-created_at",)
    fields = ("id", "display_name", "timezone", "is_active", "created_at", "updated_at")
    readonly_fields = fields
    inlines = (ChildProfileInline,)

    def get_queryset(self, request):
        return super().get_queryset(request).filter(admin_username__isnull=True)

    @admin.display(description="children")
    def child_count(self, obj):
        return obj.child_profiles.count()


@admin.register(ChildProfile)
class ChildProfileAdmin(_AuditedReadOnlyAdmin):
    """Child profiles, read-only, with their owning parent's id (ADR-039). No nickname."""

    list_display = ("id", "parent_id", "age_band", "active", "ai_enabled", "created_at")
    list_filter = ("age_band", "active", "ai_enabled")
    search_fields = ("=id", "=parent__id")
    ordering = ("-created_at",)
    fields = (
        "id",
        "parent_id",
        "age_band",
        "reading_mode",
        "session_minutes",
        "active",
        "ai_enabled",
        "has_photo",
        "created_at",
        "updated_at",
    )
    readonly_fields = fields

    @admin.display(boolean=True, description="photo")
    def has_photo(self, obj):
        return bool(obj.avatar_photo_key)
