"""Admin accounts in Django Admin (LAI-0404, ADR-034). Superusers only.

Lists staff rows only (`AdminAccount`, rows with an `admin_username`), never parents, and never
child profiles: child data stays off Django Admin until an audited cross-family read path exists
(ADR-024 A4). Accounts are created by `manage.py create_admin_account`, not here, and are never
deleted here (a linked row is a parent's account). A superuser may switch `is_active`,
`is_staff` and `is_superuser`, which takes effect on the account's next request.
"""

from django.contrib import admin

from .models import AdminAccount


def _is_superuser(request) -> bool:
    user = request.user
    return bool(user.is_active and user.is_staff and user.is_superuser)


@admin.register(AdminAccount)
class AdminAccountAdmin(admin.ModelAdmin):
    list_display = ("admin_username", "is_active", "is_staff", "is_superuser", "last_login")
    list_filter = ("is_active", "is_staff", "is_superuser")
    search_fields = ("admin_username",)
    ordering = ("admin_username",)
    fields = ("admin_username", "is_active", "is_staff", "is_superuser", "last_login", "created_at")
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
