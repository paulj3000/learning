"""Project-wide Django Admin settings (LAI-0404, ADR-034).

One admin site: Django's default `admin.site`, mounted at `settings.ADMIN_URL_PATH`. Only active
staff accounts get in (`AdminSite.has_permission`); each ModelAdmin then decides what a staff
account or a superuser may do.
"""

from django.contrib import admin
from django.contrib.admin.forms import AdminAuthenticationForm
from django.contrib.auth.models import Group


class AdminLoginForm(AdminAuthenticationForm):
    """The standard admin login, labelled for the admin username rather than the Cognito sub."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["username"].label = "Admin username"


admin.site.site_header = "Learning Adventure Island administration"
admin.site.site_title = "Learning Adventure Island admin"
admin.site.index_title = "Content catalog and admin accounts"
admin.site.login_form = AdminLoginForm
# No "View site" link: the admin does not know which React origin a staff member uses.
admin.site.site_url = None

# Admin rights come from `is_staff` / `is_superuser`; `ParentAccount` has no group relations,
# so the Group admin auth registers would manage nothing.
if admin.site.is_registered(Group):
    admin.site.unregister(Group)
