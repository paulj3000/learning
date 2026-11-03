"""Challenge specs in Django Admin (ADR-047 B). Content only: no child record is registered.

Parameters are edited as content versions ("Edit content"); publication of the slot itself
stays a status the publish commands and region publishing check.
"""

from django.contrib import admin

from apps.catalog import admin_access
from apps.catalog.authoring_admin import AuthoredContentAdminMixin

from .models import ChallengeSpec


@admin.register(ChallengeSpec)
class ChallengeSpecAdmin(AuthoredContentAdminMixin, admin.ModelAdmin):
    list_display = ("slug", "age_band", "skill_id", "min_value", "max_value", "status")
    list_filter = ("age_band", "skill_id", "status")
    search_fields = ("slug", "title")
    readonly_fields = (
        "slug",
        "title",
        "age_band",
        "skill_id",
        "min_value",
        "max_value",
        "response_mode",
        "choice_count",
        "status",
        "authority",
        "updated_at",
    )
    fields = readonly_fields

    def has_module_permission(self, request):
        return admin_access.can_view(request)

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)

    def has_change_permission(self, request, obj=None):
        return False

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
