"""Change an existing admin account's role (LAI-0404, ADR-034).

    python manage.py set_admin_role <username> superuser   # staff with full admin rights
    python manage.py set_admin_role <username> staff       # catalog admin, no account management
    python manage.py set_admin_role <username> none        # no Django Admin access at all

The account must already have an admin username (`create_admin_account`, which also links a
signed-up parent with --cognito-sub). Removing the last active superuser is refused, so the admin
cannot be locked out by accident. The change applies on the account's next request.
"""

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.users.models import ParentAccount

ROLES = {"superuser": (True, True), "staff": (True, False), "none": (False, False)}


class Command(BaseCommand):
    help = "Set an admin account's role: superuser, staff, or none."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("role", choices=sorted(ROLES))

    def handle(self, *args, username, role, **options):
        is_staff, is_superuser = ROLES[role]
        with transaction.atomic():
            account = (
                ParentAccount.objects.select_for_update()
                .filter(admin_username=username.strip())
                .first()
            )
            if account is None:
                raise CommandError(
                    "No admin account has that username. Create one with create_admin_account "
                    "(use --cognito-sub to upgrade a parent who has signed up)."
                )
            if account.is_superuser and not is_superuser and self._is_last_superuser(account):
                raise CommandError("That is the last active superuser; make another one first.")
            account.is_staff = is_staff
            account.is_superuser = is_superuser
            account.save(update_fields=["is_staff", "is_superuser", "updated_at"])
        self.stdout.write(f"Admin account {username!r} is now: {role}.")

    @staticmethod
    def _is_last_superuser(account: ParentAccount) -> bool:
        others = (
            ParentAccount.objects.select_for_update()
            .filter(is_superuser=True, is_staff=True, is_active=True)
            .exclude(pk=account.pk)
        )
        return not others.exists()
