"""Root URL configuration.

API versioning: every route lives under `/api/v1/` and each app contributes one include.
Additive changes (new endpoints, new optional fields) stay in v1. A breaking change gets a new
prefix (`/api/v2/`) mounted beside v1, with v1 kept until clients move. There is no v2 yet.

Django Admin (LAI-0404, ADR-034) is the one route outside `/api/`, at `settings.ADMIN_URL_PATH`,
besides `/favicon.ico`: browsers request it on any page Django serves without an icon link
(error pages, a JSON response opened in a tab), so it points at the Admin's static icon.
"""

from django.conf import settings
from django.contrib import admin
from django.http import HttpResponseRedirect
from django.templatetags.static import static
from django.urls import include, path

SITE_ICON = "core/favicon.svg"


def favicon(request):
    """Redirects to the site icon's static URL (hashed in production), never a 404."""
    return HttpResponseRedirect(static(SITE_ICON))


urlpatterns = [
    path("api/v1/", include("apps.core.urls")),
    path("api/v1/", include("apps.users.urls")),
    path("api/v1/", include("apps.game_sessions.urls")),
    path("api/v1/", include("apps.assets.urls")),
    path("api/v1/", include("apps.audio.urls")),
    path("api/v1/", include("apps.speech.urls")),
    path("api/v1/", include("apps.ai.urls")),
    path("api/v1/", include("apps.npcs.urls")),
    path(settings.ADMIN_URL_PATH, admin.site.urls),
    path("favicon.ico", favicon, name="favicon"),
]

handler400 = "apps.core.exceptions.bad_request"
handler403 = "apps.core.exceptions.permission_denied"
handler404 = "apps.core.exceptions.not_found"
handler500 = "apps.core.exceptions.server_error"
