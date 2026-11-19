"""Seasonal events in Django Admin (NP-023). Content only.

`SeasonalCompletion` is child-owned and deliberately not registered (no child record is exposed
in Admin; see `apps/core/tests/test_django_admin.py`).
"""

from django.contrib import admin, messages

from .models import SeasonalEvent


@admin.register(SeasonalEvent)
class SeasonalEventAdmin(admin.ModelAdmin):
    list_display = (
        "slug",
        "title",
        "theme",
        "availability",
        "window_start_month",
        "window_start_day",
        "window_end_month",
        "window_end_day",
        "featured_in_window",
        "active",
    )
    list_filter = ("theme", "availability", "active", "featured_in_window")
    search_fields = ("slug", "title", "description")
    filter_horizontal = ("realms", "places", "reward_items")
    readonly_fields = ("created_at", "updated_at")
    actions = ("activate", "deactivate")

    @admin.action(description="Activate selected events")
    def activate(self, request, queryset):
        count = queryset.update(active=True)
        self.message_user(request, f"Activated {count} event(s).", messages.SUCCESS)

    @admin.action(description="Deactivate selected events (their Places show year round)")
    def deactivate(self, request, queryset):
        count = queryset.update(active=False)
        self.message_user(request, f"Deactivated {count} event(s).", messages.SUCCESS)
