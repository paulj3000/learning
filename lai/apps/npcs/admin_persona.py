"""NPC personas in the Django Admin (workstream F, LAI-NPC-031).

- Personas are versioned per character. A new persona gets the next version number. Saving runs
  the release rules (`validation.persona.persona_problems`), so staff see problems at save time.
- "Approve" (NPC publishers: `npcs.publish_npcrelease`, or a superuser) makes a DRAFT the
  character's one APPROVED persona (the previous APPROVED one is RETIRED, in one transaction).
  An APPROVED or RETIRED persona is read only and cannot be deleted; to change wording,
  "Copy as a new draft" and approve that.
- Approval alone changes nothing children see: the snapshot copies the APPROVED persona when the
  next NPC release is published (server-only key `persona`, never sent to clients).
"""

from __future__ import annotations

from django import forms
from django.contrib import admin, messages
from django.db import transaction
from django.db.models import Max

from .models import NpcPersona, PersonaStatus
from .validation.persona import persona_problems

APPROVE_PERMISSION = "npcs.publish_npcrelease"

EDITABLE = (
    "personality_prompt",
    "permitted_topics",
    "age_bands",
    "max_response_chars",
    "fallback_lines",
)


def as_snapshot(persona: NpcPersona) -> dict:
    """The persona as the release snapshot will hold it (see `publishing.snapshot._persona`)."""
    return {
        "version": persona.version,
        "personalityPrompt": persona.personality_prompt,
        "permittedTopics": list(persona.permitted_topics or []),
        "ageBands": list(persona.age_bands or []),
        "maxResponseChars": persona.max_response_chars,
        "fallbackLines": persona.fallback_lines,
    }


def next_version(character) -> int:
    top = NpcPersona.objects.filter(character=character).aggregate(top=Max("version"))["top"]
    return (top or 0) + 1


class NpcPersonaForm(forms.ModelForm):
    class Meta:
        model = NpcPersona
        fields = ("character", *EDITABLE)
        help_texts = {
            "personality_prompt": (
                "Who the character is and how it talks, for the AI only. The fixed safety rules "
                "are added by the server; do not repeat or change them."
            ),
            "permitted_topics": (
                "Comma separated. A hint node's allowed topic must be one of these."
            ),
            "max_response_chars": (
                "At most the AI limit of the youngest band served (Sprouts 120, Pathfinders 200,"
                " Explorers 320)."
            ),
            "fallback_lines": (
                'JSON list of short lines, e.g. ["Look closely, matey!"]. Used whenever AI is '
                "off, slow or refused. Readable aloud, no em dashes."
            ),
        }

    def clean(self):
        data = super().clean()
        character = data.get("character") or getattr(self.instance, "character", None)
        if character is None or self.errors:
            return data
        candidate = NpcPersona(
            character=character,
            version=self.instance.version or 0,
            **{name: data.get(name) for name in EDITABLE},
        )
        found = persona_problems(
            as_snapshot(candidate), list(character.age_bands or []), "This persona"
        )
        if found:
            raise forms.ValidationError(found)
        return data


@admin.register(NpcPersona)
class NpcPersonaAdmin(admin.ModelAdmin):
    form = NpcPersonaForm
    list_display = ("character", "version", "status", "max_response_chars", "updated_at")
    list_filter = ("status",)
    search_fields = ("character__definition__npc_id", "character__definition__display_name")
    ordering = ("character__definition__npc_id", "-version")
    actions = ("approve", "retire", "copy_as_draft")
    readonly_fields = ("version", "status", "created_by", "created_at", "updated_by", "updated_at")

    def get_fields(self, request, obj=None):
        return ("character", "version", "status", *EDITABLE, *self.readonly_fields[2:])

    def get_readonly_fields(self, request, obj=None):
        if obj is not None and obj.status != PersonaStatus.DRAFT:
            return ("character", *EDITABLE, *self.readonly_fields)
        if obj is not None:
            return ("character", *self.readonly_fields)
        return self.readonly_fields

    def has_delete_permission(self, request, obj=None):
        if obj is not None and obj.status != PersonaStatus.DRAFT:
            return False
        return super().has_delete_permission(request, obj)

    def save_model(self, request, obj, form, change):
        if obj.pk is not None:
            stored = NpcPersona.objects.filter(pk=obj.pk).values_list("status", flat=True).first()
            if stored != PersonaStatus.DRAFT:
                return  # approved and retired personas are immutable
        if not change:
            obj.created_by = request.user
            obj.status = PersonaStatus.DRAFT
            with transaction.atomic():
                obj.version = next_version(obj.character)
                obj.updated_by = request.user
                super().save_model(request, obj, form, change)
            return
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)

    def _may_approve(self, request) -> bool:
        # Approving a persona lets a model speak as the character, so it takes the same
        # permission as publishing a release (NPC publishers, or a superuser).
        return self.has_change_permission(request) and request.user.has_perm(APPROVE_PERMISSION)

    @admin.action(description="Approve the selected draft (retires the current approved one)")
    def approve(self, request, queryset):
        if not self._may_approve(request):
            self.message_user(request, "Only NPC publishers can approve a persona.", messages.ERROR)
            return
        approved = 0
        for persona in queryset.filter(status=PersonaStatus.DRAFT).select_related("character"):
            found = persona_problems(
                as_snapshot(persona), list(persona.character.age_bands or []), str(persona)
            )
            if found:
                self.message_user(request, "; ".join(found), messages.ERROR)
                continue
            with transaction.atomic():
                NpcPersona.objects.filter(
                    character=persona.character, status=PersonaStatus.APPROVED
                ).update(status=PersonaStatus.RETIRED, updated_by=request.user)
                persona.status = PersonaStatus.APPROVED
                persona.updated_by = request.user
                persona.save(update_fields=["status", "updated_by", "updated_at"])
            approved += 1
        if approved:
            self.message_user(
                request,
                f"Approved {approved} persona(s). Children see them after the next NPC release.",
                messages.SUCCESS,
            )

    @admin.action(description="Retire the selected personas")
    def retire(self, request, queryset):
        if not self._may_approve(request):
            self.message_user(request, "Only NPC publishers can retire a persona.", messages.ERROR)
            return
        count = queryset.exclude(status=PersonaStatus.RETIRED).update(
            status=PersonaStatus.RETIRED, updated_by=request.user
        )
        self.message_user(
            request,
            f"Retired {count} persona(s). The active release keeps its copy until the next "
            "release is published.",
            messages.SUCCESS,
        )

    @admin.action(description="Copy as a new draft")
    def copy_as_draft(self, request, queryset):
        if not self.has_add_permission(request):
            return
        for persona in queryset.select_related("character"):
            with transaction.atomic():
                NpcPersona.objects.create(
                    character=persona.character,
                    version=next_version(persona.character),
                    status=PersonaStatus.DRAFT,
                    created_by=request.user,
                    updated_by=request.user,
                    **{name: getattr(persona, name) for name in EDITABLE},
                )
        self.message_user(request, "Copied as new drafts.", messages.SUCCESS)
