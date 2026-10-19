"""Django error-report filter (LAI-0208). Kept apart from `privacy.py` so the logging setup does not
import `django.views.debug` while Django is still starting."""

from django.views.debug import SafeExceptionReporterFilter

from .privacy import raw_exceptions_enabled


class PrivacyExceptionReporterFilter(SafeExceptionReporterFilter):
    """Hides every local variable on debug pages and error reports.

    Django's own filter already cleanses settings, POST data, and credential-looking headers and
    honours `@sensitive_variables`; this goes further because a local variable or a cookie value
    can hold anything.
    """

    def get_traceback_frame_variables(self, request, tb_frame):
        if raw_exceptions_enabled():
            return super().get_traceback_frame_variables(request, tb_frame)
        return [(name, self.cleansed_substitute) for name in tb_frame.f_locals]

    def get_safe_cookies(self, request):
        # Django only masks cookies whose *name* looks secret; a cookie value can be anything.
        if not hasattr(request, "COOKIES"):
            return {}
        return {name: self.cleansed_substitute for name in request.COOKIES}
