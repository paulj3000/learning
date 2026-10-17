"""Root URL configuration.

API versioning: every route lives under `/api/v1/` and each app contributes one include.
Additive changes (new endpoints, new optional fields) stay in v1. A breaking change gets a new
prefix (`/api/v2/`) mounted beside v1, with v1 kept until clients move. There is no v2 yet.
"""

from django.urls import include, path

urlpatterns = [
    path("api/v1/", include("apps.core.urls")),
]

handler400 = "apps.core.exceptions.bad_request"
handler403 = "apps.core.exceptions.permission_denied"
handler404 = "apps.core.exceptions.not_found"
handler500 = "apps.core.exceptions.server_error"
