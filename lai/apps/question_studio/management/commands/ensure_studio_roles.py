"""Create or reset the AI Question Studio staff groups (docs/AI_QUESTION_STUDIO.md section 10).

    python manage.py ensure_studio_roles

Idempotent: each group ends with exactly the permissions listed here, so re-running it after a
release also removes anything granted to these groups by hand. Group membership is never changed:
add a staff account to a group on the Admin accounts page (superusers only). Superusers need no
group.

Every Studio admin check also requires `is_staff` (`question_studio.admin._perm`), so a parent or
child account cannot use these permissions even if one were added to a group; this command never
adds anyone.

- Question authors: request generation batches, see and edit drafts, and cancel or retry their
  batches (`cancel_generationbatch`, `retry_generationbatch`; retry also needs
  `add_generationbatch`).
- Question reviewers: review, approve, reject and reopen drafts; see published revisions.
- Question publishers: reviewer rights plus publishing and retiring revisions.
- Pool managers: curate question pools.
"""

from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

AUTHORS = "Question authors"
REVIEWERS = "Question reviewers"
PUBLISHERS = "Question publishers"
POOL_MANAGERS = "Pool managers"

AUTHOR_PERMISSIONS = (
    "question_studio.add_generationbatch",
    "question_studio.view_generationbatch",
    "question_studio.cancel_generationbatch",
    "question_studio.retry_generationbatch",
    "question_studio.view_question",
    "question_studio.add_question",
    "question_studio.change_question",
)
REVIEWER_PERMISSIONS = (
    "question_studio.view_question",
    "question_studio.change_question",
    "question_studio.approve_question",
    "question_studio.view_questionrevision",
)
PUBLISHER_PERMISSIONS = (
    *REVIEWER_PERMISSIONS,
    "question_studio.publish_question",
    "question_studio.retire_revision",
)
POOL_MANAGER_PERMISSIONS = (
    "question_studio.view_questionpool",
    "question_studio.add_questionpool",
    "question_studio.change_questionpool",
)
ROLES = {
    AUTHORS: AUTHOR_PERMISSIONS,
    REVIEWERS: REVIEWER_PERMISSIONS,
    PUBLISHERS: PUBLISHER_PERMISSIONS,
    POOL_MANAGERS: POOL_MANAGER_PERMISSIONS,
}


def _permission(name: str) -> Permission:
    app_label, codename = name.split(".")
    try:
        return Permission.objects.get(content_type__app_label=app_label, codename=codename)
    except Permission.DoesNotExist:
        raise CommandError(f"Permission {name} does not exist; run migrate first.") from None


def ensure_studio_roles() -> dict[str, int]:
    counts = {}
    with transaction.atomic():
        for group_name, names in ROLES.items():
            group, _ = Group.objects.get_or_create(name=group_name)
            group.permissions.set([_permission(name) for name in names])
            counts[group_name] = len(names)
    return counts


class Command(BaseCommand):
    help = "Create or reset the AI Question Studio staff groups."

    def handle(self, *args, **options):
        for group, count in ensure_studio_roles().items():
            self.stdout.write(f"{group}: {count} permissions")
