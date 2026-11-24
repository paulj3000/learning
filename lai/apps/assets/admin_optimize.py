"""GLB optimization actions on the Asset Library version admin (LAI-LAMBDA-010, ADR-070).

Mixed into `AssetVersionAdmin` cooperatively (like the image and capture mixins): it adds the
actions "Optimize (Meshopt)" and "Optimize (KTX2)" for staff who may upload and view versions.
Each submits `asset.optimize` through `apps.assets.optimize.submit_optimization` and is refused
with a safe message unless its control (`LAI_GLB_MESHOPT`, `LAI_GLB_KTX2`) is on. The result is a
derived artifact (review, report and promotion live on the derived artifact page); nothing here
changes the version, publishes or promotes.
"""

from django.contrib import admin, messages
from django.contrib.admin.options import ActionLocation

ACTION_NAMES = ("optimize_meshopt", "optimize_ktx2")


class OptimizeAdminMixin:
    def has_optimize_permission(self, request) -> bool:
        return bool(
            request.user.is_staff
            and request.user.has_perm("assets.add_assetversion")
            and self.has_view_permission(request)
        )

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        actions = super().get_actions(request, action_location)
        if self.has_optimize_permission(request):
            for name in ACTION_NAMES:
                action = self.get_action(name, action_location)
                if action is not None:
                    actions[action.name] = action
        return actions

    def _optimize(self, request, queryset, variant: str) -> None:
        """Submit `asset.optimize` (ADR-070) for each selected GLB version, or report its job.
        Refused unless the variant's control is on. The version is never changed: the result is
        a derived artifact for review, and promotion and publication stay separate actions."""
        from apps.jobs.services import JobsDisabled, JobsError

        from . import optimize

        submitted = 0
        for version in self._first_batch(request, queryset):
            try:
                job = optimize.submit_optimization(version, variant, user=request.user)
            except optimize.OptimizeRefused as refused:
                self.message_user(request, f"{version.label}: {refused.message}", messages.ERROR)
                if refused.code == "optimization_disabled":
                    return
                continue
            except JobsDisabled:
                self.message_user(
                    request,
                    "Background jobs are turned off on this server, so nothing was optimized.",
                    messages.ERROR,
                )
                return
            except JobsError as error:
                message = (
                    getattr(error, "message", "") or f"Optimization could not start ({error.code})."
                )
                self.message_user(request, f"{version.label}: {message}", messages.ERROR)
                continue
            submitted += 1
            self.log_change(request, version, f"Submitted {variant} optimization job {job.pk}.")
        if submitted:
            self.message_user(
                request,
                f"Optimization submitted for {submitted} version(s). The versions are unchanged; "
                "the optimized model and its report appear under Derived artifacts for review.",
                messages.SUCCESS,
            )

    @admin.action(description="Optimize (Meshopt)", permissions=["optimize"])
    def optimize_meshopt(self, request, queryset):
        self._optimize(request, queryset, "meshopt")

    @admin.action(description="Optimize (KTX2)", permissions=["optimize"])
    def optimize_ktx2(self, request, queryset):
        self._optimize(request, queryset, "ktx2")
