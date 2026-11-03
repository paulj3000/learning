"""Django Admin for versioned content (ADR-047, LAI-0801 first stage).

What an administrator can do, and the permission each needs (ADR-047-Q1: one person may hold
both; they stay separate so an approval step can be added later):

- **View** versions and history: any catalog admin (`admin_access.can_view`).
- **Edit content** (start a draft from the published version, edit its JSON body and note,
  discard it): `catalog.edit_content_draft`.
- **Publish** a draft, or **restore** an earlier version as a new one:
  `catalog.publish_content`. Every publish records who and when.

Nothing is ever deleted (ADR-047-Q3). Drafts are edited as the record's export-shaped JSON in this
first stage; structured editors per kind (dialogue nodes, quest stages) are later LAI-0801 stages.
Publishing runs the full validation and lists every problem. Spatial layout is not here.
"""

import json

from django import forms
from django.contrib import admin, messages
from django.contrib.contenttypes.models import ContentType
from django.core.exceptions import PermissionDenied
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.utils.html import format_html, format_html_join

from . import admin_access, authoring, authoring_forms
from .models import ContentAuthority, ContentRevision, RevisionStatus

EDIT_PERMISSION = authoring.EDIT_PERMISSION
PUBLISH_PERMISSION = authoring.PUBLISH_PERMISSION


def can_edit(request) -> bool:
    return admin_access.can_view(request) and request.user.has_perm(EDIT_PERMISSION)


def can_edit_json(request) -> bool:
    return admin_access.can_view(request) and request.user.has_perm(authoring.EDIT_JSON_PERMISSION)


def can_publish(request) -> bool:
    return admin_access.can_view(request) and request.user.has_perm(PUBLISH_PERMISSION)


class PrettyJSONField(forms.JSONField):
    def prepare_value(self, value):
        if isinstance(value, str):
            return value
        return json.dumps(value, indent=2, ensure_ascii=False)


class DraftForm(forms.ModelForm):
    body = PrettyJSONField(widget=forms.Textarea(attrs={"rows": 32, "cols": 110}))

    class Meta:
        model = ContentRevision
        fields = ("body", "note")


