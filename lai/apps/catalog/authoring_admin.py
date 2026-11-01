"""Django Admin for versioned content (ADR-043, LAI-0801 first stage).

What an administrator can do, and the permission each needs (ADR-043-Q1: one person may hold
both; they stay separate so an approval step can be added later):

- **View** versions and history: any catalog admin (`admin_access.can_view`).
- **Edit content** (start a draft from the published version, edit its JSON body and note,
  discard it): `catalog.edit_content_draft`.
- **Publish** a draft, or **restore** an earlier version as a new one:
  `catalog.publish_content`. Every publish records who and when.

Nothing is ever deleted (ADR-043-Q3). Drafts are edited as the record's export-shaped JSON in this
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

from . import admin_access, authoring
from .models import ContentAuthority, ContentRevision, RevisionStatus

EDIT_PERMISSION = "catalog.edit_content_draft"
PUBLISH_PERMISSION = "catalog.publish_content"


def can_edit(request) -> bool:
    return admin_access.can_view(request) and request.user.has_perm(EDIT_PERMISSION)


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
    )

    def get_form(self, request, obj=None, change=False, **kwargs):
        if obj is not None and obj.status == RevisionStatus.DRAFT and can_edit(request):
            kwargs["form"] = DraftForm
        return super().get_form(request, obj, change, **kwargs)

    def get_fields(self, request, obj=None):
        editable = obj is not None and obj.status == RevisionStatus.DRAFT and can_edit(request)
        body = ("body", "note") if editable else ("body_shown", "note")
        return (*self.readonly_shown[:6], *body, *self.readonly_shown[6:])

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.status == RevisionStatus.DRAFT and can_edit(request):
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
        if not can_edit(request):
            raise PermissionDenied
        authoring.update_draft(obj, form.cleaned_data["body"], note=form.cleaned_data["note"])

    def get_urls(self):
        return [
            path(
                "new-draft/<int:content_type_id>/<str:object_id>/",
                self.admin_site.admin_view(self.new_draft_view),
                name="catalog_contentrevision_new_draft",
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
        return HttpResponseRedirect(self._change_url(draft))

    def act_view(self, request, revision_id, action):
        if request.method != "POST":
            raise PermissionDenied
        revision = get_object_or_404(ContentRevision, pk=revision_id)
        try:
            if action == "publish" and can_publish(request):
                published = authoring.publish(revision, user=request.user)
                self.message_user(
                    request, f"Published {published}. Children see it on their next visit."
                )
            elif action == "restore" and can_publish(request):
                restored = authoring.rollback(revision, user=request.user)
                self.message_user(request, f"Restored as {restored}.")
                revision = restored
            elif action == "discard" and can_edit(request):
                authoring.discard(revision)
                self.message_user(request, f"Discarded {revision} (kept in history).")
            else:
                raise PermissionDenied
        except authoring.PublishRefused as refused:
            for problem in refused.problems:
                self.message_user(request, problem, messages.ERROR)
            self.message_user(request, "Nothing was published.", messages.ERROR)
        return HttpResponseRedirect(self._change_url(revision))

    def render_change_form(self, request, context, *args, obj=None, **kwargs):
        context.update(
            {
                "can_publish_content": can_publish(request),
                "can_edit_content": can_edit(request),
                "revision": obj,
                "is_draft": obj is not None and obj.status == RevisionStatus.DRAFT,
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
    return format_html(
        "Owned by: <strong>{}</strong>. Published version: <strong>{}</strong>. "
        'Open drafts: {}. <a href="{}">History</a><br>'
        '<a class="button" href="{}">Edit content (start a draft)</a>',
        ContentAuthority(obj.authority).label,
        current.number if current else "none",
        drafts,
        history,
        edit,
    )


class AuthoredContentAdminMixin:
    """Adds the content-version summary to an authorable record's admin page."""

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        return fields if "content_versions" in fields else [*fields, "content_versions"]

    def get_fields(self, request, obj=None):
        fields = [f for f in super().get_fields(request, obj) if f != "content_versions"]
        return ["content_versions", *fields]

    @admin.display(description="Content versions (ADR-043)")
    def content_versions(self, obj):
        return content_versions_html(obj)
