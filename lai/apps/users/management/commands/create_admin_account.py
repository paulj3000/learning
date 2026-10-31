"""Create a Django Admin account, or reset its password (LAI-0404, ADR-034).

    python manage.py create_admin_account <username> [--superuser] [--cognito-sub SUB]
    python manage.py create_admin_account <username> --reset-password

The password is read twice from the terminal, or, with --no-input, from the environment variable
DJANGO_ADMIN_PASSWORD (for a one-off container task). It is never a command-line argument, never
printed, and must pass AUTH_PASSWORD_VALIDATORS. There is no default account and no default
password.

--cognito-sub links the admin account to an existing parent account (one person, two
credentials); without it a standalone admin row is created whose placeholder sub no Cognito
token can carry. Either way the account signs in to Django Admin with the username and password
only; a Cognito token never grants admin access.
"""

import getpass
import os
import uuid

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.views.decorators.debug import sensitive_variables

from apps.users.models import ADMIN_ONLY_SUB_PREFIX, ParentAccount

PASSWORD_ENV = "DJANGO_ADMIN_PASSWORD"  # noqa: S105 - the variable name, not a password


class Command(BaseCommand):
    help = "Create a Django Admin account (staff, optionally superuser) or reset its password."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--superuser", action="store_true", help="Grant full admin rights.")
        parser.add_argument(
            "--cognito-sub", help="Link to the existing parent account with this Cognito sub."
        )
        parser.add_argument(
            "--reset-password", action="store_true", help="Set a new password for this username."
        )
        parser.add_argument(
            "--no-input", action="store_true", help=f"Read the password from {PASSWORD_ENV}."
        )

    @sensitive_variables("password")
    def handle(self, *args, username, superuser, cognito_sub, reset_password, no_input, **options):
        username = username.strip()
        if not username or len(username) > 150 or any(ch.isspace() for ch in username):
            raise CommandError("The username must be 1 to 150 characters with no spaces.")

        with transaction.atomic():
            existing = (
                ParentAccount.objects.select_for_update().filter(admin_username=username).first()
            )
            if reset_password:
                if existing is None:
                    raise CommandError("No admin account has that username.")
                if superuser or cognito_sub:
                    raise CommandError("--reset-password changes only the password.")
                account = existing
            else:
                if existing is not None:
                    raise CommandError("An admin account with that username already exists.")
                account = self._new_or_linked_account(cognito_sub)
                account.admin_username = username
                account.is_staff = True
                account.is_superuser = superuser
                account.is_active = True

            password = self._read_password(no_input)
            try:
                validate_password(password, account)
            except ValidationError as error:
                raise CommandError(" ".join(error.messages)) from None
            account.set_password(password)
            account.save()

        action = "Password reset for" if reset_password else "Created"
        role = "superuser" if account.is_superuser else "staff"
        self.stdout.write(f"{action} admin account {username!r} ({role}).")

    @staticmethod
    def _new_or_linked_account(cognito_sub: str | None) -> ParentAccount:
        if not cognito_sub:
            return ParentAccount(cognito_sub=f"{ADMIN_ONLY_SUB_PREFIX}{uuid.uuid4()}")
        account = ParentAccount.objects.select_for_update().filter(cognito_sub=cognito_sub).first()
        if account is None:
            raise CommandError(
                "No parent account has that Cognito sub. The parent must sign in to the app once "
                "(which provisions the account) before it can be linked."
            )
        if account.admin_username:
            raise CommandError("That parent account already has an admin username.")
        return account

    @sensitive_variables("password", "confirm")
    def _read_password(self, no_input: bool) -> str:
        if no_input:
            password = os.environ.get(PASSWORD_ENV, "")
            if not password:
                raise CommandError(f"--no-input needs {PASSWORD_ENV} to be set.")
            return password
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Password (again): ")
        if password != confirm:
            raise CommandError("The passwords do not match.")
        if not password:
            raise CommandError("The password must not be empty.")
        return password