@admin.register(ContentRevision)
class ContentRevisionAdmin(admin.ModelAdmin):
    change_form_template = "admin/catalog/contentrevision/change_form.html"
    list_display = (
        "kind",
        "record_key",
        "number",
        "status",
        "origin",
        "published_by",
        "published_at",
        "created_at",
    )
    list_filter = ("kind", "status", "origin")
    search_fields = ("record_key", "note")
    ordering = ("kind", "record_key", "-number")
    readonly_shown = (
        "kind",
        "record_key",
        "number",
        "status",
        "origin",
        "record_authority",
        "based_on",
        "content_release",
        "problems",
        "created_by",
        "created_at",
        "published_by",
        "published_at",
        "submitted_by",
        "submitted_at",
        "reviewed_by",
        "reviewed_at",
        "rejection_reason",
    )

    def _json_editable(self, request, obj) -> bool:
        """Raw JSON is a separate permission (LAI-0801); everyone else uses the structured form."""
        return obj is not None and obj.status == RevisionStatus.DRAFT and can_edit_json(request)

    def get_form(self, request, obj=None, change=False, **kwargs):
        if self._json_editable(request, obj):
            kwargs["form"] = DraftForm
        return super().get_form(request, obj, change, **kwargs)

    def get_fields(self, request, obj=None):
        body = ("body", "note") if self._json_editable(request, obj) else ("body_shown", "note")
        return (*self.readonly_shown[:6], *body, *self.readonly_shown[6:])

    def get_readonly_fields(self, request, obj=None):
        if self._json_editable(request, obj):
            return self.readonly_shown
        return (*self.readonly_shown, "body_shown", "note")

    @admin.display(description="Content")
    def body_shown(self, obj):
        return format_html("<pre>{}</pre>", json.dumps(obj.body, indent=2, ensure_ascii=False))

    @admin.display(description="Problems found at the last check")
    def problems(self, obj):
        if not obj.validation_report:
            return "None"
        return format_html_join("", "<div>{}</div>", ((p,) for p in obj.validation_report))

    @admin.display(description="Record is owned by")
    def record_authority(self, obj):
        row = authoring.row_of(obj)
        return ContentAuthority(row.authority).label

    # --- permissions: deny by default, never delete -------------------------------------------

    def has_module_permission(self, request):
        return admin_access.can_view(request)

    def has_view_permission(self, request, obj=None):
        return admin_access.can_view(request)

    def has_add_permission(self, request):
        return False  # drafts start from a record's page ("Edit content")

    def has_change_permission(self, request, obj=None):
        return can_edit(request) and (obj is None or obj.status == RevisionStatus.DRAFT)

    def has_delete_permission(self, request, obj=None):
        return False

    def get_actions(self, request, *args, **kwargs):
        return {}

    # --- saving a draft, and the publish / discard / restore buttons ---------------------------

    def save_model(self, request, obj, form, change):
        if not can_edit_json(request):
            raise PermissionDenied
        try:
            authoring.update_draft(
                obj, form.cleaned_data["body"], user=request.user, note=form.cleaned_data["note"]
            )
        except authoring.NotPermitted:
            raise PermissionDenied from None

    def get_urls(self):
        return [
            path(
                "new-draft/<int:content_type_id>/<str:object_id>/",
                self.admin_site.admin_view(self.new_draft_view),
                name="catalog_contentrevision_new_draft",
            ),
            path(
                "use-export/<int:content_type_id>/<str:object_id>/",
                self.admin_site.admin_view(self.use_export_view),
                name="catalog_contentrevision_use_export",
            ),
            path(
                "<uuid:revision_id>/edit/",
                self.admin_site.admin_view(self.editor_view),
                name="catalog_contentrevision_edit",
            ),
            path(
                "<uuid:revision_id>/preview/",
                self.admin_site.admin_view(self.preview_view),
                name="catalog_contentrevision_preview",
            ),
            path(
                "<uuid:revision_id>/act/<str:action>/",
                self.admin_site.admin_view(self.act_view),
                name="catalog_contentrevision_act",
            ),
            *super().get_urls(),
        ]

    def _change_url(self, revision) -> str:
        return reverse("admin:catalog_contentrevision_change", args=[revision.pk])

    def new_draft_view(self, request, content_type_id, object_id):
        """GET: confirm. POST: start (or reopen) this administrator's draft for the record."""
        if not can_edit(request):
            raise PermissionDenied
        content_type = get_object_or_404(ContentType, pk=content_type_id)
        model = content_type.model_class()
        try:
            kind = authoring.kind_for(model)  # only authorable kinds
        except LookupError:
            raise PermissionDenied from None
        row = get_object_or_404(model, pk=object_id)
        if request.method != "POST":
            return TemplateResponse(
                request,
                "admin/catalog/contentrevision/new_draft.html",
                {
                    **self.admin_site.each_context(request),
                    "title": f"Edit {kind.name} {kind.key_of(row)}",
                    "record": row,
                    "kind": kind,
                    "opts": self.model._meta,
                },
            )
        existing = (
            authoring.revisions_for(row)
            .filter(status=RevisionStatus.DRAFT, created_by=request.user)
            .first()
        )
        draft = existing or authoring.create_draft(
            row, authoring.current_body(row), user=request.user
        )
        return HttpResponseRedirect(
            self._change_url(draft) if can_edit_json(request) else self._edit_url(draft)
        )

    def use_export_view(self, request, content_type_id, object_id):
        """GET: confirm. POST: start a draft from the record's exported version (ADR-047 J)."""
        if not can_edit(request):
            raise PermissionDenied
        content_type = get_object_or_404(ContentType, pk=content_type_id)
        model = content_type.model_class()
        try:
            kind = authoring.kind_for(model)
        except LookupError:
            raise PermissionDenied from None
        row = get_object_or_404(model, pk=object_id)
        if request.method != "POST":
            return TemplateResponse(
                request,
                "admin/catalog/contentrevision/use_export.html",
                {
                    **self.admin_site.each_context(request),
                    "title": f"Use the exported version of {kind.name} {kind.key_of(row)}",
                    "record": row,
                    "opts": self.model._meta,
                },
            )
        try:
            draft = authoring.use_exported_version(row, user=request.user)
        except authoring.PublishRefused as refused:
            for problem in refused.problems:
                self.message_user(request, problem, messages.ERROR)
            return HttpResponseRedirect(request.META.get("HTTP_REFERER") or reverse("admin:index"))
        self.message_user(request, "Draft started from the exported version. Publish it normally.")
        return HttpResponseRedirect(self._edit_url(draft))

    def _edit_url(self, revision) -> str:
        return reverse("admin:catalog_contentrevision_edit", args=[revision.pk])

    def editor_view(self, request, revision_id):
        """The structured editor (LAI-0801): a form built from the kind's schema."""
        if not can_edit(request):
            raise PermissionDenied
        revision = get_object_or_404(ContentRevision, pk=revision_id)
        if revision.status != RevisionStatus.DRAFT:
            self.message_user(request, "Only a draft can be edited.", messages.ERROR)
            return HttpResponseRedirect(self._change_url(revision))
        row = authoring.row_of(revision)
        kind = authoring.kind_for(row)
        errors: list[str] = []
        if request.method == "POST":
            try:
                body = authoring_forms.read_body(kind, request.POST, revision.body)
                operation = request.POST.get(authoring_forms.OP_FIELD, "")
                if operation:
                    body = authoring_forms.apply_operation(kind, body, operation)
                authoring.update_draft(
                    revision, body, user=request.user, note=request.POST.get("note", "")[:300]
                )
            except authoring_forms.EditorError as error:
                errors = error.problems
            except (KeyError, IndexError, ValueError):
                errors = ["That change could not be applied. Nothing was saved."]
            except authoring.NotPermitted:
                raise PermissionDenied from None
            except authoring.PublishRefused as refused:
                errors = refused.problems
            if not errors:
                revision.refresh_from_db()
                if revision.validation_report:
                    self.message_user(
                        request,
                        f"Saved. {len(revision.validation_report)} problem(s) to fix before "
                        "this can be submitted.",
                        messages.WARNING,
                    )
                else:
                    self.message_user(request, "Saved. No problems found.")
                return HttpResponseRedirect(self._edit_url(revision))
        rows, unplaced = authoring_forms.rows_for(kind, revision.body, revision.validation_report)
        published = authoring.current_body(row)
        return TemplateResponse(
            request,
            "admin/catalog/contentrevision/editor.html",
            {
                **self.admin_site.each_context(request),
                "title": f"Edit {kind.name} {kind.key_of(row)} (version {revision.number})",
                "opts": self.model._meta,
                "revision": revision,
                "rows": rows,
                "unplaced": unplaced,
                "errors": errors,
                "op_field": authoring_forms.OP_FIELD,
                "changes": authoring_forms.changed_paths(published, revision.body),
                "change_url": self._change_url(revision),
                "preview_url": reverse("admin:catalog_contentrevision_preview", args=[revision.pk]),
                "can_edit_json": can_edit_json(request),
            },
        )

    def preview_view(self, request, revision_id):
        """What a child would read from this version, per age band (no child data involved)."""
        if not admin_access.can_view(request):
            raise PermissionDenied
        revision = get_object_or_404(ContentRevision, pk=revision_id)
        band = request.GET.get("band") or None
        if band not in (None, "SPROUT", "PATHFINDER", "EXPLORER"):
            band = None
        return TemplateResponse(
            request,
            "admin/catalog/contentrevision/preview.html",
            {
                **self.admin_site.each_context(request),
                "title": f"Preview {revision}",
                "opts": self.model._meta,
                "revision": revision,
                "band": band,
                "bands": ["SPROUT", "PATHFINDER", "EXPLORER"],
                "lines": authoring_forms.preview_lines(revision.body, band),
                "change_url": self._change_url(revision),
            },
        )

    def act_view(self, request, revision_id, action):
        if request.method != "POST":
            raise PermissionDenied
        revision = get_object_or_404(ContentRevision, pk=revision_id)
        user = request.user
        try:
            if not admin_access.can_view(request):
                raise PermissionDenied
            if action == "publish":
                published = authoring.publish(revision, user=user)
                self.message_user(
                    request, f"Published {published}. Children see it on their next visit."
                )
            elif action == "restore":
                revision = authoring.rollback(revision, user=user)
                self.message_user(request, f"Restored as {revision}.")
            elif action == "discard":
                authoring.discard(revision, user=user)
                self.message_user(request, f"Discarded {revision} (kept in history).")
            elif action == "submit":
                authoring.submit(revision, user=user)
                self.message_user(request, f"Submitted {revision} for approval.")
            elif action == "withdraw":
                authoring.withdraw(revision, user=user)
                self.message_user(request, f"Withdrew {revision} to a draft.")
            elif action == "reopen":
                authoring.reopen(revision, user=user)
                self.message_user(request, f"Reopened {revision} as a draft.")
            elif action == "reject":
                authoring.reject(revision, user=user, reason=request.POST.get("reason", ""))
                self.message_user(request, f"Returned {revision} to its author.")
            else:
                raise PermissionDenied
        except authoring.NotPermitted:
            raise PermissionDenied from None
        except authoring.PublishRefused as refused:
            for problem in refused.problems:
                self.message_user(request, problem, messages.ERROR)
            self.message_user(request, "Nothing was changed.", messages.ERROR)
        return HttpResponseRedirect(self._change_url(revision))

    def render_change_form(self, request, context, *args, obj=None, **kwargs):
        context.update(
            {
                "can_publish_content": can_publish(request),
                "can_edit_content": can_edit(request),
                "revision": obj,
                "is_draft": obj is not None and obj.status == RevisionStatus.DRAFT,
                "is_submitted": obj is not None and obj.status == RevisionStatus.SUBMITTED,
                "is_rejected": obj is not None and obj.status == RevisionStatus.REJECTED,
                "independent_approval": authoring.independent_approval_required(),
                "edit_url": self._edit_url(obj) if obj is not None else "",
                "preview_url": reverse("admin:catalog_contentrevision_preview", args=[obj.pk])
                if obj is not None
                else "",
                "can_restore": obj is not None
                and obj.status in (RevisionStatus.SUPERSEDED, RevisionStatus.PUBLISHED),
            }
        )
        return super().render_change_form(request, context, *args, obj=obj, **kwargs)


def content_versions_html(obj):
    """The read-only summary shown on every authorable record's admin page. The edit link is
    shown to every viewer; the draft view itself checks `catalog.edit_content_draft`."""
    if obj is None or obj.pk is None:
        return "-"
    kind = authoring.kind_for(obj)
    history = (
        reverse("admin:catalog_contentrevision_changelist")
        + f"?kind__exact={kind.name}&q={kind.key_of(obj)}"
    )
    current = obj.published_revision
    drafts = authoring.revisions_for(obj).filter(status=RevisionStatus.DRAFT).count()
    content_type = ContentType.objects.get_for_model(type(obj))
    edit = reverse("admin:catalog_contentrevision_new_draft", args=[content_type.pk, obj.pk])
    summary = format_html(
        "Owned by: <strong>{}</strong>. Published version: <strong>{}</strong>. "
        'Open drafts: {}. <a href="{}">History</a><br>'
        '<a class="button" href="{}">Edit content (start a draft)</a>',
        ContentAuthority(obj.authority).label,
        current.number if current else "none",
        drafts,
        history,
        edit,
    )
    if obj.authority == ContentAuthority.DJANGO:
        use_export = reverse(
            "admin:catalog_contentrevision_use_export", args=[content_type.pk, obj.pk]
        )
        summary += format_html(
            ' <a class="button" href="{}">Use the exported version</a>', use_export
        )
    return summary


class AuthoredContentAdminMixin:
    """Adds the content-version summary to an authorable record's admin page, and the
    named-session confirmation before a record in use is retired (ADR-047 E)."""

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        return fields if "content_versions" in fields else [*fields, "content_versions"]

    def get_fields(self, request, obj=None):
        fields = [f for f in super().get_fields(request, obj) if f != "content_versions"]
        extra = ["confirm_retire"] if self._sessions_using(obj) else []
        return ["content_versions", *fields, *extra]

    @staticmethod
    def _sessions_using(obj) -> list[str]:
        if obj is None or obj.pk is None or not getattr(obj, "active", False):
            return []
        try:
            authoring.kind_for(obj)
        except LookupError:
            return []
        return authoring.open_sessions_using(obj)

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        using = self._sessions_using(obj)
        if not using:
            return form

        class RetireConfirmForm(form):
            confirm_retire = forms.CharField(
                required=False,
                label="Confirm retirement",
                help_text=(
                    "Open sessions use this record: " + ", ".join(using) + ". To retire it, "
                    "untick Active and type exactly these session ids here."
                ),
            )

            def clean(self):
                data = super().clean()
                typed = sorted((data.get("confirm_retire") or "").replace(",", " ").split())
                if data.get("active") is False and typed != using:
                    self.add_error(
                        "confirm_retire",
                        "Open sessions use this record. Type their ids to confirm: "
                        + ", ".join(using),
                    )
                return data

        return RetireConfirmForm

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if change and "active" in form.changed_data:
            authoring.record_active_change(obj, request.user)

    @admin.display(description="Content versions (ADR-047)")
    def content_versions(self, obj):
        return content_versions_html(obj)
